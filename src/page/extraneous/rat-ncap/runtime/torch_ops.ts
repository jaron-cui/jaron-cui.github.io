/**
 * ATen ops (as left by `torch.export(...).run_decompositions()`) over NDArrays. Inputs arrive in
 * schema order: tensors as NDArrays, scalars as numbers, lists as arrays, `None` as null; dtype
 * arguments as {dtype}. Results follow PyTorch broadcasting and type promotion.
 */
import {
  NDArray, binary, unary, broadcast_to, broadcast_shapes, reshape, slice, concatenate, strides,
  astype, transpose, full, cast_value, is_float, type DType,
} from './ndarray.ts';

type Arg = any;
export type TorchOp = (args: Arg[], params: Record<string, Arg>, out_type: [DType, number[]]) => NDArray;

const f32 = Math.fround;

let _seed = 0x9e3779b9;
/** Seeds the generator behind `randn_like` (or makes it return zeros, for noise-free runs). */
export let randn_mode: 'random' | 'zeros' = 'random';
export function set_randn(mode: 'random' | 'zeros', seed = 0) {
  randn_mode = mode;
  _seed = (seed * 2654435761) >>> 0 || 1;
}
function uniform(): number {
  // xorshift32
  _seed ^= _seed << 13; _seed >>>= 0;
  _seed ^= _seed >>> 17;
  _seed ^= _seed << 5; _seed >>>= 0;
  return (_seed + 0.5) / 4294967296;
}
function gaussian(): number {
  return Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

function as_array(x: Arg, like_dtype: DType): NDArray {
  if (x instanceof NDArray) return x;
  if (typeof x === 'boolean') return full([], x ? 1 : 0, 'bool');
  return full([], x, Number.isInteger(x) && !is_float(like_dtype) && like_dtype !== 'bool' ? like_dtype : (is_float(like_dtype) ? like_dtype : 'float32'));
}

/** Elementwise with the dtype torch reports for the output (from the graph's type table). */
function elementwise(f: (x: number, y: number) => number): TorchOp {
  return ([a, b], _p, [dtype]) => {
    const A = as_array(a, dtype), B = as_array(b, dtype);
    if (dtype === 'float32') return binary(A, B, dtype, (x, y) => f32(f(x, y)));
    if (is_float(dtype)) return binary(A, B, dtype, f);
    return binary(A, B, dtype, (x, y) => cast_value(f(x, y), dtype));
  };
}

function compare(f: (x: number, y: number) => boolean): TorchOp {
  return ([a, b]) => {
    const A = a instanceof NDArray ? a : as_array(b, 'float32');
    const B = b instanceof NDArray ? b : full([], b, 'float64');
    return binary(a instanceof NDArray ? a : full([], a, 'float64'), B, 'bool', (x, y) => (f(x, y) ? 1 : 0));
  };
}

function math1(f: (x: number) => number): TorchOp {
  return ([a], _p, [dtype]) => unary(astype(a, dtype), dtype, dtype === 'float32' ? x => f32(f(x)) : f);
}

function norm_dim(d: number, nd: number): number { return d < 0 ? d + nd : d; }

function clamp_value(x: number, lo: number | null, hi: number | null): number {
  if (Number.isNaN(x)) return x;
  if (lo !== null && x < lo) x = lo;
  if (hi !== null && x > hi) x = hi;
  return x;
}

function matmul(a: NDArray, b: NDArray, dtype: DType): NDArray {
  const [n, k] = a.shape, [k2, m] = b.shape;
  if (k !== k2) throw new Error(`mm [${a.shape}] x [${b.shape}]`);
  const out = new NDArray(dtype, [n, m]);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    let acc = 0;
    for (let l = 0; l < k; l++) acc += a.data[i * k + l] * b.data[l * m + j];
    out.data[i * m + j] = acc;
  }
  return out;
}

export const TORCH_OPS: Record<string, TorchOp> = {
  'aten.add.Tensor': ([a, b, alpha], p, t) => elementwise((x, y) => x + (alpha ?? 1) * y)([a, b], p, t),
  'aten.sub.Tensor': ([a, b, alpha], p, t) => elementwise((x, y) => x - (alpha ?? 1) * y)([a, b], p, t),
  'aten.mul.Tensor': elementwise((x, y) => x * y),
  'aten.div.Tensor': elementwise((x, y) => x / y),
  'aten.eq.Tensor': compare((x, y) => x === y),
  'aten.eq.Scalar': compare((x, y) => x === y),
  'aten.ne.Tensor': compare((x, y) => x !== y),
  'aten.ne.Scalar': compare((x, y) => x !== y),
  'aten.lt.Tensor': compare((x, y) => x < y),
  'aten.lt.Scalar': compare((x, y) => x < y),
  'aten.le.Tensor': compare((x, y) => x <= y),
  'aten.le.Scalar': compare((x, y) => x <= y),
  'aten.gt.Tensor': compare((x, y) => x > y),
  'aten.gt.Scalar': compare((x, y) => x > y),
  'aten.ge.Tensor': compare((x, y) => x >= y),
  'aten.ge.Scalar': compare((x, y) => x >= y),
  'aten.bitwise_and.Tensor': ([a, b], _p, [dtype]) => binary(a, b, dtype, (x, y) => x & y),
  'aten.bitwise_or.Tensor': ([a, b], _p, [dtype]) => binary(a, b, dtype, (x, y) => x | y),
  'aten.bitwise_not.default': ([a], _p, [dtype]) => unary(a, dtype, dtype === 'bool' ? x => (x ? 0 : 1) : x => ~x),
  'aten.logical_not.default': ([a]) => unary(a, 'bool', x => (x ? 0 : 1)),
  'aten.neg.default': ([a], _p, [dtype]) => unary(a, dtype, x => -x),
  'aten.abs.default': ([a], _p, [dtype]) => unary(a, dtype, Math.abs),
  'aten.sign.default': ([a], _p, [dtype]) => unary(a, dtype, x => (x > 0 ? 1 : x < 0 ? -1 : x)),
  'aten.exp.default': math1(Math.exp),
  'aten.log.default': math1(Math.log),
  'aten.sqrt.default': math1(Math.sqrt),
  'aten.tanh.default': math1(Math.tanh),
  'aten.sigmoid.default': math1(x => 1 / (1 + Math.exp(-x))),
  'aten.reciprocal.default': math1(x => 1 / x),
  'aten.relu.default': math1(x => (x > 0 ? x : 0)),
  'aten.hardtanh.default': ([a, lo, hi], _p, [dtype]) => unary(a, dtype, x => clamp_value(x, lo ?? -1, hi ?? 1)),
  'aten.clamp.default': ([a, lo, hi], _p, [dtype]) => unary(astype(a, dtype), dtype, x => cast_value(clamp_value(x, lo, hi), dtype)),
  'aten.clamp.Tensor': ([a, lo, hi], _p, [dtype, shape]) => {
    const A = broadcast_to(astype(a, dtype), shape);
    const L = lo ? broadcast_to(lo, shape) : null, H = hi ? broadcast_to(hi, shape) : null;
    const out = new NDArray(dtype, shape);
    for (let i = 0; i < out.size; i++) out.data[i] = clamp_value(A.data[i], L ? L.data[i] : null, H ? H.data[i] : null);
    return out;
  },
  'aten.where.self': ([c, a, b], _p, [dtype, shape]) => {
    const C = broadcast_to(c, shape), A = broadcast_to(astype(as_array(a, dtype), dtype), shape), B = broadcast_to(astype(as_array(b, dtype), dtype), shape);
    const out = new NDArray(dtype, shape);
    for (let i = 0; i < out.size; i++) out.data[i] = C.data[i] ? A.data[i] : B.data[i];
    return out;
  },
  'aten.clone.default': ([a]) => a,
  'aten.alias.default': ([a]) => a,
  'aten.lift_fresh_copy.default': ([a]) => a,
  'aten._to_copy.default': ([a], p, [dtype]) => astype(a, dtype),
  // Functional `copy_`: the result has `self`'s shape/dtype and `src`'s values.
  'aten.copy.default': ([self, src], _p, [dtype, shape]) => astype(broadcast_to(as_array(src, dtype), shape), dtype),
  'aten.expand.default': ([a, sizes]) => {
    const nd = sizes.length, off = nd - a.ndim;
    const shape = sizes.map((s: number, d: number) => (s === -1 ? a.shape[d - off] : s));
    return broadcast_to(a, shape);
  },
  'aten.full.default': ([sizes, value], p, [dtype]) => full(sizes, value, dtype),
  'aten.zeros_like.default': ([a], _p, [dtype]) => full([...a.shape], 0, dtype),
  'aten.ones_like.default': ([a], _p, [dtype]) => full([...a.shape], 1, dtype),
  'aten.randn_like.default': ([a], _p, [dtype]) => {
    const out = new NDArray(dtype, [...a.shape]);
    if (randn_mode === 'random') for (let i = 0; i < out.size; i++) out.data[i] = gaussian();
    return out;
  },
  'aten.view.default': ([a, sizes]) => {
    const known = sizes.filter((s: number) => s !== -1).reduce((x: number, y: number) => x * y, 1);
    return reshape(a, sizes.map((s: number) => (s === -1 ? a.size / known : s)));
  },
  'aten._unsafe_view.default': ([a, sizes]) => TORCH_OPS['aten.view.default']([a, sizes], {}, ['', []]),
  'aten.reshape.default': ([a, sizes]) => TORCH_OPS['aten.view.default']([a, sizes], {}, ['', []]),
  'aten.unsqueeze.default': ([a, dim]) => {
    const shape = [...a.shape];
    shape.splice(norm_dim(dim, a.ndim + 1), 0, 1);
    return reshape(a, shape);
  },
  'aten.squeeze.dims': ([a, dims]) => {
    const ds = (dims as number[]).map(d => norm_dim(d, a.ndim));
    return reshape(a, a.shape.filter((s: number, d: number) => !(ds.includes(d) && s === 1)));
  },
  'aten.squeeze.dim': ([a, dim]) => TORCH_OPS['aten.squeeze.dims']([a, [dim]], {}, ['', []]),
  'aten.permute.default': ([a, dims]) => transpose(a, (dims as number[]).map(d => norm_dim(d, a.ndim))),
  'aten.t.default': ([a]) => transpose(a, [1, 0]),
  'aten.select.int': ([a, dim, index]) => {
    const d = norm_dim(dim, a.ndim);
    const i = index < 0 ? index + a.shape[d] : index;
    const st = a.shape.map(() => 0), lim = [...a.shape];
    st[d] = i;
    lim[d] = i + 1;
    return reshape(slice(a, st, lim), a.shape.filter((_: number, k: number) => k !== d));
  },
  'aten.slice.Tensor': ([a, dim, start, end, step]) => {
    const d = norm_dim(dim ?? 0, a.ndim);
    const n = a.shape[d];
    const clampi = (x: number) => Math.min(Math.max(x < 0 ? x + n : x, 0), n);
    const s = clampi(start ?? 0), e = clampi(end ?? n);
    const st = a.shape.map(() => 0), lim = [...a.shape], stp = a.shape.map(() => 1);
    st[d] = s;
    lim[d] = Math.max(e, s);
    stp[d] = step ?? 1;
    return slice(a, st, lim, stp);
  },
  'aten.cat.default': ([tensors, dim], _p, [dtype]) => {
    const ts = (tensors as NDArray[]).filter(t => !(t.ndim === 1 && t.size === 0)).map(t => astype(t, dtype));
    return concatenate(ts, norm_dim(dim ?? 0, ts[0].ndim));
  },
  'aten.mm.default': ([a, b], _p, [dtype]) => matmul(a, b, dtype),
  'aten.addmm.default': ([bias, a, b, beta, alpha], _p, [dtype, shape]) => {
    const m = matmul(a, b, 'float64');
    const B = broadcast_to(bias, shape);
    const out = new NDArray(dtype, shape);
    for (let i = 0; i < out.size; i++) out.data[i] = (beta ?? 1) * B.data[i] + (alpha ?? 1) * m.data[i];
    return out;
  },
  'aten.index.Tensor': ([a, indices], _p, [dtype, shape]) => {
    // Advanced indexing with index tensors on a prefix of dimensions (None = full slice).
    const idx = indices as (NDArray | null)[];
    const first = idx.findIndex(x => x !== null);
    const tensors = idx.filter(x => x !== null) as NDArray[];
    if (idx.slice(first, first + tensors.length).some(x => x === null)) {
      throw new Error('aten.index.Tensor: non-adjacent index tensors');
    }
    const bshape = tensors.reduce((s, t) => broadcast_shapes(s, t.shape), [] as number[]);
    const bt = tensors.map(t => broadcast_to(t, bshape));
    const before = a.shape.slice(0, first), after = a.shape.slice(first + tensors.length);
    const out = new NDArray(dtype, shape);
    const as = strides(a.shape);
    const nb = bt[0].size;
    const pre = before.reduce((x: number, y: number) => x * y, 1), post = after.reduce((x: number, y: number) => x * y, 1);
    let o = 0;
    for (let p0 = 0; p0 < pre; p0++) for (let b = 0; b < nb; b++) {
      let base = p0 * (first > 0 ? as[first - 1] : 0);
      for (let k = 0; k < bt.length; k++) {
        let v = bt[k].data[b];
        if (v < 0) v += a.shape[first + k];
        base += v * as[first + k];
      }
      for (let q = 0; q < post; q++) out.data[o++] = a.data[base + q];
    }
    return out;
  },
};
