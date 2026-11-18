/**
 * The trained rat in closed loop: the job's environment and actor as compiled graphs (`../runtime`),
 * on MuJoCo WASM. Used by the simulation worker and by `scripts/make_demo_loop.ts` alike, so the live
 * demo and its recordings run the same code.
 *
 * A bundle (`public/rat-ncap/<model>/`) has the env half (`env/graph.{json,bin}`, `model.mjb`,
 * `manifest.json`), the actor half (`actor/graph.{json,bin}`, `manifest.json`), and parameter presets
 * (`params/params_<epoch>.{json,bin}`, listed in `params/index.json`).
 *
 * Mirrors the test-time policy, as the playground's worker does: on reset the actor's buffers are
 * rebuilt and its reset runs, and the env resets with the episode's subtask. The speed command
 * overrides the actor's `target_vx` observation (the task's own target follows on the next reset).
 */
import type { MainModule } from '@mujoco/mujoco';
import { Graph, type GraphJson } from '../runtime/graph.ts';
import { WasmPhysics } from '../runtime/physics.ts';
import { NDArray, full } from '../runtime/ndarray.ts';
import { set_randn } from '../runtime/torch_ops.ts';
import type { Geoms } from './protocol';

/** Reads a file of the bundle by its path relative to the bundle's root. */
export type Read = (path: string) => Promise<Uint8Array>;

type Session = ReturnType<Graph['session']>;
type SubtaskSpace = Record<string, { shape: number[]; low: number[]; high: number[] }>;

const RG_PREFIX = 'buffers/sim.rhythm_generation.';
const decoder = new TextDecoder();
const json_of = (bytes: Uint8Array) => JSON.parse(decoder.decode(bytes));

// mjtObj values (mujoco.h).
const mjOBJ_BODY = 1;
const mjOBJ_GEOM = 5;

/** Static geometry for renderers, from a MuJoCo model (a geom's colour is its material's, if it has one). */
export function model_geoms(mujoco: MainModule, m: WasmPhysics['model']): Geoms {
  const n = m.ngeom;
  const rgba: number[] = [];
  for (let i = 0; i < n; i++) {
    const mat = m.geom_matid[i];
    const source = mat >= 0 ? m.mat_rgba : m.geom_rgba;
    const offset = 4 * (mat >= 0 ? mat : i);
    for (let k = 0; k < 4; k++) rgba.push(source[offset + k]);
  }
  return {
    type: Array.from(m.geom_type as ArrayLike<number>),
    size: Array.from(m.geom_size as ArrayLike<number>),
    rgba,
    group: Array.from(m.geom_group as ArrayLike<number>),
    geom_bodyid: Array.from(m.geom_bodyid as ArrayLike<number>),
    body_parentid: Array.from(m.body_parentid as ArrayLike<number>),
    body_names: Array.from({ length: m.nbody }, (_, i) => mujoco.mj_id2name(m, mjOBJ_BODY, i) ?? `body${i}`),
    geom_names: Array.from({ length: n }, (_, i) => mujoco.mj_id2name(m, mjOBJ_GEOM, i) ?? ''),
  };
}

export class Rat {
  /** Simulated time per control step (s). */
  readonly dt: number;
  /** Control steps since the last reset. */
  steps = 0;
  /** Whether the task's termination has fired since the last reset (the rat fell). */
  terminated = false;
  /** The commanded forward speed (m/s). */
  target_vx = 0;

  private physics: WasmPhysics;
  private env_graph: Graph;
  private actor_graph: Graph;
  private env: Session;
  private actor: Session;
  private params: Map<string, NDArray>;
  private buffers = new Map<string, NDArray>();
  private observation_names: string[];
  private action_names: string[];
  private subtask_space: SubtaskSpace;
  private cache = new Map<string, NDArray>();  // Env outputs read since the last step.
  private episode = 0;

  private constructor(mujoco: MainModule, physics: WasmPhysics, env_graph: Graph, actor_graph: Graph, manifest: { timestep: { env: number }, subtask_space: SubtaskSpace }, params: Map<string, NDArray>) {
    this.mujoco = mujoco;
    this.physics = physics;
    this.env_graph = env_graph;
    this.actor_graph = actor_graph;
    this.dt = manifest.timestep.env;
    this.subtask_space = manifest.subtask_space;
    this.params = params;
    this.env = env_graph.session('env_step', n => (n.startsWith('state/') ? n : undefined));
    this.actor = actor_graph.session('actor_step', n => (n.startsWith('buffers/') ? n : undefined));
    const actor_entry = actor_graph.entry('actor_step');
    this.observation_names = actor_entry.inputs.filter(i => i.name.startsWith('observation/')).map(i => i.name);
    this.action_names = actor_entry.outputs.filter(o => o.name.startsWith('action/')).map(o => o.name);
  }

  private mujoco: MainModule;

  /**
   * Loads a bundle, starting from the parameter preset `params` (a path without extension, e.g.
   * `params/params_2500`). Compiling the graphs is synchronous, so call this in a worker.
   */
  static async load(read: Read, mujoco: MainModule, params: string): Promise<Rat> {
    const [env_json, env_bin, mjb, env_manifest, actor_json, actor_bin, actor_manifest, params_json, params_bin] = await Promise.all([
      read('env/graph.json'), read('env/graph.bin'), read('env/model.mjb'), read('env/manifest.json'),
      read('actor/graph.json'), read('actor/graph.bin'), read('actor/manifest.json'),
      read(`${params}.json`), read(`${params}.bin`),
    ]);
    const manifest = { ...json_of(env_manifest), ...json_of(actor_manifest) };
    if (mujoco.mj_versionString() !== manifest.mujoco_version) {
      throw new Error(`MuJoCo version mismatch: WASM ${mujoco.mj_versionString()}, bundle ${manifest.mujoco_version}`);
    }
    const env_graph = Graph.load(json_of(env_json) as GraphJson, env_bin);
    const actor_graph = Graph.load(json_of(actor_json) as GraphJson, actor_bin);
    const physics = WasmPhysics.load(mujoco, mjb);
    const rat = new Rat(mujoco, physics, env_graph, actor_graph, manifest, new Map());
    rat.params = rat.checked_params(Graph.load(json_of(params_json) as GraphJson, params_bin).values('actor_params'));
    rat.reset();
    // Run a few steps to build and warm the generated code, then start over.
    for (let i = 0; i < 3; i++) rat.step();
    rat.reset();
    return rat;
  }

  /** Static geometry for renderers, from the MuJoCo model. */
  geoms(): Geoms { return model_geoms(this.mujoco, this.physics.model); }

  /** Starts a new episode: the actor's state rebuilt, the body back in its starting pose. */
  reset() {
    set_randn('random', this.episode + 1);
    this.buffers = this.actor_graph.values('actor_buffers');
    for (const [k, v] of this.actor_graph.run('actor_reset', new Map([...this.params, ...this.buffers]))) {
      if (k.startsWith('buffers/')) this.buffers.set(k, v);
    }
    for (const [k, v] of [...this.params, ...this.buffers]) this.actor.set(k, v);
    const inputs = new Map<string, NDArray>(this.env_graph.values('env_state'));
    for (const i of this.env_graph.entry('env_reset').inputs) {
      if (i.name.startsWith('rng')) {
        const key = new NDArray(i.dtype, i.shape);
        key.data.set([0, this.episode], key.data.length - 2);
        inputs.set(i.name, key);
      } else if (i.name.startsWith('subtask/')) {
        inputs.set(i.name, this.subtask_value(i.name.slice('subtask/'.length), i.shape, i.dtype));
      }
    }
    const out = this.env_graph.run('env_reset', inputs, { physics: this.physics });
    for (const [k, v] of out) if (k.startsWith('state/')) this.env.set(k, v);
    this.cache = out;
    this.episode++;
    this.steps = 0;
    this.terminated = false;
  }

  /** A subtask input: the speed command for `target_vx`, otherwise the middle of its range. */
  private subtask_value(name: string, shape: number[], dtype: string): NDArray {
    const v = full(shape, 0, dtype);
    const spec = this.subtask_space[name];
    if (name === 'target_vx') v.data[0] = this.target_vx;
    else if (spec) spec.low.forEach((lo, j) => { v.data[j] = lo + (spec.high[j] - lo) / 2; });
    return v;
  }

  /** One control step: the actor reads the observation, then the env applies its action. */
  step() {
    for (const name of this.observation_names) {
      const v = this.get(name)!;
      const data = name === 'observation/target_vx' ? Float32Array.of(this.target_vx) : v.data;
      this.actor.set(name, new NDArray(v.dtype, v.shape.slice(1), data));
    }
    this.actor.step();
    for (const name of this.action_names) {
      const a = this.actor.get(name);
      this.env.set(name, new NDArray(a.dtype, [1, ...a.shape], a.data));
    }
    this.env.step({ physics: this.physics });
    this.cache = new Map();
    this.steps++;
    if (!this.terminated) this.terminated = (this.get('terminated')?.data[0] ?? 0) !== 0;
  }

  /** An env output after the last step or reset. */
  private get(name: string): NDArray | undefined {
    let v = this.cache.get(name);
    if (!v && this.env.outputs.includes(name)) {
      v = this.env.get(name);
      this.cache.set(name, v);
    }
    return v;
  }

  private data(name: string): Float32Array | Float64Array {
    const v = this.get(`state/mjx_data/${name}`);
    if (!v) throw new Error(`No ${name} in the environment's state.`);
    return v.data as Float32Array | Float64Array;
  }

  /** Geom poses: positions [ngeom * 3] and row-major rotations [ngeom * 9]. */
  geom_poses() { return { xpos: this.data('geom_xpos').slice(), xmat: this.data('geom_xmat').slice() }; }

  /** Body poses: positions [nbody * 3] and row-major rotations [nbody * 9]. */
  body_poses() { return { xpos: this.data('xpos').slice(), xmat: this.data('xmat').slice() }; }

  /** The torso's position (m), from the root free joint. */
  get position(): number[] { return Array.from(this.data('qpos').subarray(0, 3)); }

  /** The torso's yaw (rad). The policy has no heading feedback, so it drifts. */
  get heading(): number {
    const [w, x, y, z] = this.data('qpos').subarray(3, 7);
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }

  /** Forward speed along the heading (m/s), comparable to the command. */
  get speed(): number {
    const qvel = this.data('qvel');
    const h = this.heading;
    return qvel[0] * Math.cos(h) + qvel[1] * Math.sin(h);
  }

  /** Outputs of named rhythm-generation units (e.g. `flx_FL`); NaN where a unit is absent. */
  rhythm_outputs(names: string[]): number[] {
    return names.map(unit => {
      const name = `${RG_PREFIX}${unit}.value`;
      if (this.steps === 0) return this.buffers.get(name)?.data[0] ?? NaN;
      try {
        return this.actor.get(name).data[0];
      } catch {
        return NaN;
      }
    });
  }

  /** Swaps in a parameter preset (graph format), from the next step; nothing is reset. */
  load_preset(json: Uint8Array, bin: Uint8Array) {
    this.set_params(this.checked_params(Graph.load(json_of(json) as GraphJson, bin).values('actor_params')));
  }

  /**
   * Swaps in parameters from a state dict JSON (`{"actor.<name>": {shape, data}}`, e.g. from
   * `pt_to_json.py`). Checked against every parameter first, so a mismatched file changes nothing.
   */
  load_state_dict(json: unknown) {
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('Not a parameters file: expected a state dict JSON ({key: {shape, dtype, data}}).');
    }
    const dict = json as Record<string, { shape?: number[]; data?: number[] }>;
    const values = new Map<string, NDArray>();
    for (const input of this.param_inputs()) {
      const entry = dict[`actor.${input.name.slice('params/'.length)}`];
      if (!entry || !Array.isArray(entry.data)) continue;
      // A wrong-sized entry keeps its own length, so the check below reports it as mismatched.
      const right = entry.data.length === input.shape.reduce((a, b) => a * b, 1);
      values.set(input.name, new NDArray('float32', right ? [...input.shape] : [entry.data.length], Float32Array.from(entry.data)));
    }
    this.set_params(this.checked_params(values));
  }

  private param_inputs() {
    return this.actor_graph.entry('actor_step').inputs.filter(i => i.name.startsWith('params/'));
  }

  private checked_params(values: Map<string, NDArray>): Map<string, NDArray> {
    const problems = this.param_inputs()
      .filter(i => values.get(i.name)?.size !== i.shape.reduce((a, b) => a * b, 1))
      .map(i => `${values.has(i.name) ? 'mismatched' : 'missing'} ${i.name.slice('params/'.length)}`);
    if (problems.length) {
      const shown = problems.slice(0, 5).join('; ') + (problems.length > 5 ? `; ... (${problems.length} problems)` : '');
      throw new Error(`Parameters do not match this model's architecture: ${shown}`);
    }
    return values;
  }

  private set_params(values: Map<string, NDArray>) {
    this.params = values;
    for (const [k, v] of values) this.actor.set(k, v);
  }
}
