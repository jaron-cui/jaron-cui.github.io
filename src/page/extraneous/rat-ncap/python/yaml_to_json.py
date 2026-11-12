"""
Converts a YAML config (e.g. a checkpoint's `agent_config.yaml` or `env_config.yaml`) into JSON,
resolving OmegaConf/Hydra interpolations. The TypeScript mini-Hydra (`src/hydra.ts`) instantiates
these JSON configs.

Usage:
  python web/python/yaml_to_json.py <config.yaml> <out.json>
"""
import argparse
import pathlib

import export


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('config', type=pathlib.Path)
  parser.add_argument('out_path', type=pathlib.Path)
  args = parser.parse_args()
  export.write_json(args.out_path, export.load_yaml_json(args.config))
  print(f'Wrote {args.config} -> {args.out_path}')


if __name__ == '__main__':
  main()
