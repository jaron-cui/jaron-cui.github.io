/**
 * Port of `libs/composer/mjx_env.py`, for a single (unvectorized) environment.
 *
 * `MjxEnv` runs the per-environment logic of Python's `reset_one`/`step_one` directly instead of
 * through `jax.vmap`/`jax.lax.fori_loop`, on MuJoCo WASM (see `mujoco/mjx.ts`). Not ported:
 * vectorization (`vmap_state*`, `mj_model_vecfields`), autoreset masks in `reset`, the Warp
 * backend, and rendering.
 */
import * as jnp from '../jax/numpy';
import * as mj from '../mujoco';
import * as mjx from '../mujoco/mjx';
import * as collections from '../utils/collections';
import * as core from './core';

export class MjxEnvState implements core.BaseEnvState {
  mj_spec!: mj.MjSpec;
  mj_model!: mj.MjModel;
  mjx_model!: mjx.Model;
  mjx_data!: mjx.Data;
  env_timestep!: number;
  sim_timestep!: number;
  sim_substeps!: number;
  vectorize!: number;
  rng!: unknown;  // Unused here: no randomization in the ported entities.
  steps!: jnp.Array;  // [], int
  substeps!: jnp.Array;  // [], int
  terminated!: jnp.Array;  // [], bool
  local!: core.State;

  constructor(fields: Omit<MjxEnvState, 'replace'>) {
    Object.assign(this, fields);
  }

  replace(kwargs: Partial<Omit<MjxEnvState, 'replace'>>): this {
    return new MjxEnvState({ ...this, ...kwargs }) as this;
  }
}

export class MjxEntity<LocalState extends core.BaseLocalState | null> extends core.Entity<MjxEnvState, LocalState> {
  mj_spec: mj.MjSpec;

  constructor({
    children = {},
    transforms = [],
    local_state = null as LocalState,
    mj_spec = null,
  }: {
    children?: Record<string, MjxEntity<any> | null>,
    transforms?: (core.Transform<MjxEnvState, any> | false | null)[],
    local_state?: LocalState,
    mj_spec?: mj.MjSpec | null,
  } = {}) {
    super({ children, transforms, local_state });
    this.mj_spec = mj_spec !== null ? mj_spec : new mj.MjSpec();
  }
}

// Subtasks are currently a MjxTask concept, so provision and enforcement is not core-level like
// actions and observations are.
export type Subtask = collections.Mapping<jnp.Array>;
export type SubtaskSpace = core.Dict;
export type MjxTaskRewards = collections.Dict<[jnp.Array, jnp.Array]>;  // name -> (weight, value)
type StepReturns = [core.Observation, jnp.Array, jnp.Array, jnp.Array, core.Metrics];

export interface MjxTaskKwargs<LocalState> {
  children?: Record<string, MjxEntity<any> | null>;
  transforms?: (core.Transform<MjxEnvState, any> | false | null)[];
  local_state?: LocalState;
  mj_spec?: mj.MjSpec | null;
  mj_model_vecfields?: string[];
  mj_model_nconmax?: number | null;
  mj_model_njmax?: number | null;
  env_timestep?: number;
  sim_timestep?: number;
}

export class MjxTask<LocalState extends core.BaseLocalState | null> extends core.Entity<MjxEnvState, LocalState> {
  mj_spec: mj.MjSpec;
  mj_model_vecfields: string[];
  mj_model_nconmax: number | null;
  mj_model_njmax: number | null;
  env_timestep: number;
  sim_timestep: number;
  sim_substeps: number;

  constructor({
    children = {},
    transforms = [],
    local_state = null as LocalState,
    mj_spec = null,
    mj_model_vecfields = [],
    mj_model_nconmax = null,
    mj_model_njmax = null,
    env_timestep = 0.01,
    sim_timestep = 0.001,
  }: MjxTaskKwargs<LocalState> = {}) {
    super({ children, transforms, local_state });
    this.mj_spec = mj_spec !== null ? mj_spec : new mj.MjSpec();
    this.mj_model_vecfields = [...mj_model_vecfields];
    this.mj_model_nconmax = mj_model_nconmax;
    this.mj_model_njmax = mj_model_njmax;

    // Validate that the environment timestep is an integer multiple of the simulation timestep.
    console.assert(env_timestep >= sim_timestep && sim_timestep > 0);
    this.env_timestep = env_timestep;
    this.sim_timestep = sim_timestep;
    this.sim_substeps = Math.round(env_timestep / sim_timestep);
    console.assert(Math.abs(env_timestep / sim_timestep - this.sim_substeps) < 1e-3);

    // Set the simulation timestep. (Already compiled into the exported model; kept for reference.)
    this.mj_spec.option.timestep = this.sim_timestep;
  }

  subtask_space(state: MjxEnvState): SubtaskSpace {
    return new core.Dict();
  }

  /**
   * Callback at start of every episode to reset the environment state.
   * Commonly used to set initial positions and velocities, reset tracked state,
   * randomize MJX model/data, or recompile the MuJoCo model spec.
   */
  on_reset(state: MjxEnvState, subtask: Subtask): MjxEnvState {
    return state;
  }

  on_step_start(state: MjxEnvState, action: core.Action): MjxEnvState {
    return state;
  }

  on_substep_start(state: MjxEnvState, action: core.Action): MjxEnvState {
    return state;
  }

  on_substep_end(state: MjxEnvState, action: core.Action): MjxEnvState {
    return state;
  }

  on_step_end(state: MjxEnvState, action: core.Action): MjxEnvState {
    return state;
  }

  get_terminated(state: MjxEnvState): jnp.Array {
    return jnp.zeros([], { dtype: 'bool' });
  }

  get_rewards(state: MjxEnvState, terminated: jnp.Array): MjxTaskRewards {
    return new collections.Dict();
  }

  get_reward(rewards: MjxTaskRewards): jnp.Array {
    return rewards.values().reduce((sum, [w, v]) => sum.add(w.mul(v)), jnp.zeros([]));
  }

  get_metrics(state: MjxEnvState, terminated: jnp.Array, rewards: MjxTaskRewards): core.Metrics {
    return new collections.Dict([
      ...rewards.items().map(([k, [w]]) => [`reward/weight/${k}`, w] as [string, jnp.Array]),
      ...rewards.items().map(([k, [, v]]) => [`reward/value/${k}`, v] as [string, jnp.Array]),
    ]);
  }
}

export class MjxEnv {
  task: MjxTask<any>;
  truncate: number | null;
  backend: 'jax';

  constructor({
    task,
    truncate = null,
    backend = 'jax',
  }: {
    task: MjxTask<any>,
    truncate?: number | null,
    backend?: 'jax',
  }) {
    console.assert(truncate === null || truncate > 0);
    if (backend !== 'jax') throw new Error(`Backend '${backend}' is not supported.`);

    // Initialize all state index in the task pytree.
    this.task = core.initialize_state_index(task);
    this.truncate = truncate;
    this.backend = backend;
  }

  /** Initializes the environment state (a single environment; Python vectorizes over `rng`). */
  initialize(rng: unknown = null): MjxEnvState {
    // Construct mj model from spec (the exported compiled model; see `mujoco/index.ts`).
    const mj_spec = this.task.mj_spec;
    const mj_model = mj_spec.compile();

    // Construct mjx model and mjx data.
    const mjx_model = mjx.put_model(mj_model);
    const mjx_data = mjx.make_data(mj_model);

    // Construct environment and local state.
    let state = new MjxEnvState({
      mj_spec: mj_spec,
      mj_model: mj_model,
      mjx_model: mjx_model,
      mjx_data: mjx_data,
      env_timestep: this.task.env_timestep,
      sim_timestep: this.task.sim_timestep,
      sim_substeps: this.task.sim_substeps,
      vectorize: 1,
      rng: rng,
      steps: jnp.zeros([], { dtype: 'int32' }),
      substeps: jnp.zeros([], { dtype: 'int32' }),
      terminated: jnp.zeros([], { dtype: 'bool' }),
      local: new core.State(this.task, false),  // Structure can change during initialize.
    });
    state = core.entity_initialize(this.task, state, {});
    state = state.replace({ local: state.local.freeze() });  // Structure now frozen.
    return state;
  }

  /** Resets the environment state (Python's `reset_one`). */
  reset(state: MjxEnvState, rng: unknown = null, subtask: Subtask | null = null): core.Step<MjxEnvState> {
    subtask = subtask ?? new collections.Dict();
    this.subtask_space(state).validate(subtask);

    // Reset the random state and local state for each episode.
    state = state.replace({
      rng: rng,
      steps: jnp.zeros([], { dtype: 'int32' }),
      substeps: jnp.zeros([], { dtype: 'int32' }),
      terminated: jnp.zeros([], { dtype: 'bool' }),
    });
    state = core.entity_reset(this.task, state);

    // Task is responsible for resetting the mj/mjx state to permit flexibility. In the typical
    // case, it randomizes the `mjx_model`, makes the empty `mjx_data`, then initializes the
    // `mjx_data` by invoking entity methods. In more complex cases, it creates a new `mj_spec`
    // and recompiles it to `mj_model`.
    state = this.task.on_reset(state, subtask);

    // Update `mjx_data` after modifying values (e.g. qpos) to ensure all fields are fresh.
    state = state.replace({ mjx_data: mjx.forward(state.mjx_model, state.mjx_data) });

    // Construct the step contents.
    let observation: core.Observation;
    [observation, state] = core.entity_observation(this.task, state);
    const terminated = jnp.zeros([], { dtype: 'bool' });
    const truncated = jnp.zeros([], { dtype: 'bool' });
    let rewards = this.task.get_rewards(state, terminated);
    rewards = new collections.Dict(rewards.items().map(([k, [w, v]]) => [k, [w, jnp.zeros_like(v)]]));
    const reward = jnp.zeros([]);
    const metrics = this.task.get_metrics(state, terminated, rewards);
    return new core.Step({ state, observation, reward, terminated, truncated, metrics });
  }

  /** Perform an environment step comprising multiple simulation substeps (Python's `step_one`). */
  step(state: MjxEnvState, action: core.Action): core.Step<MjxEnvState> {
    const substep_one = (state: MjxEnvState): MjxEnvState => {
      // Increment substeps at start, so that task/entities can use the substep number.
      state = state.replace({ substeps: state.substeps.add(1) });
      state = this.task.on_substep_start(state, action);
      state = core.entity_action(this.task, state, action);
      state = state.replace({ mjx_data: mjx.step(state.mjx_model, state.mjx_data) });
      state = this.task.on_substep_end(state, action);
      return state;
    };

    // Increment steps at start, so that task/entities can use the step number.
    state = state.replace({ steps: state.steps.add(1) });
    state = this.task.on_step_start(state, action);

    // Run all substeps except last, discarding intermediate observations (which still update
    // stateful transforms, e.g. controllers that store the last observed positions).
    for (let i = 0; i < this.task.sim_substeps - 1; i++) {
      state = substep_one(state);
      [, state] = core.entity_observation(this.task, state, { discard: true });
    }
    // Run the last substep manually to enable `task.on_substep_end()` to possibly modify the
    // state before rendering and constructing the step.
    state = substep_one(state);
    state = this.task.on_step_end(state, action);

    // Get the `observation`/`terminated`/`reward` from the final state of the environment step.
    // Once `terminated = True` in an episode, all subsequent `terminated = True` and `reward = 0`.
    // Once `truncated = True` in an episode all subsequent `truncated = True` due to >= check.
    let observation: core.Observation;
    [observation, state] = core.entity_observation(this.task, state);
    const terminated = this.task.get_terminated(state).to('bool').or(state.terminated);
    const truncated = this.truncate === null ? jnp.zeros([], { dtype: 'bool' }) : state.steps.ge(this.truncate);
    const rewards = this.task.get_rewards(state, terminated);
    const reward = this.task.get_reward(rewards).mul(state.terminated.not().float());
    const metrics = this.task.get_metrics(state, terminated, rewards);

    state = state.replace({ terminated: terminated });
    return new core.Step({ state, observation, reward, terminated, truncated, metrics });
  }

  subtask_space(state: MjxEnvState): SubtaskSpace {
    return this.task.subtask_space(state);
  }

  action_space(state: MjxEnvState): core.ActionSpace {
    return core.entity_action_space(this.task, state);
  }

  observation_space(state: MjxEnvState): core.ObservationSpace {
    return core.entity_observation_space(this.task, state);
  }
}
