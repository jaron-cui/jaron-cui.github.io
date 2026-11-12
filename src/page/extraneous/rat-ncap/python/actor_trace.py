"""
Records an end-to-end golden trace of the actor (`model.actor`), for parity testing the TypeScript
port (`test/actor_trace.test.ts`).

The agent is built from the checkpoint's config, initialized with the checkpoint's spaces, and
loaded with the checkpoint's weights; Oscillator noise is set to 0. Each episode resets the actor
(as the trainer does with `actor.reset(None)`) and steps it on a synthetic observation sequence: a
smooth random walk within each observation box's bounds, with `target_vx` fixed to one of the
training subtask speeds. Observations, actions, and RG outputs are recorded every step.

Usage:
  python web/python/actor_trace.py <checkpoint_dir> <out_path> [--steps 200]
"""
import argparse
import pathlib

import hydra
import numpy as np
import torch

import circuits as cc

import export

SPEEDS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]


def random_walk(box, steps: int, rng: np.random.Generator) -> np.ndarray:
  """A random walk with step size 5% of the box range, reflected into the box bounds."""
  low, high = np.asarray(box.low, dtype=np.float64), np.asarray(box.high, dtype=np.float64)
  x = rng.uniform(low, high)
  out = np.empty((steps, *low.shape), dtype=np.float32)
  for t in range(steps):
    x = x + 0.05 * (high - low) * rng.standard_normal(low.shape)
    x = np.where(x > high, 2 * high - x, x)
    x = np.where(x < low, 2 * low - x, x)
    out[t] = np.clip(x, low, high)
  return out


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('checkpoint_dir', type=pathlib.Path)
  parser.add_argument('out_path', type=pathlib.Path)
  parser.add_argument('--steps', type=int, default=200)
  parser.add_argument('--seed', type=int, default=0)
  args = parser.parse_args()

  agent_config = export.load_agent_config(args.checkpoint_dir)
  observation_space, action_space = export.load_spaces(args.checkpoint_dir)
  agent = hydra.utils.instantiate(agent_config, _convert_='object')
  agent.initialize(observation_space, action_space, seed=0)
  state_dict = export.load_state_dict(args.checkpoint_dir)
  model = agent.model
  model.load_state_dict(state_dict)
  actor = model.actor
  for unit in actor.modules():
    if isinstance(unit, cc.Oscillator):
      unit.noise = 0.0
  rg = actor.sim.rhythm_generation

  rng = np.random.default_rng(args.seed)
  observations, actions, rg_outputs = [], [], []
  with torch.no_grad():
    for speed in SPEEDS:
      walks = {
        key: random_walk(box, args.steps, rng) if key != 'target_vx'
        else np.full((args.steps, *box.shape), speed, dtype=np.float32)
        for key, box in observation_space.spaces.items()
      }
      actor.reset(None)
      for t in range(args.steps):
        observation = {key: torch.as_tensor(walk[t]) for key, walk in walks.items()}
        action = actor(dict(observation))
        observations.append({k: v.tolist() for k, v in observation.items()})
        actions.append({k: v.tolist() for k, v in action.items()})
        rg_outputs.append({k: v.tolist() for k, v in rg.get_output().items()})

  export.write_json(args.out_path, {
    'checkpoint_dir': str(args.checkpoint_dir),
    'model_config': agent_config['model'],
    'overrides': {'oscillator_noise': 0.0},
    'observation_space': export.space_to_json(observation_space),
    'action_space': export.space_to_json(action_space),
    'state_dict': export.state_dict_to_json(model.state_dict()),
    'parameter_names': [name for name, _ in model.named_parameters()],
    'episodes': len(SPEEDS),
    'steps': args.steps,
    'observations': observations,
    'actions': actions,
    'rg_outputs': rg_outputs,
  })
  print(f'Wrote {len(observations)} steps to {args.out_path}')


if __name__ == '__main__':
  main()
