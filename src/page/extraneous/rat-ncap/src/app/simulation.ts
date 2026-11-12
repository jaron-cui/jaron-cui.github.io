/**
 * The interactive simulation: the trained actor controlling the rat in MuJoCo (WASM), with a
 * commanded forward velocity that can change at any time. Platform-neutral (no DOM, no Node APIs):
 * files are read through a caller-supplied `read` function, so it runs both in a browser Web Worker
 * (`fetch`) and in Node (`fs`, for headless checks).
 */
import loadMujoco, { type MainModule } from '@mujoco/mujoco';
import * as torch from '../torch';
import * as mj from '../mujoco';
import * as core from '../composer/core';
import * as cxe from '../composer/mjx_env';
import { instantiate } from '../hydra';
import { REGISTRY } from '../registry';
import { type TensorJson, space_from_json, state_dict_from_json } from '../io';
import { InteractiveLocomotion, interactive_env_config } from '../envs/tasks/interactive_locomotion';
import type { ActorOnly } from '../tonic/torch/models';
import type { QuadrupedModularActor } from '../models/ncap';

/** Reads a file of an exported checkpoint (`python/export.py` + `python/export_env.py`). */
export type Read = (name: string) => Promise<Uint8Array>;

export interface SimulationOptions {
  /** Options passed to the MuJoCo WASM module factory, e.g. `locateFile` for the `.wasm` file. */
  mujoco_options?: Record<string, unknown>;
  /** Seed for the actor's noise (RG oscillators). */
  seed?: number;
}

const decoder = new TextDecoder();
const read_json = async (read: Read, name: string) => JSON.parse(decoder.decode(await read(name)));

export class Simulation {
  mujoco: MainModule;
  env: cxe.MjxEnv;
  task: InteractiveLocomotion;
  model: ActorOnly<QuadrupedModularActor>;
  state: cxe.MjxEnvState;
  observation!: core.Observation;
  terminated = false;

  private constructor(mujoco: MainModule, env: cxe.MjxEnv, model: ActorOnly<QuadrupedModularActor>) {
    this.mujoco = mujoco;
    this.env = env;
    this.task = env.task as InteractiveLocomotion;
    this.model = model;
    this.state = env.initialize();
  }

  static async load(read: Read, { mujoco_options = {}, seed = 0 }: SimulationOptions = {}): Promise<Simulation> {
    const [mujoco, model_mjb, specs_json, env_config, agent_config, observation_space, action_space, state_dict] =
      await Promise.all([
        loadMujoco(mujoco_options),
        read('model.mjb'),
        read_json(read, 'specs.json'),
        read_json(read, 'env_config.json'),
        read_json(read, 'agent_config.json'),
        read_json(read, 'observation_space.json'),
        read_json(read, 'action_space.json'),
        read_json(read, 'state_dict.json'),
      ]);
    mj.load_assets({ mujoco, model_mjb, specs_json });
    torch.manual_seed(seed);

    // Environment: the training env config, with the task swapped for the interactive one.
    const env = instantiate(interactive_env_config(env_config), REGISTRY) as cxe.MjxEnv;

    // Actor: the trained model.
    const model = instantiate(agent_config.model, REGISTRY) as ActorOnly<QuadrupedModularActor>;
    model.initialize(space_from_json(observation_space), space_from_json(action_space));
    model.load_state_dict(state_dict_from_json(state_dict));

    const simulation = new Simulation(mujoco, env, model);
    simulation.reset();
    return simulation;
  }

  get actor(): QuadrupedModularActor {
    return this.model.actor;
  }

  /** Simulated time (s) since the last reset. */
  get time(): number {
    return this.state.steps.item() * this.state.env_timestep;
  }

  get target_vx(): number {
    return this.task.get_target_vx(this.state);
  }

  /** Velocity of the rat along the world x-axis (m/s), as tracked by the training reward. */
  get vx(): number {
    return this.task.get_vx(this.state);
  }

  /** Heading (yaw) of the rat's torso (rad). The policy has no heading feedback, so it drifts. */
  get heading(): number {
    const [w, x, y, z] = this.task.body.get_root_global_quat(this.state).tolist();
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }

  /** Forward speed of the rat along its heading (m/s), comparable to the command. */
  get speed(): number {
    const [vx, vy] = this.task.body.get_root_global_linvel(this.state).tolist();
    return vx * Math.cos(this.heading) + vy * Math.sin(this.heading);
  }

  /** Torso position (m), e.g. for a following camera. */
  get position(): number[] {
    return this.task.body.get_root_global_pos(this.state).tolist();
  }

  /** Resets the rat to its initial pose and the actor to its initial state, keeping the command. */
  reset() {
    const step = this.env.reset(this.state);
    this.state = step.state;
    this.observation = step.observation;
    this.terminated = false;
    this.actor.reset(null);
  }

  /**
   * Swaps in new actor parameters (a `state_dict.json`, e.g. from `python/pt_to_json.py`), effective
   * from the next control step; the simulation and the actor's state (e.g. the RG) keep running.
   * The file must match this model's architecture: it is validated against every key and shape
   * before anything is loaded, so an incompatible file leaves the model unchanged.
   */
  load_parameters(json: Record<string, TensorJson>) {
    const malformed = Object.entries(json ?? {}).filter(([, v]) =>
      typeof v !== 'object' || v === null || !Array.isArray(v.shape) || !Array.isArray(v.data));
    if (json === null || typeof json !== 'object' || Array.isArray(json) || malformed.length) {
      throw new Error(
        'Not a parameters file: expected a state dict JSON ({key: {shape, dtype, data}}, e.g. from ' +
        '`python/pt_to_json.py` or an export\'s `state_dict.json`)' +
        (malformed.length ? `; malformed entries: ${malformed.slice(0, 3).map(([k]) => k).join(', ')}` : '') + '.',
      );
    }
    const state_dict = state_dict_from_json(json);
    const own = this.model.state_dict();
    const errors: string[] = [];
    for (const [key, tensor] of own) {
      const value = state_dict.get(key);
      if (value === undefined) errors.push(`missing ${key}`);
      else if (value.shape.join() !== tensor.shape.join()) errors.push(`${key}: shape [${value.shape}], expected [${tensor.shape}]`);
    }
    // The constrainer's entries are not used at inference (see `models.Constrainer`).
    const unexpected = [...state_dict.keys()].filter(k => !own.has(k) && !k.startsWith('actor.constrainer.'));
    errors.push(...unexpected.map(k => `unexpected ${k}`));
    if (errors.length) {
      const shown = errors.slice(0, 5).join('; ') + (errors.length > 5 ? `; ... (${errors.length} problems)` : '');
      throw new Error(`Parameters do not match this model's architecture: ${shown}`);
    }
    this.model.load_state_dict(state_dict);
  }

  set_target_vx(target_vx: number) {
    this.state = this.task.set_target_vx(this.state, target_vx);
  }

  /** Advances one control step (`env_timestep`, 30 ms): actor inference, then 30 physics substeps. */
  step() {
    // The observation's `target_vx` reflects the command at the end of the previous step; refresh it
    // so a command change applies on this step.
    const observation = this.observation.copy();
    observation.setitem('target_vx', torch.tensor([this.target_vx]));
    const action = this.actor.forward(observation);
    const step = this.env.step(this.state, action);
    this.state = step.state;
    this.observation = step.observation;
    this.terminated = this.terminated || step.terminated.item() !== 0;
  }

  /** Geom poses for rendering: positions [ngeom, 3] and rotation matrices [ngeom, 9] (row-major). */
  geom_poses(): { xpos: Float64Array, xmat: Float64Array } {
    const data = this.state.mjx_data.raw as unknown as { geom_xpos: Float64Array, geom_xmat: Float64Array };
    return { xpos: data.geom_xpos.slice(), xmat: data.geom_xmat.slice() };
  }

  /** Current outputs of named rhythm-generation units (e.g. `flx_FL`, `cross_v0d_HR`); NaN if absent. */
  rhythm_outputs(names: string[]): number[] {
    const rg = this.actor.sim?.rhythm_generation as Record<string, unknown> | undefined;
    return names.map(name => {
      const unit = rg?.[name] as { value?: { item(): number } } | undefined;
      return unit?.value ? unit.value.item() : NaN;
    });
  }

  /** World poses of the bodies (positions [nbody*3], row-major rotations [nbody*9]), for rigs. */
  body_poses(): { xpos: Float64Array, xmat: Float64Array } {
    const data = this.state.mjx_data.raw as unknown as { xpos: Float64Array, xmat: Float64Array };
    return { xpos: data.xpos.slice(), xmat: data.xmat.slice() };
  }
}
