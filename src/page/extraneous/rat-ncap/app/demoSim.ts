/**
 * The homepage demo's rat: the demo-only bundle (`public/rat-ncap/<model>-demo/`, from figs'
 * `compile_demo.py`) run by `../runtime/demo_rat.ts` on the minimal MuJoCo module (`mujoco-slim`:
 * load an .mjb and step it, 0.35 MB gzipped instead of 1.4 MB; `../runtime/slim_physics.ts`). Its env keeps only the observation -> action ->
 * physics loop, its model only physics, and its actor has the shown parameters built in: no reward,
 * no general reset (four precomputed starts, taken in turn), no parameter swapping.
 *
 * Offers the same surface as `Rat` where the worker and `make_demo_loop.ts` use it.
 */
import type loadMujocoSlim from 'mujoco-slim';
import { DemoRat } from '../runtime/demo_rat.ts';
import { SlimPhysics } from '../runtime/slim_physics.ts';
import type { GraphJson } from '../runtime/graph.ts';
import { model_geoms, type Read } from './rat';
import type { Geoms } from './protocol';

const decoder = new TextDecoder();
const json_of = (bytes: Uint8Array) => JSON.parse(decoder.decode(bytes));
/** An mjData field: float32 from the graph, float64 from MuJoCo. */
type Field = Float32Array | Float64Array;

export class DemoSim {
  /** Commanded forward speed (m/s), sent as the actor's target_vx observation every step. */
  target_vx = 0.4;
  /** Simulated time per control step (s). */
  readonly dt: number;
  private rat: DemoRat;
  private physics: SlimPhysics;
  private resets: number;
  private episode = 0;

  private constructor(physics: SlimPhysics, rat: DemoRat, manifest: { timestep: { env: number }; resets: number }) {
    this.physics = physics;
    this.rat = rat;
    this.dt = manifest.timestep.env;
    this.resets = manifest.resets;
  }

  /**
   * Loads a demo bundle on the minimal MuJoCo module (`factory`, from `mujoco-slim`; `options` go to
   * it, e.g. `locateFile`). Compiling the graphs is synchronous, so call this in a worker.
   */
  static async load(read: Read, factory: typeof loadMujocoSlim, options: object = {}): Promise<DemoSim> {
    const [env_json, env_bin, mjb, env_manifest, actor_json, actor_bin] = await Promise.all([
      read('env/graph.json'), read('env/graph.bin'), read('env/model.mjb'), read('env/manifest.json'),
      read('actor/graph.json'), read('actor/graph.bin'),
    ]);
    const manifest = json_of(env_manifest);
    const physics = await SlimPhysics.create(factory as Parameters<typeof SlimPhysics.create>[0], mjb, options);
    if (physics.version !== manifest.mujoco_version) {
      throw new Error(`MuJoCo version mismatch: WASM ${physics.version}, bundle ${manifest.mujoco_version}`);
    }
    const rat = DemoRat.create(physics, {
      env_json: json_of(env_json) as GraphJson, env_bin, mjb, actor_json: json_of(actor_json) as GraphJson, actor_bin,
    }, manifest);
    const sim = new DemoSim(physics, rat, manifest);
    // Run a few steps to build and warm the generated code, then start over.
    rat.reset(0);
    for (let i = 0; i < 3; i++) rat.step(sim.target_vx);
    sim.reset();
    return sim;
  }

  geoms(): Geoms { return model_geoms(this.physics.model, (kind, id) => this.physics.id2name(kind, id)); }

  /** Starts a new episode from the next of the bundle's precomputed starts. */
  reset() {
    this.rat.reset(this.episode++ % this.resets);
  }

  step() { this.rat.step(this.target_vx); }

  get steps() { return this.rat.steps; }
  get terminated() { return this.rat.terminated; }

  geom_poses(): { xpos: Field; xmat: Field } {
    return { xpos: this.rat.data('geom_xpos').data as Field, xmat: this.rat.data('geom_xmat').data as Field };
  }

  body_poses(): { xpos: Field; xmat: Field } {
    return { xpos: this.rat.data('xpos').data as Field, xmat: this.rat.data('xmat').data as Field };
  }

  get position(): number[] { return Array.from(this.rat.data('qpos').data.subarray(0, 3)); }
  get heading(): number { return this.rat.root().yaw; }
  get speed(): number { return this.rat.root().speed; }

  /** Outputs of named rhythm-generation units (e.g. `flx_FL`); NaN where a unit is absent. */
  rhythm_outputs(names: string[]): number[] {
    return names.map(unit => {
      try {
        return this.rat.rg(unit);
      } catch {
        return NaN;
      }
    });
  }
}
