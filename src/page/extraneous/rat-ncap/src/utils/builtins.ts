/**
 * Python builtins whose semantics differ from their closest JavaScript equivalents.
 */

/** Python `bool(x)`: `None`, `False`, `0`, `''`, and empty containers are falsy. */
export function bool(x: unknown): boolean {
  if (x === null || x === undefined) return false;
  if (typeof x === 'boolean') return x;
  if (typeof x === 'number') return x !== 0;
  if (typeof x === 'string') return x.length > 0;
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === 'object' && 'size' in x && typeof x.size === 'number') return x.size > 0;
  return true;
}

/** Python `str(x)` for the values that appear in reprs (`None`, `True`, `False`, numbers, strings). */
export function str(x: unknown): string {
  if (x === null || x === undefined) return 'None';
  if (x === true) return 'True';
  if (x === false) return 'False';
  return String(x);
}

/** Python `s.split(sep, 1)`. */
export function split1(s: string, sep: string): string[] {
  const i = s.indexOf(sep);
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + sep.length)];
}

/** Python `s.rsplit(sep, 1)`. */
export function rsplit1(s: string, sep: string): string[] {
  const i = s.lastIndexOf(sep);
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + sep.length)];
}

/** Python `zip(*iterables)`, truncating to the shortest. */
export function zip<A extends unknown[][]>(...arrays: A): { [K in keyof A]: A[K][number] }[] {
  const length = Math.min(...arrays.map(a => a.length));
  return Array.from({ length }, (_, i) => arrays.map(a => a[i])) as { [K in keyof A]: A[K][number] }[];
}

/** Python `range(stop)` / `range(start, stop[, step])` as an array. */
export function range(start: number, stop?: number, step: number = 1): number[] {
  if (stop === undefined) [start, stop] = [0, start];
  const out: number[] = [];
  for (let i = start; step > 0 ? i < stop : i > stop; i += step) out.push(i);
  return out;
}

/** Python `sorted(strings)`: code-point order, unlike `Array.prototype.sort`'s UTF-16 order. */
export function sorted(items: Iterable<string>): string[] {
  return [...items].sort((a, b) => {
    const x = [...a], y = [...b];
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
      if (d !== 0) return d;
    }
    return x.length - y.length;
  });
}
