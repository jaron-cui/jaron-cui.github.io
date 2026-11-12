"""
Records golden data for the Afferent Feedback (AF) and Pattern Formation (PF) networks (built on
`utils.torch.block`), for parity testing the TypeScript port (`test/block_trace.test.ts`).

The full agent is built from the checkpoint's config and initialized with the checkpoint's spaces,
capturing the exact spaces passed to `AfferentFeedbackNetwork.initialize` and
`PatternFormationNetwork.initialize`. The checkpoint's weights are then loaded, and each network is
evaluated on random inputs sampled uniformly within the observation space bounds.

Usage:
  python web/python/block_trace.py <checkpoint_dir> <out_path> [--samples 64]
"""
import argparse
import pathlib

import hydra
import numpy as np
import torch

import models

import export


def capture_initialize(cls, captured: dict, name: str):
  original = cls.initialize
  def initialize(self, observation_space, action_space):
    captured[name] = (observation_space, action_space)
    return original(self, observation_space, action_space)
  cls.initialize = initialize


def tensors_to_json(tensors) -> dict[str, list[float]]:
  return {k: v.tolist() for k, v in tensors.items()}


def sample(space, keys, rng) -> dict[str, torch.Tensor]:
  return {
    k: torch.as_tensor(rng.uniform(space[k].low, space[k].high), dtype=torch.float32)
    for k in keys
  }


def module_json(module, prefix: str, state_dict, observation_space, action_space) -> dict:
  return {
    'state_dict': export.state_dict_to_json(
      {k[len(prefix):]: v for k, v in state_dict.items() if k.startswith(prefix)}
    ),
    'parameter_names': [name for name, _ in module.named_parameters()],
    'observation_space': export.space_to_json(observation_space),
    'action_space': export.space_to_json(action_space),
  }


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('checkpoint_dir', type=pathlib.Path)
  parser.add_argument('out_path', type=pathlib.Path)
  parser.add_argument('--samples', type=int, default=64)
  parser.add_argument('--seed', type=int, default=0)
  args = parser.parse_args()

  captured = {}
  capture_initialize(models.AfferentFeedbackNetwork, captured, 'afferent_feedback')
  capture_initialize(models.PatternFormationNetwork, captured, 'pattern_formation')

  agent_config = export.load_agent_config(args.checkpoint_dir)
  observation_space, action_space = export.load_spaces(args.checkpoint_dir)
  agent = hydra.utils.instantiate(agent_config, _convert_='object')
  agent.initialize(observation_space, action_space, seed=0)
  state_dict = export.load_state_dict(args.checkpoint_dir)
  agent.model.load_state_dict(state_dict)
  actor = agent.model.actor
  af: models.AfferentFeedbackNetwork = actor.afferent_feedback
  pf: models.PatternFormationNetwork = actor.pattern_formation

  rng = np.random.default_rng(args.seed)
  af_space, af_action_space = captured['afferent_feedback']
  pf_space, pf_action_space = captured['pattern_formation']
  af_samples, pf_samples = [], []
  with torch.no_grad():
    for _ in range(args.samples):
      inputs = sample(af_space, af.observation_keys, rng)
      sensor, reset = af(inputs)
      af_samples.append({
        'inputs': tensors_to_json(inputs),
        'sensor': tensors_to_json(sensor),
        'reset': tensors_to_json(reset),
      })
      inputs = sample(pf_space, pf.observation_keys, rng)
      action = pf(inputs)
      pf_samples.append({'inputs': tensors_to_json(inputs), 'action': tensors_to_json(action)})

  export.write_json(args.out_path, {
    'checkpoint_dir': str(args.checkpoint_dir),
    'afferent_feedback': {
      'config': agent_config['model']['afferent_feedback'],
      **module_json(af, 'actor.afferent_feedback.', state_dict, af_space, af_action_space),
      'repr': {name: repr(getattr(af, name)) for name in ('sensor_layer', 'reset_layer')},
      'samples': af_samples,
    },
    'pattern_formation': {
      'config': agent_config['model']['pattern_formation'],
      **module_json(pf, 'actor.pattern_formation.', state_dict, pf_space, pf_action_space),
      'repr': {name: repr(getattr(pf, name)) for name in ('select_layer', 'synergy_layer')},
      'samples': pf_samples,
    },
  })
  print(f'Wrote {args.samples} AF and PF samples to {args.out_path}')


if __name__ == '__main__':
  main()
