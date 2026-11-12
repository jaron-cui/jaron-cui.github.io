/**
 * Parity test of the actor on a real saved test rollout, against golden data written by
 * `python/rollout_trace.py`. The model is built from the checkpoint's config; parameters and
 * per-step buffers (full actor state) come from the rollout. For each environment:
 * - `reset`: `actor.reset(null)` must reproduce the recorded initial state `h[0]`.
 * - `replay`: restore `h[0]` and step through all recorded observations.
 * - `one_step`: restore each recorded state `h[t]` and step once on `s[t]`.
 * Both are compared exactly against PyTorch with noise disabled, and `one_step` is also compared
 * against the actions recorded during the (noisy) rollout, which TypeScript and PyTorch must
 * reproduce equally well.
 *
 * Usage: tsx test/rollout_trace.test.ts [data/rollout_trace.json]
 */
import * as torch from '../src/torch';
import * as collections from '../src/utils/collections';
import * as cc from '../src/circuits';
import { instantiate } from '../src/hydra';
import { REGISTRY } from '../src/registry';
import { BoxJson, TensorJson, space_from_json, tensor_from_json, tensors_from_json } from '../src/io';
import * as ncap from '../src/models/ncap';
import * as ttm from '../src/tonic/torch/models';
import { ErrorTracker, check, exit, load_json } from './util';

const TOLERANCE = 1e-5;

type TensorsJson = Record<string, number[]>;

interface Golden {
  model_config: unknown;
  overrides: { oscillator_noise: number };
  observation_space: Record<string, BoxJson>;
  action_space: Record<string, BoxJson>;
  parameters: Record<string, TensorJson>;
  buffer_names: string[];
  steps: number;
  envs: {
    env: number,
    target_vx: number,
    buffers: TensorsJson[],
    observations: TensorsJson[],
    recorded: TensorsJson[],
    replay: TensorsJson[],
    one_step: TensorsJson[],
  }[];
}

const golden = load_json<Golden>(process.argv[2] ?? 'data/rollout_trace.json');

const model = instantiate(golden.model_config, REGISTRY) as ttm.ActorOnly<ncap.QuadrupedModularActor>;
model.initialize(space_from_json(golden.observation_space), space_from_json(golden.action_space));
const actor = model.actor;
for (const unit of actor.modules()) {
  if (unit instanceof cc.Oscillator) unit.noise = golden.overrides.oscillator_noise;
}

// Structure: parameter names (all but the constrainer's) and buffer names must match PyTorch's.
const parameters = [...actor.named_parameters()];
const expected = Object.keys(golden.parameters).filter(name => !name.startsWith('constrainer.'));
check('named_parameters() matches the rollout (excluding constrainer)',
  parameters.map(([name]) => name).join() === expected.join(), `${parameters.length} vs ${expected.length}`);
const buffers = [...actor.named_buffers()];
check('named_buffers() matches the rollout', buffers.map(([name]) => name).join() === golden.buffer_names.join(),
  `${buffers.length} vs ${golden.buffer_names.length}`);

for (const [name, param] of parameters) param.set_(tensor_from_json(golden.parameters[name]));

function load_buffers(values: TensorsJson) {
  for (const [name, buffer] of buffers) buffer.set_(torch.tensor(values[name]).reshape(...buffer.shape));
}

const reset_errors = new ErrorTracker();
const replay_errors = new ErrorTracker();
const one_step_errors = new ErrorTracker();
const ts_recorded = new ErrorTracker();
const py_recorded = new ErrorTracker();
// Reset reproduces the recorded initial state. This is checked before any stepping because, as in
// Python, `Simulator.reset` only resets `Unit`s: plain input `Signal`s (`aff_*`, `freq_*`, `sync_*`)
// keep their last written values, which is harmless since the actor overwrites them before use.
for (const env of golden.envs) {
  actor.reset(null);
  reset_errors.update('reset', new collections.Dict(buffers), env.buffers[0]);
}

for (const env of golden.envs) {
  // Replay from the recorded initial state.
  load_buffers(env.buffers[0]);
  for (let t = 0; t < golden.steps; t++) {
    replay_errors.update('replay', actor.forward(tensors_from_json(env.observations[t])), env.replay[t]);
  }

  // One step from every recorded state.
  for (let t = 0; t < golden.steps; t++) {
    load_buffers(env.buffers[t]);
    const action = actor.forward(tensors_from_json(env.observations[t]));
    one_step_errors.update('one_step', action, env.one_step[t]);
    ts_recorded.update('recorded', action, env.recorded[t]);
    py_recorded.update('recorded', tensors_from_json(env.one_step[t]), env.recorded[t]);
  }
}

reset_errors.check('reset() reproduces the recorded initial state h[0] (all buffers)', 0);
replay_errors.check('replay from h[0] matches PyTorch', TOLERANCE);
one_step_errors.check('one step from every recorded h[t] matches PyTorch', TOLERANCE);
check('matches recorded (noisy) actions exactly as well as PyTorch does',
  Math.abs(ts_recorded.max_error - py_recorded.max_error) <= TOLERANCE,
  `max error vs recorded: TypeScript ${ts_recorded.max_error.toExponential(2)}, ` +
  `PyTorch ${py_recorded.max_error.toExponential(2)}; ` +
  `bit-exact vs recorded: TypeScript ${(100 * ts_recorded.exact / ts_recorded.total).toFixed(1)}%, ` +
  `PyTorch ${(100 * py_recorded.exact / py_recorded.total).toFixed(1)}%`);

exit();
