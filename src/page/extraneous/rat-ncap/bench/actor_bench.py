"""
PyTorch baseline for `bench/actor.bench.ts`: times `actor(observation)` per control step on the same
real rollout observations, with the model built from the same checkpoint.

Usage:
  python web/bench/actor_bench.py <checkpoint_dir> [--rollout data/rollout_trace.json]
    [--warmup 2] [--repeats 10] [--threads 1]
"""
import argparse
import json
import pathlib
import sys
import time

import hydra
import numpy as np
import torch

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / 'python'))
import export  # noqa: E402


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('checkpoint_dir', type=pathlib.Path)
  parser.add_argument('--rollout', type=pathlib.Path, default=pathlib.Path('data/rollout_trace.json'))
  parser.add_argument('--warmup', type=int, default=2)
  parser.add_argument('--repeats', type=int, default=10)
  parser.add_argument('--threads', type=int, default=1)
  args = parser.parse_args()
  torch.set_num_threads(args.threads)

  agent_config = export.load_agent_config(args.checkpoint_dir)
  observation_space, action_space = export.load_spaces(args.checkpoint_dir)
  agent = hydra.utils.instantiate(agent_config, _convert_='object')
  agent.initialize(observation_space, action_space, seed=0)
  agent.model.load_state_dict(export.load_state_dict(args.checkpoint_dir))
  actor = agent.model.actor

  rollout = json.load(open(args.rollout))
  episodes = [
    [{k: torch.tensor(v) for k, v in o.items()} for o in env['observations']]
    for env in rollout['envs']
  ]

  def run_pass(times):
    for episode in episodes:
      actor.reset(None)
      for observation in episode:
        start = time.perf_counter()
        actor(dict(observation))
        if times is not None:
          times.append((time.perf_counter() - start) * 1e3)

  with torch.no_grad():
    for _ in range(args.warmup):
      run_pass(None)
    times = []
    for _ in range(args.repeats):
      run_pass(times)
  t = np.array(times)
  print(
    f'PyTorch {torch.__version__} ({args.threads} thread): actor(observation): '
    f'mean {t.mean():.3f} ms, median {np.median(t):.3f} ms, p5 {np.percentile(t, 5):.3f} ms, '
    f'p95 {np.percentile(t, 95):.3f} ms, max {t.max():.3f} ms over {len(t)} steps'
  )


if __name__ == '__main__':
  main()
