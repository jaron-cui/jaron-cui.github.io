"""
Exports a training job (architecture, body/environment, and trained parameters at an epoch) for the
TypeScript port and the interactive app, in one step. Writes to `<out_dir>/`:

- `agent_config.json`, `observation_space.json`, `action_space.json`, `state_dict.json` (actor, via
  `export.py`; `state_dict.json` is the epoch's parameters, as from `pt_to_json.py`).
- `env_config.json`, `model.mjb`, `specs.json` (environment, via `export_env.py`).
- `params/<epoch>.json` and `params/index.json`: parameters of other saved epochs (all by default),
  listed as presets in the app's parameter library, which can swap them in mid-run.
- `manifest.json`: where and when the export came from.

By default `<out_dir>` is `web/data/app/<name>`, which the app serves; open it with
`http://localhost:5173/?checkpoint=/<name>`.

Usage:
  python web/python/export_job.py <job_dir> [--epoch last] [--name NAME] [--out-dir DIR]
    [--params-epochs all|none|100,500,...]
"""
import argparse
import datetime
import pathlib
import re

import mujoco as mj

import export
import export_env

APP_DATA = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'app'


def default_name(job_dir: pathlib.Path, epoch: str) -> str:
  """E.g. `.../2026-0924-161102-desc:furry-rabbits/18455968_1:overrides` -> `furry-rabbits_18455968_1_e1800`."""
  run = job_dir.parent.name.split(':')[-1]
  job = job_dir.name.split(':')[0]
  name = f'{run}_{job}_e{epoch}'
  return re.sub(r'[^A-Za-z0-9._-]', '_', name)


def epoch_key(epoch: str) -> tuple[int, int]:
  return (1, 0) if epoch == 'last' else (0, int(epoch))


def export_params(checkpoint_dir: pathlib.Path, out_dir: pathlib.Path, epochs: str) -> list[dict]:
  """Exports parameter presets to `params/<epoch>.json`, indexed by `params/index.json`."""
  available = sorted((p.stem for p in checkpoint_dir.glob('*.pt')), key=epoch_key)
  if epochs == 'none':
    selected = []
  elif epochs == 'all':
    selected = available
  else:
    selected = [e.strip() for e in epochs.split(',')]
    missing = [e for e in selected if e not in available]
    if missing:
      raise FileNotFoundError(f'No checkpoints for epochs {missing} in {checkpoint_dir}. Available: {available}')
  presets = []
  for epoch in selected:
    file = f'params/{epoch}.json'
    export.write_json(out_dir / file, export.state_dict_to_json(export.load_state_dict(checkpoint_dir, epoch)))
    presets.append({'name': f'epoch {epoch}', 'epoch': epoch, 'file': file})
  if presets:
    export.write_json(out_dir / 'params' / 'index.json', presets)
  return presets


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('job_dir', type=pathlib.Path, help='Training job directory (contains `checkpoint/`).')
  parser.add_argument('--epoch', default='last', help="Checkpoint epoch, e.g. 1800 or 'last'.")
  parser.add_argument('--name', default=None, help='Export name (default: derived from the job and epoch).')
  parser.add_argument('--out-dir', type=pathlib.Path, default=None, help=f'Output directory (default: {APP_DATA}/<name>).')
  parser.add_argument('--params-epochs', default='all', help="Epochs to export as parameter presets: 'all', 'none', or e.g. '100,500,last'.")
  args = parser.parse_args()

  job_dir = args.job_dir.resolve()
  checkpoint_dir = job_dir / 'checkpoint'
  if not checkpoint_dir.is_dir():
    raise FileNotFoundError(f'No checkpoint directory in {job_dir}.')
  name = args.name or default_name(job_dir, args.epoch)
  out_dir = args.out_dir or APP_DATA / name

  export.export_actor(checkpoint_dir, out_dir, args.epoch)
  mj_model = export_env.export_env(checkpoint_dir, out_dir)
  presets = export_params(checkpoint_dir, out_dir, args.params_epochs)
  export.write_json(out_dir / 'manifest.json', {
    'name': name,
    'job_dir': str(job_dir),
    'epoch': args.epoch,
    'mujoco_version': mj.__version__,
    'exported_at': datetime.datetime.now().isoformat(timespec='seconds'),
    'params': [p['epoch'] for p in presets],
  })

  sizes = {p.name: p.stat().st_size for p in sorted(out_dir.iterdir()) if p.is_file()}
  print(f'Exported {job_dir} (epoch {args.epoch}) -> {out_dir}')
  for file, size in sizes.items():
    print(f'  {file:24s} {size / 1e3:9.1f} kB')
  if presets:
    size = sum((out_dir / p['file']).stat().st_size for p in presets)
    print(f'  params/ ({len(presets)} epochs)  {size / 1e3:9.1f} kB')
  print(f'  (model: nq={mj_model.nq}, nv={mj_model.nv}, nu={mj_model.nu})')
  if out_dir.resolve().parent == APP_DATA.resolve():
    print(f'Open in the app: http://localhost:5173/?checkpoint=/{out_dir.name}')


if __name__ == '__main__':
  main()
