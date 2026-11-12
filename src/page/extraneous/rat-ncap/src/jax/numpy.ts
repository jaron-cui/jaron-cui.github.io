/**
 * A minimal stand-in for `jax.numpy` (as `jnp`), built on the `torch` shim's `Tensor`. JAX runs in
 * float32 here (x64 disabled), with Python scalars weakly typed to the array's dtype, matching the
 * shim's semantics. Python operators on arrays map to `Tensor` methods (`a + b` -> `a.add(b)`).
 *
 * Indexing: `x[idx]` with an int array -> `jnp.take(x, idx)`; `x.at[idx].set(v)` ->
 * `jnp.at(x, idx).set(v)` (returns a new array, as in JAX).
 */
import * as torch from '../torch';
import { Tensor, TensorLike, elementwise } from '../torch/tensor';

export type Array = Tensor;
export type ArrayLike = Tensor | number | boolean | number[] | boolean[];
export type DType = 'float32' | 'int32' | 'bool';

export const pi = Math.PI;
export const inf = Infinity;

function to_dtype(dtype: DType | undefined): torch.DType | undefined {
  return dtype === 'int32' ? 'int64' : dtype;
}

// ==================================================================================================
// Construction.

/**
 * Conversions of JS arrays (e.g. constant tuples stored on transforms), keyed by array and dtype.
 * Under `jax.jit` these are constants; caching avoids re-converting them every substep. Callers
 * get a copy, so the cache cannot be mutated.
 */
const _asarray_cache = new WeakMap<object, Map<string, Array>>();

/** `jnp.asarray(x, dtype=...)`. Python floats/lists become float32, booleans become bool. */
export function asarray(x: ArrayLike, { dtype }: { dtype?: DType } = {}): Array {
  if (x instanceof Tensor) return dtype === undefined ? x : x.to(to_dtype(dtype)!);
  if (!Array.isArray(x)) return torch.tensor(x, { dtype: to_dtype(dtype) });
  let cache = _asarray_cache.get(x);
  if (cache === undefined) _asarray_cache.set(x, cache = new Map());
  let array = cache.get(dtype ?? '');
  if (array === undefined) cache.set(dtype ?? '', array = torch.tensor(x as number[], { dtype: to_dtype(dtype) }));
  return array.clone();
}
export const array = asarray;

function shape_of(shape: number | number[]): number[] {
  return typeof shape === 'number' ? [shape] : shape;
}

export function zeros(shape: number | number[], { dtype = 'float32' }: { dtype?: DType } = {}): Array {
  return torch.full(shape_of(shape), 0, { dtype: to_dtype(dtype) });
}

export function ones(shape: number | number[], { dtype = 'float32' }: { dtype?: DType } = {}): Array {
  return torch.full(shape_of(shape), 1, { dtype: to_dtype(dtype) });
}

export function zeros_like(x: Array): Array { return torch.zeros_like(x); }
export function ones_like(x: Array): Array { return torch.ones_like(x); }

export function broadcast_to(x: ArrayLike, shape: number[]): Array {
  return asarray(x).broadcast_to(shape);
}

/** `jnp.concatenate(arrays, axis=0)`. */
export function concatenate(arrays: Array[], axis: number = 0): Array {
  return torch.cat(arrays.map(a => a.ndim === 0 ? a.reshape(1) : a), axis);
}
export const concat = concatenate;

// ==================================================================================================
// Element-wise.

/** `jnp.clip(x, min, max)`, with `null` for an absent bound. */
export function clip(x: Array, min: TensorLike | null = null, max: TensorLike | null = null): Array {
  return torch.clamp(x, min, max);
}

export function where(condition: Array, x: TensorLike, y: TensorLike): Array {
  const dtype = x instanceof Tensor ? x.dtype : y instanceof Tensor ? y.dtype : 'float32';
  return elementwise([condition, x, y], dtype, (c, a, b) => c ? a : b);
}

export function maximum(x: TensorLike, y: TensorLike): Array {
  return elementwise([x, y], 'float32', (a, b) => Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.max(a, b));
}

export function minimum(x: TensorLike, y: TensorLike): Array {
  return elementwise([x, y], 'float32', (a, b) => Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.min(a, b));
}

const unary = (fn: (x: number) => number) => (x: TensorLike): Array => elementwise([x], 'float32', fn);
export const abs = unary(Math.abs);
export const sqrt = unary(Math.sqrt);
export const sin = unary(Math.sin);
export const cos = unary(Math.cos);
export const arcsin = unary(Math.asin);
export const sign = unary(x => x > 0 ? 1 : x < 0 ? -1 : x);
export const deg2rad = unary(x => x * (Math.PI / 180));

export function arctan2(y: TensorLike, x: TensorLike): Array {
  return elementwise([y, x], 'float32', Math.atan2);
}

export function nan_to_num(
  x: Array,
  { nan = 0.0, posinf = 3.4028234663852886e38, neginf = -3.4028234663852886e38 }:
    { nan?: TensorLike, posinf?: TensorLike, neginf?: TensorLike } = {},
): Array {
  return elementwise([x, nan, posinf, neginf], 'float32', (v, n, p, m) =>
    Number.isNaN(v) ? n : v === Infinity ? p : v === -Infinity ? m : v);
}

export function logical_or(x: Array, y: Array): Array { return x.or(y); }

// ==================================================================================================
// Reductions.

export function any(x: Array): Array {
  return torch.tensor(x.tolist().some(v => v !== 0));
}

export function sum(x: Array): Array {
  return torch.tensor([x.tolist().reduce((a, b) => a + b, 0)]).reshape();
}

export namespace linalg {
  /** `jnp.linalg.norm(x)` (2-norm of a flattened array). */
  export function norm(x: Array): Array {
    return torch.tensor([Math.sqrt(x.tolist().reduce((a, b) => a + b * b, 0))]).reshape();
  }
}

// ==================================================================================================
// Indexing.

/** `x[idx]` for an int index array along axis 0. */
export function take(x: Array, idx: number[] | Array): Array {
  const indices = idx instanceof Tensor ? idx.tolist() : idx;
  if (x.ndim !== 1) return x.take(indices);
  const out = torch.zeros([indices.length], { dtype: x.dtype });
  indices.forEach((j, i) => { out.data[i] = x.data[j]; });
  return out;
}

/** `x[start:end]` along axis 0. */
export function slice(x: Array, start: number | null, end: number | null = null): Array {
  return x.slice(start, end);
}

/** `x.at[idx]`: functional updates that return a new array. */
export function at(x: Array, idx: number | number[] | Array) {
  const indices = typeof idx === 'number' ? [idx] : idx instanceof Tensor ? idx.tolist() : idx;
  return {
    /** `x.at[idx].set(values)`. */
    set(values: TensorLike): Array {
      if (x.ndim !== 1) throw new Error('at[].set() is only supported for 1D arrays.');
      const out = x.clone();
      const v = asarray(values as ArrayLike).to(x.dtype).broadcast_to([indices.length]);
      indices.forEach((j, i) => { out.data[j] = v.data[i]; });
      return out;
    },
  };
}
