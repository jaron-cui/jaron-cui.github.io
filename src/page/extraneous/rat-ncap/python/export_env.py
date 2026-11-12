"""
Exports a checkpoint's environment for the TypeScript port:

- `env_config.json`: the env's Hydra config with interpolations resolved.
- `model.mjb`: the compiled MuJoCo model (`task.mj_spec.compile()`, exactly as `MjxEnv.initialize`
  compiles it). All build-time `MjSpec` edits (actuator types, contact modes, sensors, arena) are
  baked in, so the TypeScript side never edits specs.
- `specs.json`: read-only mirrors of the spec elements that run-time code looks up, per spec file
  (`MjSpec.from_file` paths), e.g. actuators (name, transmission, target), joints (name, type,
  range in spec units), tendons, sensors, bodies, and geoms.

The MuJoCo version must match the WASM build used in TypeScript (`.mjb` is version-specific).

Usage:
  python web/python/export_env.py <checkpoint_dir> <out_dir>
"""
import argparse
import json
import pathlib
import typing as T

import hydra
import mujoco as mj
import omegaconf

import envs.bodies as bodies

import export


def spec_to_json(spec: mj.MjSpec) -> dict[str, T.Any]:
  def joint(j: mj.MjsJoint) -> dict[str, T.Any]:
    return {'name': j.name, 'type': mj.mjtJoint(j.type).name, 'range': list(j.range)}

  def tendon(t: mj.MjsTendon) -> dict[str, T.Any]:
    return {'name': t.name, 'range': list(t.range)}

  return {
    'degree': bool(spec.compiler.degree),
    'actuators': [
      {
        'name': a.name,
        'trntype': mj.mjtTrn(a.trntype).name,
        'target': a.target,
        'forcerange': list(a.forcerange),
      }
      for a in spec.actuators
    ],
    'joints': [joint(j) for j in spec.joints],
    'tendons': [tendon(t) for t in spec.tendons],
    'sensors': [{'name': s.name} for s in spec.sensors],
    'bodies': [{'name': b.name} for b in spec.bodies],
    'geoms': [{'name': g.name, 'classname': g.classname.name} for g in spec.geoms],
  }


def export_env(checkpoint_dir: pathlib.Path, out_dir: pathlib.Path) -> mj.MjModel:
  """Exports the environment: `env_config.json`, `model.mjb`, and `specs.json`."""
  out_dir.mkdir(parents=True, exist_ok=True)
  config = omegaconf.OmegaConf.load(checkpoint_dir / 'env_config.yaml')
  config_json = omegaconf.OmegaConf.to_container(config, resolve=True)
  env = hydra.utils.instantiate(config, _convert_='object')

  # Compile exactly as `MjxEnv.initialize` does.
  mj_model = env.task.mj_spec.compile()
  mj.mj_saveModel(mj_model, str(out_dir / 'model.mjb'), None)

  # Mirror the specs that entities load from files (`MjSpec.from_file`), keyed by file name.
  # NOTE: Assumes the body uses the default `xml_path` (the env config does not override it).
  body = env.task.children['body']
  specs = {bodies.RAT_XML.name: spec_to_json(body.mj_spec)}

  export.write_json(out_dir / 'env_config.json', config_json)
  export.write_json(out_dir / 'specs.json', {
    'mujoco_version': mj.__version__,
    'specs': specs,
  })
  return mj_model


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('checkpoint_dir', type=pathlib.Path)
  parser.add_argument('out_dir', type=pathlib.Path)
  args = parser.parse_args()
  mj_model = export_env(args.checkpoint_dir, args.out_dir)
  print(
    f'Exported env (MuJoCo {mj.__version__}; nq={mj_model.nq}, nv={mj_model.nv}, nu={mj_model.nu}, '
    f'nsensor={mj_model.nsensor}) -> {args.out_dir}'
  )


if __name__ == '__main__':
  main()
