/**
 * Demo runner for a demo env bundle (python/compile_demo.py) plus an actor bundle whose built-in
 * parameters are the ones to show: observation -> actor -> action -> physics, nothing else.
 *
 *   const rat = DemoRat.create(mujoco, { env_json, env_bin, mjb, actor_json, actor_bin });
 *   rat.reset(0);                       // one of the bundle's precomputed resets (manifest.resets)
 *   rat.step(0.4);                      // one 30 ms control step at target_vx 0.4 m/s
 *   rat.data('xpos'); rat.rg('flx_FL'); rat.terminated;
 *
 * The actor's parameters are fixed at creation, so everything computed from them alone (weight
 * transposes, concatenations, ...) is evaluated once (Graph.session's `fixed`).
 */
import type { MainModule } from '@mujoco/mujoco';
import { Graph, type GraphJson } from './graph.ts';
import { WasmPhysics } from './physics.ts';
import { NDArray } from './ndarray.ts';
import { set_randn } from './torch_ops.ts';

export interface DemoFiles {
  env_json: GraphJson; env_bin: ArrayBuffer | Uint8Array; mjb: Uint8Array;
  actor_json: GraphJson; actor_bin: ArrayBuffer | Uint8Array;
}

export type DataField = 'qpos' | 'qvel' | 'xpos' | 'xmat' | 'xquat' | 'geom_xpos' | 'geom_xmat';

export class DemoRat {
  physics: WasmPhysics;
  terminated = false;
  steps = 0;
  private env_graph: Graph;
  private actor_graph: Graph;
  private env;
  private actor;
  private params: Map<string, NDArray>;
  private obs_names: string[];
  private act_names: string[];
  private data_outputs: Record<DataField, string>;
  private obs = new Map<string, NDArray>();
  private target = new NDArray('float32', [1]);
  /** Until the first step after a reset, data() reads the reset pose (mj_forward) from mjData. */
  private at_reset = false;

  private constructor(mujoco: MainModule, f: DemoFiles, manifest: { data_outputs: Record<DataField, string> }) {
    this.env_graph = Graph.load(f.env_json, f.env_bin);
    this.actor_graph = Graph.load(f.actor_json, f.actor_bin);
    this.physics = WasmPhysics.load(mujoco, f.mjb);
    this.data_outputs = manifest.data_outputs;
    this.params = this.actor_graph.values('actor_params');
    this.env = this.env_graph.session('env_step', n => (n.startsWith('state/') ? n : undefined));
    this.actor = this.actor_graph.session('actor_step', n => (n.startsWith('buffers/') ? n : undefined), this.params);
    const a = this.actor_graph.entry('actor_step');
    this.obs_names = a.inputs.filter(i => i.name.startsWith('observation/')).map(i => i.name);
    this.act_names = a.outputs.filter(o => o.name.startsWith('action/')).map(o => o.name);
    set_randn('zeros');  // Deterministic (the actor's oscillator noise off).
  }

  /** `manifest` is the env bundle's manifest.json. */
  static create(mujoco: MainModule, files: DemoFiles, manifest: any): DemoRat {
    return new DemoRat(mujoco, files, manifest);
  }

  /** Starts an episode from precomputed reset `k`. */
  reset(k = 0) {
    const r = this.env_graph.values(`reset/${k}`);
    if (!r.size) throw new Error(`no reset/${k}`);
    const live = new Set(this.env_graph.entry('env_step').inputs.map(i => i.name));
    this.obs.clear();
    for (const [name, v] of r) {
      if (live.has(name)) this.env.set(name, v);
      else if (name.startsWith('observation/')) this.obs.set(name, v);
    }
    const buffers = this.actor_graph.values('actor_buffers');
    for (const [k2, v] of this.actor_graph.run('actor_reset', new Map([...this.params, ...buffers]))) if (k2.startsWith('buffers/')) buffers.set(k2, v);
    for (const [k2, v] of buffers) this.actor.set(k2, v);
    // The pose at reset: forward kinematics of the reset qpos/qvel (mj_step copies every input
    // field in again on the next step, so using the session's mjData here is harmless).
    const d = this.physics.data(0) as any;
    d.qpos.set(r.get('state/mjx_data/qpos')!.data);
    d.qvel.set(r.get('state/mjx_data/qvel')!.data);
    this.physics.mujoco.mj_forward(this.physics.model, d);
    this.at_reset = true;
    this.terminated = false;
    this.steps = 0;
  }

  /** One control step (manifest timestep.env seconds) commanding forward speed `target_vx` (m/s). */
  step(target_vx: number) {
    this.target.data[0] = target_vx;
    for (const n of this.obs_names) {
      if (n === 'observation/target_vx') { this.actor.set(n, this.target); continue; }
      const v = this.obs.get(n)!;
      this.actor.set(n, new NDArray(v.dtype, v.shape.slice(1), v.data));
    }
    this.actor.step();
    for (const n of this.act_names) {
      const a = this.actor.get(n);
      this.env.set(n, new NDArray(a.dtype, [1, ...a.shape], a.data));
    }
    this.env.step({ physics: this.physics });
    for (const n of this.obs_names) if (n !== 'observation/target_vx') this.obs.set(n, this.env.get(n));
    this.terminated ||= this.env.get('terminated').data[0] !== 0;
    this.at_reset = false;
    this.steps++;
  }

  /** An mjData field after the last step, or at the reset pose right after reset() ([1, ...], float32, a copy). */
  data(field: DataField): NDArray {
    if (!this.at_reset) return this.env.get(this.data_outputs[field]);
    const m = this.physics.model as any;
    const shape = ({
      qpos: [m.nq], qvel: [m.nv], xpos: [m.nbody, 3], xmat: [m.nbody, 3, 3], xquat: [m.nbody, 4],
      geom_xpos: [m.ngeom, 3], geom_xmat: [m.ngeom, 3, 3],
    } as Record<DataField, number[]>)[field];
    return new NDArray('float32', [1, ...shape], Float32Array.from((this.physics.data(0) as any)[field] as ArrayLike<number>));
  }

  /** A rhythm-generation unit's output, e.g. 'flx_FL', 'ext2_HR'. */
  rg(unit: string): number { return this.actor.get(`buffers/sim.rhythm_generation.${unit}.value`).data[0]; }

  /** Speed along the heading and heading yaw, from the root free joint. */
  root(): { speed: number; yaw: number; height: number } {
    const q = this.data('qpos').data, v = this.data('qvel').data;
    const [w, x, y, z] = [q[3], q[4], q[5], q[6]];
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return { speed: v[0] * Math.cos(yaw) + v[1] * Math.sin(yaw), yaw, height: q[2] };
  }
}
