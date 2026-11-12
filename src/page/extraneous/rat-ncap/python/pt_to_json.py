"""
Converts a checkpoint `.pt` (a model state dict, e.g. `<job>/checkpoint/<epoch>.pt`) into the JSON
parameters file used by the TypeScript port (`state_dict.json`): `{key: {shape, dtype, data}}`,
with non-finite floats written as 'inf'/'-inf'/'nan'. This is also the file the app's "Load
parameters" button accepts.

Usage:
  python web/python/pt_to_json.py <checkpoint.pt> <out.json>
"""
import argparse
import pathlib

import export


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('checkpoint', type=pathlib.Path)
  parser.add_argument('out_path', type=pathlib.Path)
  args = parser.parse_args()
  state_dict = export.load_checkpoint(args.checkpoint)
  export.write_json(args.out_path, export.state_dict_to_json(state_dict))
  count = sum(v.numel() for v in state_dict.values())
  print(f'Wrote {len(state_dict)} tensors ({count} values) from {args.checkpoint} -> {args.out_path} '
        f'({args.out_path.stat().st_size / 1e3:.0f} kB)')


if __name__ == '__main__':
  main()
