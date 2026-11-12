/**
 * Parity test of the ported environment code (body observation and action/controller pipelines,
 * composer transforms, MuJoCo bindings) against a saved training rollout, without physics: each
 * recorded state is restored (MuJoCo data fields and controller local states), then
 * - one substep of `entity_action` on the recorded action must produce Python's actuator controls;
 * - `entity_observation` must produce the recorded observation.
 * Also checks the spring-muscle parameters computed at initialization.
 *
 * Usage: tsx test/env_trace.test.ts [data/env_trace.json] [data/1_4_flxext]
 */
import fs from 'node:fs';
import path from 'node:path';
import loadMujoco from '@mujoco/mujoco';
import * as torch from '../src/torch';
import * as mj from '../src/mujoco';
import * as mjx from '../src/mujoco/mjx';
import * as core from '../src/composer/core';
import * as cxe from '../src/composer/mjx_env';
import * as collections from '../src/utils/collections';
import { instantiate } from '../src/hydra';
import { REGISTRY } from '../src/registry';
import { InteractiveLocomotion, interactive_env_config } from '../src/envs/tasks/interactive_locomotion';
import { ErrorTracker, check, exit, load_json } from './util';

const TOLERANCE = 1e-5;

type Values = Record<string, number[]>;
interface StepGolden {
  data: Values;
  local: Record<string, Values>;
  observation: Values;
  action: Values;
  ctrl: number[];
}
interface Golden {
  envs: { env: number, target_vx: number, steps: StepGolden[] }[];
}

const golden = load_json<Golden>(process.argv[2] ?? 'data/env_trace.json');
const dir = process.argv[3] ?? 'data/1_4_flxext';
const read = (name: string) => fs.readFileSync(path.join(dir, name));

mj.load_assets({
  mujoco: await loadMujoco(),
  model_mjb: new Uint8Array(read('model.mjb')),
  specs_json: JSON.parse(read('specs.json').toString()),
});
const env = instantiate(interactive_env_config(JSON.parse(read('env_config.json').toString())), REGISTRY) as cxe.MjxEnv;
const task = env.task as InteractiveLocomotion;
const transforms = task.body.transforms;
let state = env.initialize();

/** Restores the recorded local state fields of the body's transforms (e.g. `transforms[13]`). */
function restore_local(state: cxe.MjxEnvState, local: Record<string, Values>): cxe.MjxEnvState {
  for (const [key, fields] of Object.entries(local)) {
    const i = Number(/^transforms\[(\d+)\]$/.exec(key)![1]);
    const index = transforms[i].index;
    let value = state.local.get(index) as core.BaseLocalState & Record<string, torch.Tensor>;
    const updates: Record<string, torch.Tensor> = {};
    for (const [field, data] of Object.entries(fields)) {
      updates[field] = torch.tensor(data).reshape(...value[field].shape);
    }
    value = value.replace(updates);
    state = state.replace({ local: state.local.set(index, value) });
  }
  return state;
}

// Spring-muscle parameters computed at initialization (from spaces derived in the port).
const params = new ErrorTracker();
for (const [key, fields] of Object.entries(golden.envs[0].steps[0].local)) {
  if (!('kf' in fields)) continue;
  const i = Number(/^transforms\[(\d+)\]$/.exec(key)![1]);
  const local = state.local.get(transforms[i].index) as Record<string, torch.Tensor>;
  params.update(key, new collections.Dict(['kf', 'ke', 'cf', 'ce'].map(f => [f, local[f]] as [string, torch.Tensor])),
    Object.fromEntries(['kf', 'ke', 'cf', 'ce'].map(f => [f, fields[f]])));
}
params.check('spring-muscle parameters (kf, ke, cf, ce) match', TOLERANCE);

const ctrl_errors = new ErrorTracker();
const obs_errors = new ErrorTracker();
for (const { steps } of golden.envs) {
  for (const step of steps) {
    // Restore the recorded MuJoCo data (copies, since the action pipeline writes `ctrl`).
    const d = step.data;
    const data = new mjx.Data({
      time: d.time[0],
      qpos: Float64Array.from(d.qpos),
      qvel: Float64Array.from(d.qvel),
      ctrl: Float64Array.from(d.ctrl),
      actuator_force: Float64Array.from(d.actuator_force),
      ten_length: Float64Array.from(d.ten_length),
      ten_velocity: Float64Array.from(d.ten_velocity),
      sensordata: Float64Array.from(d.sensordata),
      xpos: Float64Array.from(d.xpos),
      xquat: Float64Array.from(d.xquat),
      xfrc_applied: Float64Array.from(d.xfrc_applied),
    });
    state = state.replace({ mjx_data: data });
    state = restore_local(state, step.local);
    state = task.set_target_vx(state, step.observation['target_vx'][0]);

    // One substep of the action pipeline.
    const action = new collections.Dict(Object.entries(step.action).map(([k, v]) => [k, torch.tensor(v)] as [string, torch.Tensor]));
    state = core.entity_action(task, state, action);
    ctrl_errors.update('ctrl', new collections.Dict([['ctrl', torch.tensor(Array.from(data.raw.ctrl))]]), { ctrl: step.ctrl });

    // Observation pipeline (on the recorded data; the action only wrote `ctrl`).
    let observation: core.Observation;
    [observation, state] = core.entity_observation(task, state);
    obs_errors.update('observation', observation, step.observation);
  }
}
ctrl_errors.check('one substep of entity_action matches Python (actuator ctrl)', TOLERANCE);
obs_errors.check('entity_observation matches recorded observations', TOLERANCE);
check('ran all steps', true, `${golden.envs.length} envs x ${golden.envs[0].steps.length} steps`);
exit();
