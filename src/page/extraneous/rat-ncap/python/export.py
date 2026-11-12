"""
Exports a trained checkpoint's actor into JSON files consumed by the TypeScript port (see also
`export_env.py` for the environment, and `export_job.py` for both):

- `agent_config.json`: the agent's Hydra config with interpolations resolved.
- `state_dict.json`: the model state dict (`{key: {shape, dtype, data}}`).
- `observation_space.json` / `action_space.json`: `{key: {shape, low, high, labels}}`.

Usage:
  python web/python/export.py <checkpoint_dir> <out_dir> [--epoch last]
"""
import argparse
import json
import pathlib
import pickle
import typing as T

import numpy as np
import omegaconf
import torch

import composer.utils.gym as cxg


def float_to_json(x: float) -> float | str:
  """Strict JSON has no Infinity/NaN, so non-finite floats are written as 'inf', '-inf', 'nan'."""
  return x if np.isfinite(x) else str(x)


def tensor_to_json(t: torch.Tensor) -> dict[str, T.Any]:
  t = t.detach().cpu()
  dtype = {torch.float32: 'float32', torch.int64: 'int64', torch.bool: 'bool'}[t.dtype]
  data = t.flatten().tolist()
  if dtype == 'float32':
    data = [float_to_json(x) for x in data]
  return {'shape': list(t.shape), 'dtype': dtype, 'data': data}


def state_dict_to_json(state_dict: T.Mapping[str, torch.Tensor]) -> dict[str, T.Any]:
  return {k: tensor_to_json(v) for k, v in state_dict.items()}


def space_to_json(space) -> dict[str, T.Any]:
  out = {}
  for key, box in space.items():
    labels = getattr(box, 'labels', None)
    out[key] = {
      'shape': list(box.shape),
      'low': [float_to_json(x) for x in np.asarray(box.low, dtype=np.float64).flatten().tolist()],
      'high': [float_to_json(x) for x in np.asarray(box.high, dtype=np.float64).flatten().tolist()],
      'labels': [list(l) if not isinstance(l, str) else l for l in labels] if labels else None,
    }
  return out


def load_yaml_json(path: pathlib.Path) -> T.Any:
  """Loads a YAML (e.g. Hydra) config as plain JSON-compatible data, resolving interpolations."""
  return omegaconf.OmegaConf.to_container(omegaconf.OmegaConf.load(path), resolve=True)


def load_agent_config(checkpoint_dir: pathlib.Path) -> dict[str, T.Any]:
  return T.cast(dict[str, T.Any], load_yaml_json(checkpoint_dir / 'agent_config.yaml'))


def load_checkpoint(path: pathlib.Path) -> dict[str, torch.Tensor]:
  """Loads a checkpoint `.pt` (a model state dict) onto the CPU."""
  return torch.load(path, map_location='cpu', weights_only=False)


def load_state_dict(checkpoint_dir: pathlib.Path, epoch: str = 'last') -> dict[str, torch.Tensor]:
  path = checkpoint_dir / f'{epoch}.pt'
  if not path.exists():
    epochs = sorted(p.stem for p in checkpoint_dir.glob('*.pt'))
    raise FileNotFoundError(f'No checkpoint for epoch {epoch!r} in {checkpoint_dir}. Available: {epochs}')
  return load_checkpoint(path)


def load_spaces(checkpoint_dir: pathlib.Path):
  observation_space = cxg.to_gym_space(pickle.load(open(checkpoint_dir / 'observation_space.pkl', 'rb')))
  action_space = cxg.to_gym_space(pickle.load(open(checkpoint_dir / 'action_space.pkl', 'rb')))
  return observation_space, action_space


def write_json(path: pathlib.Path, value: T.Any):
  path.parent.mkdir(parents=True, exist_ok=True)
  with open(path, 'w') as f:
    json.dump(value, f, allow_nan=False)


def export_actor(checkpoint_dir: pathlib.Path, out_dir: pathlib.Path, epoch: str = 'last'):
  """Exports the actor: `agent_config.json`, `state_dict.json`, and the observation/action spaces."""
  observation_space, action_space = load_spaces(checkpoint_dir)
  write_json(out_dir / 'agent_config.json', load_agent_config(checkpoint_dir))
  write_json(out_dir / 'state_dict.json', state_dict_to_json(load_state_dict(checkpoint_dir, epoch)))
  write_json(out_dir / 'observation_space.json', space_to_json(observation_space))
  write_json(out_dir / 'action_space.json', space_to_json(action_space))


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('checkpoint_dir', type=pathlib.Path)
  parser.add_argument('out_dir', type=pathlib.Path)
  parser.add_argument('--epoch', default='last')
  args = parser.parse_args()
  export_actor(args.checkpoint_dir, args.out_dir, args.epoch)
  print(f'Exported actor {args.checkpoint_dir} (epoch {args.epoch}) -> {args.out_dir}')


if __name__ == '__main__':
  main()
