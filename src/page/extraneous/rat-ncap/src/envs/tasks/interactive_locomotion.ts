/**
 * An interactive locomotion task for the browser (TypeScript-only; not a port).
 *
 * It keeps what a policy trained on `envs.tasks.MoveAtFixedVelocity_*` depends on: the same
 * children (arena and body), the `target_vx` observation, the reset pose (`body.init_pose`), and the
 * termination conditions of `MoveAtFixedVelocity`. Training-only parts are dropped: subtasks, reward
 * weights and rewards, warmup, and the root harness (whose gains are zero in the trained configs).
 *
 * The commanded forward velocity lives in the task's local state and is changed between steps with
 * `set_target_vx(state, vx)` (e.g. from a UI slider), rather than being fixed by a subtask at reset.
 */
import * as jnp from '../../jax/numpy';
import * as mj from '../../mujoco';
import * as cx from '../../composer/core';
import * as cxe from '../../composer/mjx_env';
import * as collections from '../../utils/collections';
import { Floor } from '../arenas/floor';
import { Rat } from '../bodies/rat/rat';

type MjxEnvState = cxe.MjxEnvState;

export class InteractiveLocomotionState extends cx.BaseLocalState {
  target_vx: jnp.Array = jnp.zeros([]);  // [], float (m/s)
}

export interface InteractiveLocomotionKwargs {
  body: Rat;
  arena?: Floor | null;
  termination_roll?: number;  // (deg)
  termination_pitch?: number;  // (deg)
  min_vx?: number;
  max_vx?: number;
  env_timestep?: number;
  sim_timestep?: number;
}

export class InteractiveLocomotion extends cxe.MjxTask<InteractiveLocomotionState> {
  _termination_roll: number;
  _termination_pitch: number;
  _min_vx: number;
  _max_vx: number;
  _contact_sensors: mj.MjsSensor[];

  constructor({
    body,
    arena = null,
    termination_roll = 45.,
    termination_pitch = 45.,
    min_vx = -5.0,
    max_vx = 5.0,
    env_timestep = 0.03,
    sim_timestep = 0.001,
  }: InteractiveLocomotionKwargs) {
    super({
      children: { arena: arena ?? new Floor(), body: body },
      local_state: new InteractiveLocomotionState(),
      env_timestep,
      sim_timestep,
    });
    // Orientation: roll = right down (+wx), pitch = front down (+wy).
    console.assert(0 < termination_roll && termination_roll <= 180);
    console.assert(0 < termination_pitch && termination_pitch <= 180);
    this._termination_roll = termination_roll;
    this._termination_pitch = termination_pitch;
    this._min_vx = min_vx;
    this._max_vx = max_vx;
    // Contact termination sensors, added to the compiled model by `MoveAtFixedVelocity` in Python.
    this._contact_sensors = body.get_termination_contact_geoms().map(geom => new mj.MjsSensor(`contact_floor_${geom}`));
  }

  get body(): Rat {
    return this.children.getitem('body') as Rat;
  }

  // ------------------------------------------------------------------------------------------------
  // Interactive commands

  /** Sets the commanded forward velocity (m/s), clipped to `[min_vx, max_vx]`. */
  set_target_vx(state: MjxEnvState, target_vx: number): MjxEnvState {
    let local = state.local.get(this.index);
    local = local.replace({ target_vx: jnp.clip(jnp.asarray(target_vx), this._min_vx, this._max_vx) });
    return state.replace({ local: state.local.set(this.index, local) });
  }

  get_target_vx(state: MjxEnvState): number {
    return state.local.get(this.index).target_vx.item();
  }

  /** Forward velocity of the root along the world x-axis (m/s), as tracked by the training reward. */
  get_vx(state: MjxEnvState): number {
    return this.body.get_root_global_linvel(state).index(0).item();
  }

  // ------------------------------------------------------------------------------------------------
  // Task

  override on_reset(state: MjxEnvState, subtask: cxe.Subtask): MjxEnvState {
    state = super.on_reset(state, subtask);
    return this.body.init_pose(state);
  }

  override get_terminated(state: MjxEnvState): jnp.Array {
    const rpy = this.body.get_sensor_rpy(state);
    let terminated = jnp.logical_or(
      jnp.abs(rpy.index(0)).gt(this._termination_roll * (Math.PI / 180)),
      jnp.abs(rpy.index(1)).gt(this._termination_pitch * (Math.PI / 180)),
    );
    if (this._contact_sensors.length > 0) {
      const contacts = state.mjx_data.bind(state.mjx_model, this._contact_sensors).sensordata;  // [sensors]
      terminated = terminated.or(jnp.any(contacts));
    }
    return terminated;
  }

  override observation_space(state: MjxEnvState): cx.ObservationSpace {
    const space = new cx.Dict();
    space.setitem('target_vx', new cx.Box({
      low: this._min_vx,
      high: this._max_vx,
      shape: [1],
      name: 'target_vx:[tvx]',
      desc: 'Target linear velocity along x-axis in body frame (m/s)',
    }));
    return space;
  }

  override observation(state: MjxEnvState): [cx.ArrayDict, MjxEnvState] {
    const observation: cx.ArrayDict = new collections.OrderedDict();
    observation.setitem('target_vx', state.local.get(this.index).target_vx.reshape(1));
    return [observation, state];
  }
}

/**
 * Converts a training env config (e.g. with `envs.tasks.MoveAtFixedVelocity_TrackSmooth`) into an
 * `InteractiveLocomotion` env config, keeping the body, arena, timesteps, and termination settings.
 */
export function interactive_env_config(env_config: Record<string, any>): Record<string, any> {
  const task = env_config['task'];
  const keep = ['body', 'arena', 'env_timestep', 'sim_timestep', 'termination_roll', 'termination_pitch'];
  return {
    _target_: env_config['_target_'],
    task: {
      _target_: 'web.envs.tasks.InteractiveLocomotion',
      ...Object.fromEntries(keep.filter(k => k in task).map(k => [k, task[k]])),
    },
  };
}

