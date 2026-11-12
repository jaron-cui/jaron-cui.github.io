"""
Records a golden trace of the Rhythm Generation (RG) circuit alone, for parity testing the
TypeScript port (`test/rg_trace.test.ts`).

The RG is built from the checkpoint's `model.rhythm_generation` config, loaded with the checkpoint's
RG parameters, and driven exactly as `QuadrupedModularActor.forward` drives it: write afferent and
command signals, then `sim.step()`, then read `get_output()`. Oscillator noise is set to 0, since
PyTorch's random stream cannot be reproduced in TypeScript.

Usage:
  python web/python/rg_trace.py <checkpoint_dir> <out_path> [--steps 200]
"""
import argparse
import pathlib

import hydra
import numpy as np
import torch

import circuits as cc

import export

PREFIX = 'actor.sim.rhythm_generation.'
SPEEDS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
LIMBS = ('FL', 'FR', 'HL', 'HR')


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('checkpoint_dir', type=pathlib.Path)
  parser.add_argument('out_path', type=pathlib.Path)
  parser.add_argument('--steps', type=int, default=200)
  parser.add_argument('--seed', type=int, default=0)
  args = parser.parse_args()

  agent_config = export.load_agent_config(args.checkpoint_dir)
  model_config = agent_config['model']
  rg_config = model_config['rhythm_generation']
  timestep = model_config.get('timestep', 30.)

  rg = hydra.utils.instantiate(rg_config, _convert_='object')
  sim = cc.Simulator(timestep=timestep)
  sim.rhythm_generation = rg
  state_dict = export.load_state_dict(args.checkpoint_dir)
  rg.load_state_dict({k[len(PREFIX):]: v for k, v in state_dict.items() if k.startswith(PREFIX)})
  for unit in rg.modules():
    if isinstance(unit, cc.Oscillator):
      unit.noise = 0.0
  sim.init()

  # Episodes: each speed, without and with (smooth, random) afferent input.
  rng = np.random.default_rng(args.seed)
  episodes = []
  for afferent in (False, True):
    for speed in SPEEDS:
      aff = np.zeros((args.steps, 8), dtype=np.float32)
      if afferent:
        noise = rng.uniform(-0.6, 0.6, size=(args.steps + 9, 8))
        aff = np.stack([np.convolve(noise[:, i], np.ones(10) / 10, mode='valid') for i in range(8)], axis=-1)
        aff = aff[:args.steps].astype(np.float32)
      episodes.append({'speed': speed, 'aff': aff})

  units = [name for name, m in rg.named_children() if isinstance(m, cc.Signal)]
  fields = {
    name: [f for f in ('value', 'v', 'a', 'x') if hasattr(m, f)]
    for name, m in rg.named_children() if isinstance(m, cc.Signal)
  }
  trace = {f'{name}.{f}': [] for name in units for f in fields[name]}
  outputs = {limb: [] for limb in LIMBS}
  inputs = []
  with torch.no_grad():
    for episode in episodes:
      # Mirrors `QuadrupedModularActor.reset(None)`.
      sim.reset(None)
      rg.reset(None)
      for t in range(args.steps):
        aff = episode['aff'][t]
        commands = [episode['speed']] * 4  # [freq_L, sync_L, freq_R, sync_R]
        for i, limb in enumerate(LIMBS):
          rg[f'aff_flx_{limb}'].value[:] = float(aff[2 * i])
          rg[f'aff_ext_{limb}'].value[:] = float(aff[2 * i + 1])
        rg.freq_L.value[:] = commands[0]
        rg.sync_L.value[:] = commands[1]
        rg.freq_R.value[:] = commands[2]
        rg.sync_R.value[:] = commands[3]
        sim.step()
        output = rg.get_output()
        inputs.append({'aff': aff.tolist(), 'commands': commands})
        for name in units:
          for f in fields[name]:
            trace[f'{name}.{f}'].append(getattr(rg[name], f).item())
        for limb in LIMBS:
          outputs[limb].append(output[limb].tolist())

  export.write_json(args.out_path, {
    'checkpoint_dir': str(args.checkpoint_dir),
    'timestep': timestep,
    'rhythm_generation_config': rg_config,
    'overrides': {'oscillator_noise': 0.0},
    'state_dict': export.state_dict_to_json(rg.state_dict()),
    'parameter_names': [name for name, _ in rg.named_parameters()],
    'episodes': len(episodes),
    'steps': args.steps,
    'inputs': inputs,
    'trace': trace,
    'outputs': outputs,
  })
  print(f'Wrote {len(inputs)} steps x {len(trace)} traced fields to {args.out_path}')


if __name__ == '__main__':
  main()
