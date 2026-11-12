/**
 * A minimal, inference-only stand-in for `torch.Tensor`, covering the operations used by the ported
 * models. Numerics follow PyTorch CPU float32 semantics: every float32 result is rounded to float32
 * on store, and JS `number` scalars entering a float32 operation are rounded to float32 first (as
 * PyTorch casts "wrapped number" scalars to the tensor's dtype). Plain `number` (op) `number` stays
 * float64, matching Python float arithmetic.
 */

export type DType = 'float32' | 'int64' | 'bool';
type Data = Float32Array | Float64Array | Uint8Array;

/** A `Tensor` or a Python-style scalar. */
export type Scalar = number | boolean;
export type TensorLike = Tensor | Scalar;

export function alloc(dtype: DType, size: number): Data {
  switch (dtype) {
    case 'float32': return new Float32Array(size);
    case 'int64': return new Float64Array(size);  // Exact for integers up to 2^53.
    case 'bool': return new Uint8Array(size);
  }
}

function numel(shape: readonly number[]): number {
  return shape.reduce((a, b) => a * b, 1);
}

function contiguous_strides(shape: readonly number[]): number[] {
  const strides = new Array<number>(shape.length);
  let stride = 1;
  for (let i = shape.length - 1; i >= 0; i--) {
    strides[i] = stride;
    stride *= shape[i];
  }
  return strides;
}

function same_shape(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function broadcast_shapes(...shapes: (readonly number[])[]): number[] {
  if (shapes.every(s => same_shape(s, shapes[0]))) return [...shapes[0]];
  const ndim = Math.max(...shapes.map(s => s.length));
  const out = new Array<number>(ndim).fill(1);
  for (const shape of shapes) {
    for (let i = 0; i < shape.length; i++) {
      const o = ndim - shape.length + i;
      const d = shape[i];
      if (out[o] === 1) out[o] = d;
      else if (d !== 1 && d !== out[o]) {
        throw new Error(`Shapes [${shapes.map(s => `[${s}]`).join(', ')}] are not broadcastable.`);
      }
    }
  }
  return out;
}

/** Index map from each flat element of `out_shape` to the flat element of `shape` broadcast to it. */
function broadcast_index(shape: readonly number[], out_shape: readonly number[]): Int32Array {
  const n = numel(out_shape);
  const index = new Int32Array(n);
  if (numel(shape) === n) {
    for (let i = 0; i < n; i++) index[i] = i;
    return index;
  }
  if (numel(shape) === 1) return index;  // All zeros.
  const offset = out_shape.length - shape.length;
  const in_strides = contiguous_strides(shape);
  const out_strides = contiguous_strides(out_shape);
  for (let i = 0; i < n; i++) {
    let rem = i;
    let j = 0;
    for (let d = 0; d < out_shape.length; d++) {
      const coord = Math.floor(rem / out_strides[d]);
      rem -= coord * out_strides[d];
      const k = d - offset;
      if (k >= 0 && shape[k] !== 1) j += coord * in_strides[k];
    }
    index[i] = j;
  }
  return index;
}

function round(dtype: DType, x: number): number {
  switch (dtype) {
    case 'float32': return Math.fround(x);
    case 'int64': return Math.trunc(x);
    case 'bool': return x ? 1 : 0;
  }
}

/** PyTorch type promotion for arithmetic, with `number` scalars treated as Python floats unless they
 * are integers combined with a non-float tensor. */
function promote(a: TensorLike, b: TensorLike): DType {
  const da = a instanceof Tensor ? a.dtype : null;
  const db = b instanceof Tensor ? b.dtype : null;
  if (da === 'float32' || db === 'float32') return 'float32';
  const scalars = [a, b].filter(x => !(x instanceof Tensor)) as Scalar[];
  if (scalars.some(s => typeof s === 'number' && !Number.isInteger(s))) return 'float32';
  return 'int64';
}

export function as_tensor_like(x: TensorLike, dtype: DType): Tensor {
  if (x instanceof Tensor) return x;
  const data = alloc(dtype, 1);
  data[0] = round(dtype, Number(x));
  return new Tensor(data, [], dtype);
}

export function elementwise(
  inputs: TensorLike[],
  dtype: DType,
  fn: (...xs: number[]) => number,
  compute_dtype?: DType,
): Tensor {
  // Scalars enter the operation in the computation dtype, e.g. Python floats become float32.
  const cdtype = compute_dtype ?? dtype;
  const tensors = inputs.map(x => as_tensor_like(x, cdtype === 'bool' ? 'float32' : cdtype));
  const shape = broadcast_shapes(...tensors.map(t => t.shape));
  const n = numel(shape);
  const out = alloc(dtype, n);
  const args = new Array<number>(tensors.length);
  // Fast path: every operand either has the output's size (same shape) or a single element.
  if (tensors.every(t => t.data.length === n || t.data.length === 1)) {
    const strides = tensors.map(t => t.data.length === n ? 1 : 0);
    // Float32Array stores round to float32 themselves; other dtypes need explicit conversion.
    const store = dtype === 'float32' ? (x: number) => x : (x: number) => round(dtype, x);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < tensors.length; k++) args[k] = tensors[k].data[i * strides[k]];
      out[i] = store(fn(...args));
    }
    return new Tensor(out, shape, dtype);
  }
  const indices = tensors.map(t => broadcast_index(t.shape, shape));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < tensors.length; k++) args[k] = tensors[k].data[indices[k][i]];
    out[i] = round(dtype, fn(...args));
  }
  return new Tensor(out, shape, dtype);
}

export class Tensor {
  data: Data;
  shape: number[];
  dtype: DType;

  constructor(data: Data, shape: number[], dtype: DType) {
    if (data.length !== numel(shape)) {
      throw new Error(`Data of length ${data.length} does not match shape [${shape}].`);
    }
    this.data = data;
    this.shape = shape;
    this.dtype = dtype;
  }

  get ndim(): number { return this.shape.length; }
  numel(): number { return this.data.length; }
  size(dim?: number): number | number[] {
    if (dim === undefined) return [...this.shape];
    return this.shape[dim < 0 ? this.ndim + dim : dim];
  }

  item(): number {
    if (this.numel() !== 1) throw new Error(`item() requires 1 element, got shape [${this.shape}].`);
    return this.data[0];
  }

  tolist(): number[] { return Array.from(this.data); }

  clone(): Tensor {
    return new Tensor(this.data.slice(), [...this.shape], this.dtype);
  }

  to(dtype: DType): Tensor {
    if (dtype === this.dtype) return this;
    const out = alloc(dtype, this.numel());
    for (let i = 0; i < out.length; i++) out[i] = round(dtype, this.data[i]);
    return new Tensor(out, [...this.shape], dtype);
  }
  float(): Tensor { return this.to('float32'); }
  int(): Tensor { return this.to('int64'); }

  // ------------------------------------------------------------------------------------------------
  // In-place operations.

  /** `self[:] = value`: copy `value` (broadcast and cast) into this tensor's storage. */
  set_(value: TensorLike): this {
    const src = as_tensor_like(value, this.dtype);
    broadcast_shapes(src.shape, this.shape);  // Validate.
    const index = broadcast_index(src.shape, this.shape);
    for (let i = 0; i < this.data.length; i++) this.data[i] = round(this.dtype, src.data[index[i]]);
    return this;
  }

  fill_(value: Scalar): this { return this.set_(value); }
  add_(other: TensorLike): this { return this.set_(this.add(other)); }

  // ------------------------------------------------------------------------------------------------
  // Arithmetic (`self (op) other`); see `torch.add` etc. for scalar-first forms.

  add(other: TensorLike): Tensor { return elementwise([this, other], promote(this, other), (a, b) => a + b); }
  sub(other: TensorLike): Tensor { return elementwise([this, other], promote(this, other), (a, b) => a - b); }
  mul(other: TensorLike): Tensor { return elementwise([this, other], promote(this, other), (a, b) => a * b); }
  div(other: TensorLike): Tensor { return elementwise([this, other], 'float32', (a, b) => a / b); }
  neg(): Tensor { return elementwise([this], this.dtype === 'bool' ? 'int64' : this.dtype, a => -a); }

  // ------------------------------------------------------------------------------------------------
  // Comparisons (return bool tensors).

  gt(other: TensorLike): Tensor { return compare(this, other, (a, b) => a > b); }
  ge(other: TensorLike): Tensor { return compare(this, other, (a, b) => a >= b); }
  lt(other: TensorLike): Tensor { return compare(this, other, (a, b) => a < b); }
  le(other: TensorLike): Tensor { return compare(this, other, (a, b) => a <= b); }
  eq(other: TensorLike): Tensor { return compare(this, other, (a, b) => a === b); }
  ne(other: TensorLike): Tensor { return compare(this, other, (a, b) => a !== b); }

  // ------------------------------------------------------------------------------------------------
  // Logical operations on bool tensors: Python `&`, `|`, `~`.

  and(other: Tensor): Tensor { return elementwise([this, other], 'bool', (a, b) => a && b ? 1 : 0); }
  or(other: Tensor): Tensor { return elementwise([this, other], 'bool', (a, b) => a || b ? 1 : 0); }
  not(): Tensor {
    if (this.dtype !== 'bool') throw new Error('not() (Python `~`) is only supported for bool tensors.');
    return elementwise([this], 'bool', a => a ? 0 : 1);
  }

  // ------------------------------------------------------------------------------------------------
  // Shape operations.

  reshape(...shape: number[]): Tensor {
    const known = shape.filter(d => d !== -1).reduce((a, b) => a * b, 1);
    const resolved = shape.map(d => d === -1 ? this.numel() / known : d);
    return new Tensor(this.data, resolved, this.dtype);
  }

  unsqueeze(dim: number): Tensor {
    const d = dim < 0 ? this.ndim + 1 + dim : dim;
    const shape = [...this.shape];
    shape.splice(d, 0, 1);
    return new Tensor(this.data, shape, this.dtype);
  }

  broadcast_to(shape: readonly number[]): Tensor {
    const out_shape = broadcast_shapes(this.shape, shape);
    if (out_shape.join() !== shape.join()) {
      throw new Error(`Cannot broadcast [${this.shape}] to [${shape}].`);
    }
    const index = broadcast_index(this.shape, out_shape);
    const out = alloc(this.dtype, index.length);
    for (let i = 0; i < index.length; i++) out[i] = this.data[index[i]];
    return new Tensor(out, out_shape, this.dtype);
  }

  /** Python `self.T`: transpose of a 1D/2D tensor (a copy). */
  get T(): Tensor {
    if (this.ndim < 2) return this;
    if (this.ndim !== 2) throw new Error(`.T is only supported for 1D/2D tensors, got [${this.shape}].`);
    const [rows, cols] = this.shape;
    const out = alloc(this.dtype, this.numel());
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) out[c * rows + r] = this.data[r * cols + c];
    }
    return new Tensor(out, [cols, rows], this.dtype);
  }

  /** Python `self.repeat(n)` for 1D tensors: tiles the whole tensor, e.g. [a, b] -> [a, b, a, b]. */
  repeat(n: number): Tensor {
    if (this.ndim !== 1) throw new Error(`repeat() is only supported for 1D tensors, got [${this.shape}].`);
    return cat(Array.from({ length: n }, () => this), 0);
  }

  /** Python `self.repeat_interleave(n, dim=-1)` for 1D tensors, e.g. [a, b] -> [a, a, b, b]. */
  repeat_interleave(n: number, dim: number = -1): Tensor {
    if (this.ndim !== 1 || (dim !== 0 && dim !== -1)) {
      throw new Error(`repeat_interleave() is only supported along a 1D tensor's only dim, got [${this.shape}].`);
    }
    const out = alloc(this.dtype, this.numel() * n);
    for (let i = 0; i < out.length; i++) out[i] = this.data[Math.floor(i / n)];
    return new Tensor(out, [out.length], this.dtype);
  }

  /** Python `self @ other`. */
  matmul(other: Tensor): Tensor { return matmul(this, other); }

  /** Python `self[i]` along dim 0 (negative indices allowed). Returns a copy. */
  index(i: number): Tensor {
    const n = this.shape[0];
    const j = i < 0 ? n + i : i;
    if (j < 0 || j >= n) throw new Error(`Index ${i} out of range for dim 0 of size ${n}.`);
    const inner = this.shape.slice(1);
    const size = numel(inner);
    return new Tensor(this.data.slice(j * size, (j + 1) * size), inner, this.dtype);
  }

  /** Python `self[start:end]` along dim 0 (negative indices allowed). Returns a copy. */
  slice(start: number | null = null, end: number | null = null): Tensor {
    const n = this.shape[0];
    const norm = (x: number) => Math.min(Math.max(x < 0 ? n + x : x, 0), n);
    const s = start === null ? 0 : norm(start);
    const e = end === null ? n : norm(end);
    const inner = this.shape.slice(1);
    const size = numel(inner);
    const length = Math.max(e - s, 0);
    return new Tensor(this.data.slice(s * size, (s + length) * size), [length, ...inner], this.dtype);
  }

  /** Python `self[indices]` with an integer index tensor/array along dim 0. Returns a copy. */
  take(indices: Tensor | number[]): Tensor {
    const idx = indices instanceof Tensor ? indices.tolist() : indices;
    return cat(idx.map(i => this.index(i).unsqueeze(0)), 0);
  }

  toString(): string {
    return `tensor([${Array.from(this.data).join(', ')}], shape=[${this.shape}], dtype=${this.dtype})`;
  }
}

function compare(a: Tensor, b: TensorLike, fn: (a: number, b: number) => boolean): Tensor {
  return elementwise([a, b], 'bool', (x, y) => fn(x, y) ? 1 : 0, promote(a, b));
}

/**
 * `torch.matmul` for 1D/2D float32 operands. Each dot product is accumulated in float64 and rounded
 * once, so results may differ from PyTorch's BLAS (which accumulates in float32, in an unspecified
 * order) by a few float32 ulps.
 */
export function matmul(a: Tensor, b: Tensor): Tensor {
  if (a.ndim < 1 || a.ndim > 2 || b.ndim < 1 || b.ndim > 2) {
    throw new Error(`matmul supports 1D/2D operands, got [${a.shape}] @ [${b.shape}].`);
  }
  const [m, k] = a.ndim === 1 ? [1, a.shape[0]] : a.shape;
  const [k2, n] = b.ndim === 1 ? [b.shape[0], 1] : b.shape;
  if (k !== k2) throw new Error(`matmul shape mismatch: [${a.shape}] @ [${b.shape}].`);
  const out = new Float32Array(m * n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let p = 0; p < k; p++) sum += a.data[i * k + p] * b.data[p * n + j];
      out[i * n + j] = sum;
    }
  }
  const shape = a.ndim === 1 && b.ndim === 1 ? [] : a.ndim === 1 ? [n] : b.ndim === 1 ? [m] : [m, n];
  return new Tensor(out, shape, 'float32');
}

export function cat(tensors: Tensor[], dim: number = 0): Tensor {
  if (tensors.length === 0) throw new Error('cat() expects a non-empty list of tensors.');
  const ndim = tensors[0].ndim;
  const d = dim < 0 ? ndim + dim : dim;
  const dtype = tensors.some(t => t.dtype === 'float32') ? 'float32'
    : tensors.some(t => t.dtype === 'int64') ? 'int64' : 'bool';
  const outer = numel(tensors[0].shape.slice(0, d));
  const inner = numel(tensors[0].shape.slice(d + 1));
  for (const t of tensors) {
    if (t.ndim !== ndim) throw new Error('cat() expects tensors with the same number of dimensions.');
  }
  const total = tensors.reduce((s, t) => s + t.shape[d], 0);
  const shape = [...tensors[0].shape];
  shape[d] = total;
  const out = alloc(dtype, numel(shape));
  let offset = 0;
  for (const t of tensors) {
    const block = t.shape[d] * inner;
    for (let o = 0; o < outer; o++) {
      for (let k = 0; k < block; k++) {
        out[o * total * inner + offset * inner + k] = round(dtype, t.data[o * block + k]);
      }
    }
    offset += t.shape[d];
  }
  return new Tensor(out, shape, dtype);
}
