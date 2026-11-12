/**
 * End-to-end parity test of the actor (`model.actor`) against a PyTorch golden trace written by
 * `python/actor_trace.py`: builds the model from the exported Hydra config, loads the checkpoint's
 * state dict, and replays the recorded observations, comparing actions and RG outputs every step.
 *
 * Usage: tsx test/actor_trace.test.ts [data/actor_trace.json]
 */
import * as cc from '../src/circuits';
import { instantiate } from '../src/hydra';
import { REGISTRY } from '../src/registry';
import { BoxJson, TensorJson, space_from_json, state_dict_from_json, tensors_from_json } from '../src/io';
import * as ncap from '../src/models/ncap';
import * as ttm from '../src/tonic/torch/models';
import { ErrorTracker, check, exit, load_json } from './util';

const TOLERANCE = 1e-5;
// The `Constrainer`'s entries depend on training-only `models.constrain` calls (see `ncap.ts`).
const CONSTRAINER = 'actor.constrainer.';

interface Golden {
  model_config: unknown;
  overrides: { oscillator_noise: number };
  observation_space: Record<string, BoxJson>;
  action_space: Record<string, BoxJson>;
  state_dict: Record<string, TensorJson>;
  parameter_names: string[];
  episodes: number;
  steps: number;
  observations: Record<string, number[]>[];
  actions: Record<string, number[]>[];
  rg_outputs: Record<string, number[]>[];
}

const golden = load_json<Golden>(process.argv[2] ?? 'data/actor_trace.json');

// Build exactly as Python does: instantiate the config, initialize with the spaces, load weights.
const model = instantiate(golden.model_config, REGISTRY) as ttm.ActorOnly<ncap.QuadrupedModularActor>;
model.initialize(space_from_json(golden.observation_space), space_from_json(golden.action_space));
const actor = model.actor;
const rg = actor.sim!.rhythm_generation as ncap.RhythmGenerationCircuit;

// Structure: everything but the `Constrainer` must match PyTorch exactly, in order.
const names = [...model.named_parameters()].map(([name]) => name);
const expected_names = golden.parameter_names.filter(name => !name.startsWith(CONSTRAINER));
check('named_parameters() matches (excluding constrainer)', names.join() === expected_names.join(),
  `${names.length} vs ${expected_names.length}`);
const own = [...model.state_dict()].map(([k, v]) => `${k}[${v.shape}]`);
const theirs = Object.entries(golden.state_dict)
  .filter(([k]) => !k.startsWith(CONSTRAINER))
  .map(([k, v]) => `${k}[${v.shape}]`);
check('state_dict() keys/shapes match (excluding constrainer)', own.join() === theirs.join(),
  `${own.length} vs ${theirs.length}`);
const constrainer_keys = Object.keys(golden.state_dict).filter(k => k.startsWith(CONSTRAINER)).length;
const { missing_keys, unexpected_keys } = model.load_state_dict(state_dict_from_json(golden.state_dict));
check('load_state_dict(strict=true) succeeds', missing_keys.length === 0 && unexpected_keys.length === 0,
  `${Object.keys(golden.state_dict).length} keys, of which ${constrainer_keys} constrainer keys ignored`);

for (const unit of actor.modules()) {
  if (unit instanceof cc.Oscillator) unit.noise = golden.overrides.oscillator_noise;
}

// Replay.
const action_errors = new ErrorTracker();
const rg_errors = new ErrorTracker();
const first_divergence: number[] = [];
let step = 0;
for (let episode = 0; episode < golden.episodes; episode++) {
  actor.reset(null);
  let diverged = -1;
  for (let t = 0; t < golden.steps; t++, step++) {
    const action = actor.forward(tensors_from_json(golden.observations[step]));
    const before = action_errors.max_error;
    action_errors.update('action', action, golden.actions[step]);
    rg_errors.update('rg', rg.get_output(), golden.rg_outputs[step]);
    if (diverged < 0 && action_errors.max_error > TOLERANCE && action_errors.max_error > before) diverged = t;
  }
  first_divergence.push(diverged);
}

action_errors.check('actions within tolerance', TOLERANCE);
rg_errors.check('RG outputs within tolerance', TOLERANCE);
check('no episode diverges', first_divergence.every(t => t < 0),
  `first divergence step per episode: [${first_divergence}]`);

exit();
