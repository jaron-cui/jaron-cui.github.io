/**
 * Parity test of the Afferent Feedback (AF) and Pattern Formation (PF) networks, and the
 * `utils/torch/block` layers they are built from, against PyTorch golden data written by
 * `python/block_trace.py`.
 *
 * Usage: tsx test/block_trace.test.ts [data/block_trace.json]
 */
import { instantiate } from '../src/hydra';
import { REGISTRY } from '../src/registry';
import { BoxJson, TensorJson, space_from_json, state_dict_from_json, tensors_from_json } from '../src/io';
import * as ncap from '../src/models/ncap';
import * as utb from '../src/utils/torch/block';
import { ErrorTracker, check_structure, check_text, exit, load_json } from './util';

const TOLERANCE = 1e-5;

interface ModuleGolden<S> {
  config: unknown;
  state_dict: Record<string, TensorJson>;
  parameter_names: string[];
  observation_space: Record<string, BoxJson>;
  action_space: Record<string, BoxJson>;
  repr: Record<string, string>;
  samples: S[];
}

interface Golden {
  afferent_feedback: ModuleGolden<{
    inputs: Record<string, number[]>,
    sensor: Record<string, number[]>,
    reset: Record<string, number[]>,
  }>;
  pattern_formation: ModuleGolden<{
    inputs: Record<string, number[]>,
    action: Record<string, number[]>,
  }>;
}

const golden = load_json<Golden>(process.argv[2] ?? 'data/block_trace.json');

function build<M extends ncap.AfferentFeedbackNetwork | ncap.PatternFormationNetwork>(
  label: string,
  data: ModuleGolden<unknown>,
  layers: Record<string, (module: M) => utb.BlockModule>,
): M {
  const module = instantiate(data.config, REGISTRY) as M;
  module.initialize(space_from_json(data.observation_space), space_from_json(data.action_space));
  for (const [name, layer] of Object.entries(layers)) {
    check_text(`${label}.${name} repr matches`, layer(module).__repr__(), data.repr[name]);
  }
  check_structure(label, module, data.parameter_names, data.state_dict);
  module.load_state_dict(state_dict_from_json(data.state_dict));
  return module;
}

// Afferent Feedback.
{
  const data = golden.afferent_feedback;
  const af = build<ncap.AfferentFeedbackNetwork>('afferent_feedback', data, {
    sensor_layer: m => m.sensor_layer,
    reset_layer: m => m.reset_layer,
  });
  const sensor_errors = new ErrorTracker();
  const reset_errors = new ErrorTracker();
  for (const sample of data.samples) {
    const [sensor, reset] = af.forward(tensors_from_json(sample.inputs));
    sensor_errors.update('sensor', sensor, sample.sensor);
    reset_errors.update('reset', reset!, sample.reset);
  }
  sensor_errors.check('afferent_feedback sensor outputs within tolerance', TOLERANCE);
  reset_errors.check('afferent_feedback reset outputs within tolerance', TOLERANCE);
}

// Pattern Formation.
{
  const data = golden.pattern_formation;
  const pf = build<ncap.PatternFormationNetwork>('pattern_formation', data, {
    select_layer: m => m.select_layer,
    synergy_layer: m => m.synergy_layer,
  });
  const errors = new ErrorTracker();
  for (const sample of data.samples) {
    errors.update('action', pf.forward(tensors_from_json(sample.inputs)), sample.action);
  }
  errors.check('pattern_formation actions within tolerance', TOLERANCE);
}

exit();
