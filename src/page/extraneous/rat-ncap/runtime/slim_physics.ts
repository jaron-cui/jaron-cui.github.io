/**
 * Physics on the minimal MuJoCo module (wasm-build/slim: mjb load + step/forward only, ~0.35 MB
 * gzipped instead of ~1.4 MB). Same interface as WasmPhysics: `model` and `data(0)` expose every
 * mjModel/mjData array by its MuJoCo name as typed-array views into wasm memory (no copies), plus
 * model sizes (`model.nbody`, ...), `data.time`, and name lists (`model.body_names`, ...).
 *
 *   import loadMujocoSlim from './mujoco_slim.mjs';
 *   const physics = await SlimPhysics.create(loadMujocoSlim, mjb_bytes);
 */
import { WasmPhysics } from './physics.ts';

type Field = [number, string, number, number];  // [pointer, C type, rows, cols]
interface Layout { sizes: Record<string, number>; model: Record<string, Field>; data: Record<string, Field>; time: number }

const VIEW: Record<string, any> = {
  mjtNum: Float64Array, double: Float64Array, int: Int32Array, float: Float32Array,
  mjtByte: Uint8Array, char: Uint8Array, 'unsigned char': Uint8Array,
};

/** Name lists derived from `names` (as the full bindings' convenience lists). */
const NAMED: Record<string, [string, string]> = {
  body_names: ['nbody', 'name_bodyadr'], jnt_names: ['njnt', 'name_jntadr'], geom_names: ['ngeom', 'name_geomadr'],
  site_names: ['nsite', 'name_siteadr'], actuator_names: ['nu', 'name_actuatoradr'], mat_names: ['nmat', 'name_matadr'],
  sensor_names: ['nsensor', 'name_sensoradr'], tendon_names: ['ntendon', 'name_tendonadr'],
};

export class SlimPhysics extends WasmPhysics {
  private module: any;
  private m_ptr: number;
  private d_ptrs: number[] = [];
  private views: { buffer: ArrayBufferLike; datas: any[] } | null = null;

  /** MuJoCo version string, as mj_versionString() (e.g. '3.12.0'). */
  version: string;

  /** Name of element `id` of a kind ('body', 'geom', 'jnt', 'site', 'actuator', 'mat', 'sensor', 'tendon'), as mj_id2name. */
  id2name(kind: string, id: number): string | null {
    const list = (this.model as any)[`${kind}_names`] as string[] | undefined;
    if (!list) throw new Error(`id2name: unknown kind ${kind}`);
    return list[id] || null;
  }

  private constructor(module: any, m_ptr: number) {
    const shim = {
      mj_step: (_m: unknown, d: any) => module._slim_step(m_ptr, d.__ptr),
      mj_forward: (_m: unknown, d: any) => module._slim_forward(m_ptr, d.__ptr),
    };
    super(shim as any, {} as any);
    this.module = module;
    this.m_ptr = m_ptr;
    this.model = this.make_model() as any;
    this.version = module.UTF8ToString(module._slim_version_string());
  }

  /** `options` go to the Emscripten factory, e.g. `{ locateFile: () => wasm_url }`. */
  static async create(factory: (options?: object) => Promise<any>, mjb: Uint8Array, options: object = {}): Promise<SlimPhysics> {
    const module = await factory(options);
    const p = module._malloc(mjb.length);
    module.HEAPU8.set(mjb, p);
    const m_ptr = module._slim_load(p, mjb.length);
    module._free(p);
    if (!m_ptr) throw new Error(`MuJoCo: cannot load model: ${module.UTF8ToString(module._slim_warning())}`);
    return new SlimPhysics(module, m_ptr);
  }

  private layout(d_ptr: number): Layout {
    return JSON.parse(this.module.UTF8ToString(this.module._slim_layout(this.m_ptr, d_ptr)));
  }

  private bind(target: any, fields: Record<string, Field>) {
    const buffer = this.module.HEAPU8.buffer;
    for (const [name, [ptr, type, nr, nc]] of Object.entries(fields)) {
      const Ctor = VIEW[type];
      if (!Ctor || !ptr) continue;  // e.g. mjtSize/pointer arrays, or empty fields
      target[name] = new Ctor(buffer, ptr, nr * nc);
    }
  }

  private make_model() {
    const lay = this.layout(0);
    const model: any = { ...lay.sizes, __ptr: this.m_ptr };
    this.bind(model, lay.model);
    const names: Uint8Array = model.names;
    const name_at = (adr: number) => { let e = adr; while (names[e]) e++; return new TextDecoder().decode(names.subarray(adr, e)); };
    for (const [list, [count, adr]] of Object.entries(NAMED)) {
      if (model[adr]) model[list] = Array.from({ length: model[count] }, (_, i) => name_at(model[adr][i]));
    }
    return model;
  }

  override data(world: number): any {
    while (this.d_ptrs.length <= world) {
      const p = this.module._slim_make_data(this.m_ptr);
      if (!p) throw new Error('MuJoCo: mj_makeData failed');
      this.d_ptrs.push(p);
      this.views = null;
    }
    // Views detach when wasm memory grows (only during allocation): rebuild them then.
    const buffer = this.module.HEAPU8.buffer;
    if (!this.views || this.views.buffer !== buffer) {
      const datas = this.d_ptrs.map(p => {
        const lay = this.layout(p);
        const heap64 = () => this.module.HEAPF64 as Float64Array;
        const d: any = { __ptr: p };
        this.bind(d, lay.data);
        Object.defineProperty(d, 'time', { get: () => heap64()[lay.time / 8], set: (v: number) => { heap64()[lay.time / 8] = v; } });
        return d;
      });
      this.views = { buffer, datas };
      this.model = this.make_model() as any;
    }
    return this.views.datas[world];
  }
}
