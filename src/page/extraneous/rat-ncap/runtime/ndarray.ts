/**
 * Minimal n-dimensional arrays for the graph interpreter: contiguous row-major typed arrays.
 *
 * dtypes follow numpy names. Storage: float32 -> Float32Array, float64 -> Float64Array,
 * int32 -> Int32Array, uint32 -> Uint32Array, bool/uint8 -> Uint8Array, int64 -> Float64Array
 * (exact up to 2^53; only used for torch indices). JAX key arrays ('key<...>') store their raw
 * uint32 key data with the key dimensions appended to `shape`.
 */

export type DType = string;
export type TypedArray = Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array;

export class NDArray {
  dtype: DType;
  shape: number[];
  data: TypedArray;
  constructor(dtype: DType, shape: number[], data?: TypedArray) {
    this.dtype = dtype;
    this.shape = shape;
    const n = size(shape) * (is_key(dtype) ? 2 : 1);
    this.data = data ?? alloc(dtype, n);
    if (this.data.length !== n) {
      throw new Error(`NDArray ${dtype}[${shape}]: data length ${this.data.length} != ${n}`);
    }
  }
  get size(): number { return size(this.shape); }
  get ndim(): number { return this.shape.length; }
  /** Value of a size-1 array. */
  item(): number { return this.data[0]; }
  clone(): NDArray { return new NDArray(this.dtype, [...this.shape], this.data.slice()); }
}

export function is_key(dtype: DType): boolean { return dtype.startsWith('key<'); }
export function is_float(dtype: DType): boolean { return dtype === 'float32' || dtype === 'float64' || dtype === 'float16'; }
export function is_int(dtype: DType): boolean { return dtype.startsWith('int') || dtype.startsWith('uint'); }

export function size(shape: readonly number[]): number {
  let n = 1;
  for (const d of shape) n *= d;
  return n;
}

export function alloc(dtype: DType, n: number): TypedArray {
  switch (dtype) {
    case 'float32': return new Float32Array(n);
    case 'float64': case 'int64': return new Float64Array(n);
    case 'int32': case 'int16': case 'int8': return new Int32Array(n);
    case 'uint32': return new Uint32Array(n);
    case 'bool': case 'uint8': return new Uint8Array(n);
    default:
      if (is_key(dtype)) return new Uint32Array(n);
      throw new Error(`Unsupported dtype ${dtype}`);
  }
}

/** Casts a JS number to a dtype's value semantics (as stored). */
export function cast_value(x: number, dtype: DType): number {
  switch (dtype) {
    case 'float32': return Math.fround(x);
    case 'float64': return x;
    case 'bool': return x !== 0 && !Number.isNaN(x) ? 1 : (Number.isNaN(x) ? 1 : 0);
    case 'int32': return float_to_int(x, -2147483648, 2147483647);
    case 'uint32': return float_to_int(x, 0, 4294967295);
    case 'int64': return Math.trunc(x);
    case 'uint8': return float_to_int(x, 0, 255);
    default: return x;
  }
}

function float_to_int(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return 0;
  const t = Math.trunc(x);
  return t < lo ? lo : t > hi ? hi : t;
}

export function scalar(value: number, dtype: DType): NDArray {
  const a = new NDArray(dtype, []);
  a.data[0] = cast_value(value, dtype);
  return a;
}

export function full(shape: number[], value: number, dtype: DType): NDArray {
  const a = new NDArray(dtype, shape);
  a.data.fill(cast_value(value, dtype) as never);
  return a;
}

export function strides(shape: readonly number[]): number[] {
  const s = new Array(shape.length);
  let n = 1;
  for (let i = shape.length - 1; i >= 0; i--) {
    s[i] = n;
    n *= shape[i];
  }
  return s;
}

/** Converts every element to `dtype` (numeric conversion; bool -> 0/1). */
export function astype(a: NDArray, dtype: DType): NDArray {
  if (a.dtype === dtype) return a;
  const out = new NDArray(dtype, [...a.shape]);
  const src = a.data, dst = out.data;
  if (dtype === 'bool') {
    for (let i = 0; i < src.length; i++) dst[i] = src[i] !== 0 ? 1 : 0;
  } else if (is_float(dtype)) {
    for (let i = 0; i < src.length; i++) dst[i] = src[i];
  } else {
    for (let i = 0; i < src.length; i++) dst[i] = cast_value(src[i], dtype);
  }
  return out;
}

/** numpy-style broadcast shape. */
export function broadcast_shapes(a: readonly number[], b: readonly number[]): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = a[a.length - n + i] ?? 1, y = b[b.length - n + i] ?? 1;
    if (x !== y && x !== 1 && y !== 1) throw new Error(`Cannot broadcast [${a}] with [${b}]`);
    out[i] = x === 1 ? y : x;
  }
  return out;
}

/** Index map from an output (broadcast) position to the flat index of `shape` (numpy broadcasting). */
export function broadcast_index(shape: readonly number[], out_shape: readonly number[]): Int32Array {
  const n = size(out_shape);
  const idx = new Int32Array(n);
  const nd = out_shape.length;
  const s = strides(shape);
  const os = strides(out_shape);
  const off = nd - shape.length;
  for (let i = 0; i < n; i++) {
    let rem = i, flat = 0;
    for (let d = 0; d < nd; d++) {
      const c = Math.floor(rem / os[d]);
      rem -= c * os[d];
      const sd = d - off;
      if (sd >= 0 && shape[sd] !== 1) flat += c * s[sd];
    }
    idx[i] = flat;
  }
  return idx;
}

/** Applies `f` elementwise with numpy broadcasting; values are read as numbers. */
export function binary(
  a: NDArray, b: NDArray, dtype: DType, f: (x: number, y: number) => number,
): NDArray {
  const shape = a.shape.length === b.shape.length && a.shape.every((d, i) => d === b.shape[i])
    ? [...a.shape] : broadcast_shapes(a.shape, b.shape);
  const out = new NDArray(dtype, shape);
  const n = out.data.length, x = a.data, y = b.data, o = out.data;
  if (x.length === n && y.length === n) {
    for (let i = 0; i < n; i++) o[i] = f(x[i], y[i]);
  } else if (y.length === 1 && x.length === n) {
    const v = y[0];
    for (let i = 0; i < n; i++) o[i] = f(x[i], v);
  } else if (x.length === 1 && y.length === n) {
    const v = x[0];
    for (let i = 0; i < n; i++) o[i] = f(v, y[i]);
  } else {
    const ia = broadcast_index(a.shape, shape), ib = broadcast_index(b.shape, shape);
    for (let i = 0; i < n; i++) o[i] = f(x[ia[i]], y[ib[i]]);
  }
  return out;
}

export function unary(a: NDArray, dtype: DType, f: (x: number) => number): NDArray {
  const out = new NDArray(dtype, [...a.shape]);
  const x = a.data, o = out.data;
  for (let i = 0; i < x.length; i++) o[i] = f(x[i]);
  return out;
}

/** Broadcasts `a` to `shape` (numpy rules). */
export function broadcast_to(a: NDArray, shape: number[]): NDArray {
  if (a.shape.length === shape.length && a.shape.every((d, i) => d === shape[i])) return a;
  const out = new NDArray(a.dtype, [...shape]);
  if (a.data.length === 1) {
    out.data.fill(a.data[0] as never);
    return out;
  }
  const idx = broadcast_index(a.shape, shape);
  for (let i = 0; i < idx.length; i++) out.data[i] = a.data[idx[i]];
  return out;
}

export function reshape(a: NDArray, shape: number[]): NDArray {
  if (size(shape) !== a.size) throw new Error(`reshape [${a.shape}] -> [${shape}]`);
  return new NDArray(a.dtype, [...shape], a.data);
}

/** General transpose: out[i...] = a[perm-permuted index]. */
export function transpose(a: NDArray, perm: number[]): NDArray {
  const shape = perm.map(p => a.shape[p]);
  const out = new NDArray(a.dtype, shape);
  const s = strides(a.shape), os = strides(shape);
  const n = out.size, nd = shape.length;
  for (let i = 0; i < n; i++) {
    let rem = i, flat = 0;
    for (let d = 0; d < nd; d++) {
      const c = Math.floor(rem / os[d]);
      rem -= c * os[d];
      flat += c * s[perm[d]];
    }
    out.data[i] = a.data[flat];
  }
  return out;
}

/** Strided slice: start/limit/step per dimension. */
export function slice(a: NDArray, start: number[], limit: number[], step?: number[]): NDArray {
  const nd = a.ndim;
  const st = step ?? new Array(nd).fill(1);
  const shape = start.map((s, d) => Math.max(0, Math.ceil((limit[d] - s) / st[d])));
  const out = new NDArray(a.dtype, shape);
  const s = strides(a.shape), os = strides(shape);
  const n = out.size;
  if (nd === 1) {
    for (let i = 0; i < n; i++) out.data[i] = a.data[start[0] + i * st[0]];
    return out;
  }
  for (let i = 0; i < n; i++) {
    let rem = i, flat = 0;
    for (let d = 0; d < nd; d++) {
      const c = Math.floor(rem / os[d]);
      rem -= c * os[d];
      flat += (start[d] + c * st[d]) * s[d];
    }
    out.data[i] = a.data[flat];
  }
  return out;
}

export function concatenate(arrays: NDArray[], axis: number): NDArray {
  const shape = [...arrays[0].shape];
  shape[axis] = arrays.reduce((n, a) => n + a.shape[axis], 0);
  const out = new NDArray(arrays[0].dtype, shape);
  const outer = size(shape.slice(0, axis));
  const inner = size(shape.slice(axis + 1));
  let offset = 0;
  for (const a of arrays) {
    const chunk = a.shape[axis] * inner;
    for (let o = 0; o < outer; o++) {
      out.data.set(a.data.subarray(o * chunk, (o + 1) * chunk), o * shape[axis] * inner + offset);
    }
    offset += chunk;
  }
  return out;
}

/** Reduces over `axes` with `f`, starting from `init`. */
export function reduce(
  a: NDArray, axes: number[], dtype: DType, init: number, f: (acc: number, x: number) => number,
): NDArray {
  const keep = a.shape.map((_, d) => !axes.includes(d));
  const shape = a.shape.filter((_, d) => keep[d]);
  const out = full(shape, init, dtype);
  const s = strides(a.shape), os = strides(shape);
  const n = a.size, nd = a.ndim;
  const acc = new Float64Array(out.size).fill(init);
  for (let i = 0; i < n; i++) {
    let rem = i, flat = 0, k = 0;
    for (let d = 0; d < nd; d++) {
      const c = Math.floor(rem / s[d]);
      rem -= c * s[d];
      if (keep[d]) flat += c * os[k++];
    }
    acc[flat] = f(acc[flat], a.data[i]);
  }
  for (let i = 0; i < acc.length; i++) out.data[i] = cast_value(acc[i], dtype);
  return out;
}
