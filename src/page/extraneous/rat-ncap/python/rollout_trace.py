"""
Records golden data from a saved test rollout of a training run (`<job_dir>/rollout/`), for parity
testing the TypeScript port on real closed-loop observations (`test/rollout_trace.test.ts`).

A saved rollout holds, per environment (`vectorize` = specimens x subtasks, specimen-major): the
actor's parameters `w`, its buffers (full state, e.g. RG unit voltages and synapse delays) `h[0:T]`,
env steps (incl. observations) `s[0:T]`, and actions `a[0:T-1]`, where `a[t]` and `h[t+1]` result
from stepping the actor in state `h[t]` on `s[t].observation`.

The actor architecture comes from the checkpoint's config; parameters and buffers come from the
rollout. Oscillator noise is set to 0, since the recorded (noisy) actions cannot be reproduced
exactly. For each environment of one specimen, this records:
- `replay`: actions from restoring `h[0]` and stepping through all observations.
- `one_step`: actions from restoring each `h[t]` and stepping once on `s[t].observation`.
- `recorded`: the actions actually taken during the rollout (with noise).

Usage:
  python web/python/rollout_trace.py <job_dir> <out_path> [--epoch last] [--specimen 0]
"""
import argparse
import pathlib
import pickle

import hydra
import torch

import circuits as cc

import export


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('job_dir', type=pathlib.Path)
  parser.add_argument('out_path', type=pathlib.Path)
  parser.add_argument('--epoch', default='last')
  parser.add_argument('--specimen', type=int, default=0)
  args = parser.parse_args()

  checkpoint_dir = args.job_dir / 'checkpoint'
  rollout_dir = args.job_dir / 'rollout'
  agent_config = export.load_agent_config(checkpoint_dir)
  observation_space, action_space = export.load_spaces(checkpoint_dir)
  agent = hydra.utils.instantiate(agent_config, _convert_='object')
  agent.initialize(observation_space, action_space, seed=0)
  actor = agent.model.actor
  for unit in actor.modules():
    if isinstance(unit, cc.Oscillator):
      unit.noise = 0.0

  # Load the rollout. Steps are read from the raw pickle to avoid compiling the MJX environment.
  params = torch.load(rollout_dir / 'params' / f'{args.epoch}.pt', map_location='cpu', weights_only=False)
  buffers = torch.load(rollout_dir / 'buffers' / f'{args.epoch}.pt', map_location='cpu', weights_only=False)
  subtasks = torch.load(rollout_dir / 'subtasks' / f'{args.epoch}.pt', map_location='cpu', weights_only=False)
  with open(rollout_dir / 'steps' / f'{args.epoch}.pkl', 'rb') as f:
    steps = pickle.load(f)['dynamic']
  with open(rollout_dir / 'actions' / f'{args.epoch}.pkl', 'rb') as f:
    actions = pickle.load(f)
  T = len(actions)
  subtask_count = len(set(subtasks['target_vx'].tolist()))
  envs = list(range(args.specimen * subtask_count, (args.specimen + 1) * subtask_count))

  def to_list(x) -> list[float]:
    return torch.as_tensor(x).flatten().tolist()

  def load_params(env: int):
    for name, param in actor.named_parameters():
      param.data.copy_(params[name][env])

  def load_buffers(t: int, env: int):
    for name, buffer in actor.named_buffers():
      buffer.copy_(buffers[t][name][env])

  def observation(t: int, env: int) -> dict[str, torch.Tensor]:
    return {k: torch.as_tensor(v[env]) for k, v in steps[t].observation.items()}

  data = []
  with torch.no_grad():
    for env in envs:
      load_params(env)
      replay, one_step = [], []
      load_buffers(0, env)
      for t in range(T):
        replay.append({k: to_list(v) for k, v in actor(observation(t, env)).items()})
      for t in range(T):
        load_buffers(t, env)
        one_step.append({k: to_list(v) for k, v in actor(observation(t, env)).items()})
      data.append({
        'env': env,
        'target_vx': subtasks['target_vx'][env].item(),
        'buffers': [{name: to_list(b[name][env]) for name, _ in actor.named_buffers()} for b in buffers[:T]],
        'observations': [{k: to_list(v[env]) for k, v in steps[t].observation.items()} for t in range(T)],
        'recorded': [{k: to_list(v[env]) for k, v in actions[t].items()} for t in range(T)],
        'replay': replay,
        'one_step': one_step,
      })

  export.write_json(args.out_path, {
    'job_dir': str(args.job_dir),
    'epoch': args.epoch,
    'specimen': args.specimen,
    'model_config': agent_config['model'],
    'overrides': {'oscillator_noise': 0.0},
    'observation_space': export.space_to_json(observation_space),
    'action_space': export.space_to_json(action_space),
    'parameters': {name: export.tensor_to_json(params[name][envs[0]]) for name, _ in actor.named_parameters()},
    'buffer_names': [name for name, _ in actor.named_buffers()],
    'steps': T,
    'envs': data,
  })
  print(f'Wrote {len(envs)} envs x {T} steps to {args.out_path}')


if __name__ == '__main__':
  main()
