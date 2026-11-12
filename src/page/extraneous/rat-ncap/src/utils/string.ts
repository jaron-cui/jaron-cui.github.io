/** Port of `libs/utils/string.py` (glob matching subset). */

/** Python `fnmatch.fnmatchcase`: shell-style matching of `name` against `pattern`. */
export function fnmatchcase(name: string, pattern: string): boolean {
  return translate(pattern).test(name);
}

const _translated = new Map<string, RegExp>();

/** Python `fnmatch.translate`: `*` -> any, `?` -> one char, `[seq]`/`[!seq]` -> char class. */
function translate(pattern: string): RegExp {
  const cached = _translated.get(pattern);
  if (cached) return cached;
  let i = 0;
  const n = pattern.length;
  let res = '';
  while (i < n) {
    const c = pattern[i];
    i += 1;
    if (c === '*') {
      res += '.*';
    } else if (c === '?') {
      res += '.';
    } else if (c === '[') {
      let j = i;
      if (j < n && pattern[j] === '!') j += 1;
      if (j < n && pattern[j] === ']') j += 1;
      while (j < n && pattern[j] !== ']') j += 1;
      if (j >= n) {
        res += '\\[';
      } else {
        let stuff = pattern.slice(i, j);
        i = j + 1;
        // Python removes empty/reversed ranges like 'z-a'; such ranges match nothing.
        const negate = stuff[0] === '!';
        if (negate) stuff = stuff.slice(1);
        const chars = expand_class(stuff);
        const body = chars.map(([lo, hi]) => lo === hi ? escape_class(lo) : `${escape_class(lo)}-${escape_class(hi)}`).join('');
        if (!body) res += negate ? '.' : '(?!)';
        else res += `[${negate ? '^' : ''}${body}]`;
      }
    } else {
      res += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  const regex = new RegExp(`^(?:${res})$`, 's');
  _translated.set(pattern, regex);
  return regex;
}

function expand_class(stuff: string): [string, string][] {
  const out: [string, string][] = [];
  let k = 0;
  while (k < stuff.length) {
    if (k + 2 < stuff.length && stuff[k + 1] === '-') {
      if (stuff[k] <= stuff[k + 2]) out.push([stuff[k], stuff[k + 2]]);
      k += 3;
    } else {
      out.push([stuff[k], stuff[k]]);
      k += 1;
    }
  }
  return out;
}

function escape_class(c: string): string {
  return /[\\\]\[^-]/.test(c) ? `\\${c}` : c;
}

/** Split comma-separated list (ignore whitespace), e.g. '1- 3, a,b ' -> ('1- 3', 'a', 'b'). */
export function delimited_strings(s: string, delimiter: string = ','): string[] {
  return s.split(delimiter).map(item => item.trim());
}

/** Expand comma-separated int ranges, e.g. '1-3,5,7-8' -> (1, 2, 3, 5, 7, 8). */
export function* int_range(spec: string): Generator<number> {
  for (const span of delimited_strings(spec)) {
    const bounds = span.split('-');
    if (bounds.length === 2) {
      const start = parse_int(bounds[0]);
      const end = parse_int(bounds[1]);
      for (let value = start; value <= end; value++) yield value;
    } else if (bounds.length === 1) {
      yield parse_int(bounds[0]);
    } else {
      throw new Error(`Invalid int span: ${span}`);
    }
  }
}

function parse_int(s: string): number {
  if (!/^\s*[+-]?\d+\s*$/.test(s)) throw new Error(`invalid literal for int(): '${s}'`);
  return parseInt(s, 10);
}

/** Expand comma-separated char ranges, e.g. 'a-c,e' -> ('a', 'b', 'c', 'e'). */
export function* char_range(spec: string): Generator<string> {
  for (const span of delimited_strings(spec)) {
    const bounds = span.split('-');
    if (bounds.length === 2) {
      const start = bounds[0].codePointAt(0)!;
      const end = bounds[1].codePointAt(0)!;
      for (let value = start; value <= end; value++) yield String.fromCodePoint(value);
    } else if (bounds.length === 1 && bounds[0].length) {
      yield bounds[0];
    } else {
      throw new Error(`Invalid char span: ${span}`);
    }
  }
}

/** Expand comma-separated int/char ranges, e.g. 'a-b,1,ab' -> ('a', 'b', 1, 'ab'). */
export function* int_char_range(spec: string, stringify: boolean = false): Generator<string | number> {
  for (const span of delimited_strings(spec)) {
    if ([...span].some(c => /\d/.test(c))) {
      for (const value of int_range(span)) yield stringify ? String(value) : value;
    } else if (span.includes('-')) {
      yield* char_range(span);
    } else {
      yield span;
    }
  }
}

/**
 * Expand glob patterns with [ int/char ranges ] or { string options }, e.g. '{foo,bar}_*_[1-2]'
 * -> (foo_*_1, foo_*_2, bar_*_1, bar_*_2).
 */
export function* glob_range(spec: string): Generator<string> {
  // Convert pattern into [constant_1, spec_1, constant_2, spec_2, ..., constant_n].
  const pieces: string[][] = [];
  let idx = 0;
  // Searches for all specs of form '[...]' and '{...}'.
  for (const expansion of spec.matchAll(/[{\[]([^{}\[\]]*)[}\]]/g)) {
    const sidx = expansion.index!;
    const eidx = sidx + expansion[0].length;
    const group = expansion[0];
    const bracket = group[0];
    const inner = group.slice(1, -1);
    const constant = spec.slice(idx, sidx);
    pieces.push([constant]);
    if (bracket === '{') {
      pieces.push(delimited_strings(inner));
    } else if (bracket === '[') {
      pieces.push([...int_char_range(inner, true)].map(String));
    } else {
      throw new Error('unreachable');
    }
    idx = eidx;
  }
  const constant = spec.slice(idx);
  pieces.push([constant]);
  console.assert(pieces.length % 2 === 1);
  yield* product(pieces).map(prod => prod.join(''));
}

function product(pieces: string[][]): string[][] {
  return pieces.reduce<string[][]>(
    (acc, piece) => acc.flatMap(prefix => piece.map(p => [...prefix, p])),
    [[]],
  );
}

/** Returns all expanded glob patterns. */
export function* glob_ranges(spec: string | Iterable<string>): Generator<string> {
  if (typeof spec === 'string') spec = [spec];
  for (const s of spec) yield* glob_range(s);
}

/** Returns if `test` string matches `spec`, e.g. 'b_foof_1' matches '[a-c]_foo*_[1-3]'. */
export function in_glob_range(spec: string | Iterable<string>, item: string): boolean {
  for (const pattern of glob_ranges(spec)) {
    if (fnmatchcase(item, pattern)) return true;
  }
  return false;
}

/** Returns all `item` strings that match `spec`, e.g. 'b_foof_1' matches '[a-c]_foo*_[1-3]'. */
export function filter_by_glob_range(spec: string | Iterable<string>, items: Iterable<string>): string[] {
  const patterns = [...glob_ranges(spec)];
  return [...items].filter(item => patterns.some(pattern => fnmatchcase(item, pattern)));
}

const _EMPTY = Symbol('EMPTY');

/** Selects a value from `spec` based on first glob pattern that matches `key`. */
export function select_by_glob_range<V, D = never>(
  spec: Iterable<[string, V]>,
  key: string,
  default_: D | typeof _EMPTY = _EMPTY,
): V | D {
  for (const [pattern, value] of spec) {
    if (fnmatchcase(key, pattern)) return value;
  }
  if (default_ !== _EMPTY) return default_;
  throw new Error(`KeyError: No match for key: ${key}`);
}
