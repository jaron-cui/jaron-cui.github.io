"""
Records golden data from a saved test rollout for parity testing the ported environment code (the
body's observation pipeline and action/controller pipeline) without physics
(`test/env_trace.test.ts`).

For one specimen's environments (one per target speed) and every step `t`, records:
- `data`: the recorded MuJoCo data fields that the body reads (`qpos`, `qvel`, tendon lengths and
  velocities, actuator forces, sensors, ...).
- `local`: the body transforms' recorded local states (controller positions/velocities, activations,
  and spring-muscle parameters), keyed by `transforms[i]`.
- `observation`: the recorded observation.
- `action`: the recorded action, and `ctrl`: the actuator controls produced by one substep of
  `composer.entity_action` (all transforms and the body) from the recorded state, in Python.

Usage:
  python web/python/env_trace.py <job_dir> <out_path> [--epoch last] [--specimen 0] [--steps 200]
"""
import argparse
import pathlib
import pickle

import hydra
import jax
import jax.numpy as jnp
import numpy as np
import omegaconf
import torch

import composer as cx
import composer.utils.rollout as cxr

import export

DATA_FIELDS = ['time', 'qpos', 'qvel', 'ctrl', 'actuator_force', 'ten_length', 'sensordata', 'xpos', 'xquat', 'xfrc_applied']
LOCAL_FIELDS = ['pos', 'vel', 'act_flx', 'act_ext', 'kf', 'ke', 'cf', 'ce']


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('job_dir', type=pathlib.Path)
  parser.add_argument('out_path', type=pathlib.Path)
  parser.add_argument('--epoch', default='last')
  parser.add_argument('--specimen', type=int, default=0)
  parser.add_argument('--steps', type=int, default=200)
  args = parser.parse_args()

  config = omegaconf.OmegaConf.load(args.job_dir / 'checkpoint' / 'env_config.yaml')
  env: cx.MjxEnv = hydra.utils.instantiate(config, _convert_='object')
  rollout_dir = args.job_dir / 'rollout'
  steps = cxr.load_steps(rollout_dir / 'steps' / f'{args.epoch}.pkl', env)
  with open(rollout_dir / 'actions' / f'{args.epoch}.pkl', 'rb') as f:
    actions = pickle.load(f)
  subtasks = torch.load(rollout_dir / 'subtasks' / f'{args.epoch}.pt', map_location='cpu', weights_only=False)
  subtask_count = len(set(subtasks['target_vx'].tolist()))
  envs = list(range(args.specimen * subtask_count, (args.specimen + 1) * subtask_count))
  T = min(args.steps, len(actions))

  # One substep of the action pipeline (transforms in reverse order, then entities), in Python.
  def action_one(state: cx.MjxEnvState, action):
    state = cx.entity_action(env.task, state, action)
    return state, state.mjx_data.ctrl
  action_vec = cx.vmap_state_update(action_one, in_axes=(0,), jit=True)

  def body_marker(marker: str) -> str | None:
    # 'MoveAtFixedVelocity_TrackSmooth.children['body'].transforms[13].index' -> 'transforms[13]'
    prefix = ".children['body']."
    if prefix not in marker or '.transforms[' not in marker: return None
    return marker.split(prefix, 1)[1].removesuffix('.index')

  records = {e: [] for e in envs}
  for t in range(T):
    state = steps[t].state
    action = {f'body/{k}' if not k.startswith('body/') else k: v for k, v in actions[t].items()}
    _, ctrl = action_vec(state, action)
    data = state.mjx_data
    fields = {f: np.asarray(getattr(data, f)) for f in DATA_FIELDS}
    fields['ten_velocity'] = np.asarray(data._impl.ten_velocity)
    local = {}
    for marker, value in state.local._state.items():
      key = body_marker(marker)
      if key is None or value is None: continue
      local[key] = {f: np.asarray(getattr(value, f)) for f in LOCAL_FIELDS if hasattr(value, f)}
    for e in envs:
      records[e].append({
        'data': {f: np.atleast_1d(v[e]).flatten().tolist() for f, v in fields.items()},
        'local': {k: {f: np.atleast_1d(v[e]).flatten().tolist() for f, v in fs.items()} for k, fs in local.items()},
        'observation': {k: np.asarray(v[e]).tolist() for k, v in steps[t].observation.items()},
        'action': {k: np.asarray(v[e]).tolist() for k, v in action.items()},
        'ctrl': np.asarray(ctrl[e]).tolist(),
      })

  export.write_json(args.out_path, {
    'job_dir': str(args.job_dir),
    'epoch': args.epoch,
    'envs': [{'env': e, 'target_vx': subtasks['target_vx'][e].item(), 'steps': records[e]} for e in envs],
  })
  print(f'Wrote {len(envs)} envs x {T} steps to {args.out_path}')


if __name__ == '__main__':
  main()
