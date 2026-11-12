/** Shared helpers for parity tests against PyTorch golden data. */
import fs from 'node:fs';
import * as torch from '../src/torch';
import * as collections from '../src/utils/collections';

export function load_json<T>(path: string): T {
  return JSON.parse(fs.readFileSync(path, 'utf-8')) as T;
}

let failures = 0;

export function check(label: string, ok: boolean, detail: string = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Checks that two multi-line strings are equal, printing the first differing line otherwise. */
export function check_text(label: string, actual: string, expected: string) {
  if (actual === expected) return check(label, true);
  const a = actual.split('\n'), e = expected.split('\n');
  const i = a.findIndex((line, i) => line !== e[i]);
  check(label, false, `first difference at line ${i}:\n    actual:   ${a[i]}\n    expected: ${e[i]}`);
}

/** Checks that a module's parameter names and state dict keys/shapes match PyTorch's, in order. */
export function check_structure(
  label: string,
  module: torch.nn.Module,
  parameter_names: string[],
  state_dict: Record<string, { shape: number[] }>,
) {
  const names = [...module.named_parameters()].map(([name]) => name);
  check(`${label}: named_parameters() matches`, names.join() === parameter_names.join(),
    `${names.length} vs ${parameter_names.length}`);
  const own = [...module.state_dict()].map(([k, v]) => `${k}[${v.shape}]`);
  const theirs = Object.entries(state_dict).map(([k, v]) => `${k}[${v.shape}]`);
  const i = own.findIndex((k, i) => k !== theirs[i]);
  check(`${label}: state_dict() keys/shapes match`, own.join() === theirs.join(),
    `${own.length} vs ${theirs.length}` + (i >= 0 ? `, first difference: ${own[i]} vs ${theirs[i]}` : ''));
}

/** Tracks the maximum absolute error between tensor dicts and expected `{key: number[]}` values. */
export class ErrorTracker {
  max_error = 0;
  worst = '';
  exact = 0;
  total = 0;

  update(label: string, actual: collections.Mapping<torch.Tensor>, expected: Record<string, number[]>) {
    const keys = Object.keys(expected);
    if (actual.keys().join() !== keys.join()) {
      check(`${label}: output keys match`, false, `${actual.keys()} vs ${keys}`);
    }
    for (const key of keys) {
      const a = actual.getitem(key).tolist();
      const e = expected[key];
      if (a.length !== e.length) throw new Error(`${label}/${key}: length ${a.length} vs ${e.length}`);
      for (let i = 0; i < e.length; i++) {
        const error = Math.abs(a[i] - e[i]);
        this.total++;
        if (error === 0) this.exact++;
        if (error > this.max_error) {
          this.max_error = error;
          this.worst = `${key}[${i}]`;
        }
      }
    }
  }

  check(label: string, tolerance: number) {
    check(label, this.max_error <= tolerance,
      `max_error=${this.max_error.toExponential(2)} (${this.worst || '-'}), ` +
      `${(100 * this.exact / Math.max(this.total, 1)).toFixed(1)}% bit-exact over ${this.total} values`);
  }
}

export function exit() {
  process.exit(failures ? 1 : 0);
}
