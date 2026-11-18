/**
 * MuJoCo WASM implementation of the `mujoco_physics` primitive (mirrors python/physics_c.py):
 * mjData inputs (state, controls) are copied in from the data operands, `mj_step`/`mj_forward` runs,
 * and every `mjx.Data` field with an mjData counterpart is read back: public fields by name,
 * `_impl.<name>` as `mjData.<name>` when that field exists with the same size. Other fields (MJX's
 * contact/constraint buffers) pass through unchanged.
 */
import type { MainModule, MjModel, MjData } from '@mujoco/mujoco';
import { NDArray } from './ndarray.ts';
import type { Physics } from './graph.ts';

export const INPUT_FIELDS = new Set([
  'time', 'qpos', 'qvel', 'act', 'history', 'qacc_warmstart', 'plugin_state', 'ctrl',
  'qfrc_applied', 'xfrc_applied', 'eq_active', 'mocap_pos', 'mocap_quat', 'userdata',
]);

/** mjData fields sized at runtime (arena: contacts, constraints, islands): never mapped by size. */
const DYNAMIC_PREFIXES = ['efc_', 'iefc_', 'island_', 'contact', 'map_', 'tree_island', 'dof_island', 'ifrc', 'B_', 'C_', 'D_', 'M_', 'qLD', 'qM'];
export function is_dynamic_field(name: string): boolean { return DYNAMIC_PREFIXES.some(p => name.startsWith(p)); }

export class WasmPhysics implements Physics {
  mujoco: MainModule;
  model: MjModel;
  datas: MjData[] = [];
  calls = 0;
  /** Seconds spent inside mj_step/mj_forward, and copying in/out. */
  seconds = { physics: 0, copy: 0 };

  constructor(mujoco: MainModule, model: MjModel) {
    this.mujoco = mujoco;
    this.model = model;
  }

  /** Loads `model.mjb` bytes into a model. */
  static load(mujoco: MainModule, mjb: Uint8Array): WasmPhysics {
    mujoco.FS.writeFile('/model.mjb', mjb);
    const vfs = new mujoco.MjVFS();
    const model = mujoco.MjModel.from_binary_path('/model.mjb', vfs);
    vfs.delete();
    mujoco.FS.unlink('/model.mjb');
    return new WasmPhysics(mujoco, model);
  }

  data(world: number): MjData {
    while (this.datas.length <= world) this.datas.push(new this.mujoco.MjData(this.model));
    return this.datas[world];
  }

  private field_cache = new Map<string, string | null>();

  /** The mjData field an `mjx.Data` leaf maps to, or null. */
  c_field(d: any, path: string, a: NDArray, batched: boolean): string | null {
    const cached = this.field_cache.get(path);
    if (cached !== undefined) return cached;
    const name = path.startsWith('_impl.') ? path.slice(6) : path;
    let result: string | null = null;
    if (!name.includes('.') && !(path.startsWith('_impl.') && is_dynamic_field(name))) {
      const value = d[name];
      const n = batched ? a.size / a.shape[0] : a.size;
      if (typeof value === 'number' ? n === 1 : value !== undefined && value !== null && value.length === n) result = name;
    }
    this.field_cache.set(path, result);
    return result;
  }

  /** The mjData field for an `mjx.Data` path with `n` values per world, or null (codegen fast path). */
  field_name(path: string, n: number): string | null {
    const d = this.data(0) as any;
    const name = path.startsWith('_impl.') ? path.slice(6) : path;
    if (name.includes('.') || (path.startsWith('_impl.') && is_dynamic_field(name))) return null;
    const value = d[name];
    if (typeof value === 'number') return n === 1 ? name : null;
    return value !== undefined && value !== null && value.length === n ? name : null;
  }

  is_input(name: string): boolean { return INPUT_FIELDS.has(name); }

  /** Single-world step with caller-provided copies in and out (codegen fast path). */
  direct(op: 'step' | 'forward', write: (d: any) => void, read: (d: any) => void) {
    this.calls++;
    const d = this.data(0);
    let t0 = performance.now();
    write(d);
    let t1 = performance.now();
    this.seconds.copy += (t1 - t0) / 1000;
    if (op === 'step') this.mujoco.mj_step(this.model, d);
    else this.mujoco.mj_forward(this.model, d);
    t0 = performance.now();
    this.seconds.physics += (t0 - t1) / 1000;
    read(d);
    this.seconds.copy += (performance.now() - t0) / 1000;
  }

  call(op: 'step' | 'forward', params: Record<string, any>, inputs: NDArray[]): NDArray[] {
    this.calls++;
    const paths: string[] = params.data_paths;
    const batched: boolean[] = params.data_batched;
    const data_in = inputs.slice(params.model_paths.length);
    const worlds = data_in.find((a, i) => batched[i])?.shape[0] ?? 1;
    // Results are new arrays only for fields physics writes; the rest pass through by reference
    // (the interpreter never mutates arrays in place).
    const d0 = this.data(0) as any;
    const names = paths.map((path, i) => this.c_field(d0, path, data_in[i], batched[i]));
    const outs = data_in.map((a, i) => (names[i] === null ? a : a.clone()));
    let t0 = performance.now();
    for (let w = 0; w < worlds; w++) {
      const d = this.data(w) as any;
      paths.forEach((path, i) => {
        if (!INPUT_FIELDS.has(path)) return;
        const a = data_in[i];
        const n = batched[i] ? a.size / a.shape[0] : a.size;
        const src = batched[i] ? a.data.subarray(w * n, (w + 1) * n) : a.data;
        if (path === 'time') {
          d.time = src[0];
        } else {
          (d[path] as Float64Array).set(src as ArrayLike<number>);
        }
      });
      let t1 = performance.now();
      this.seconds.copy += (t1 - t0) / 1000;
      if (op === 'step') this.mujoco.mj_step(this.model, d);
      else this.mujoco.mj_forward(this.model, d);
      t0 = performance.now();
      this.seconds.physics += (t0 - t1) / 1000;
      paths.forEach((path, i) => {
        const name = names[i];
        if (name === null) return;
        const value = d[name];
        const out = outs[i];
        const n = batched[i] ? out.size / out.shape[0] : out.size;
        if (typeof value === 'number') {
          out.data[batched[i] ? w : 0] = value;
        } else {
          const src = value as ArrayLike<number>;
          if (src.length !== n) throw new Error(`physics: ${path} has ${src.length} values, expected ${n}`);
          out.data.set(src, batched[i] ? w * n : 0);
        }
      });
      t1 = performance.now();
      this.seconds.copy += (t1 - t0) / 1000;
      t0 = t1;
    }
    return outs;
  }
}
