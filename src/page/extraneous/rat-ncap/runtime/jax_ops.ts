/**
 * JAX primitives (jaxpr semantics, as lowered by XLA) over NDArrays. Each op takes the evaluated
 * inputs and the eqn's params, and returns its outputs. Control-flow ops (`jit`, `scan`) and the
 * physics primitive are handled by the interpreter (graph.ts).
 */
import {
  NDArray, binary, unary, broadcast_to, reshape, slice, concatenate, reduce, strides, size, astype,
  cast_value, is_float, is_int, type DType,
} from './ndarray.ts';

type Params = Record<string, any>;
export type Op = (inputs: NDArray[], params: Params, out_types: [DType, number[]][]) => NDArray[];

const f32 = Math.fround;

/** Result dtype of an elementwise op = dtype of its first non-weak operand (jaxpr ops are typed). */
function out_dtype(out_types: [DType, number[]][]): DType { return out_types[0][0]; }

function arith(f: (x: number, y: number) => number, fi?: (x: number, y: number) => number): Op {
  return ([a, b], _p, t) => {
    const dtype = out_dtype(t);
    if (dtype === 'float32') return [binary(a, b, dtype, (x, y) => f32(f(x, y)))];
    if (is_float(dtype)) return [binary(a, b, dtype, f)];
    const g = fi ?? f;
    return [binary(a, b, dtype, (x, y) => cast_value(g(x, y), dtype))];
  };
}

function compare(f: (x: number, y: number) => boolean): Op {
  return ([a, b]) => [binary(a, b, 'bool', (x, y) => (f(x, y) ? 1 : 0))];
}

function math1(f: (x: number) => number): Op {
  return ([a], _p, t) => {
    const dtype = out_dtype(t);
    return [unary(a, dtype, dtype === 'float32' ? x => f32(f(x)) : f)];
  };
}

function int32_wrap(x: number): number { return x | 0; }

function logical(fb: (x: number, y: number) => number): Op {
  return ([a, b], _p, t) => {
    const dtype = out_dtype(t);
    if (dtype === 'bool') return [binary(a, b, 'bool', (x, y) => fb(x, y) & 1)];
    if (dtype === 'uint32') return [binary(a, b, dtype, (x, y) => fb(x, y) >>> 0)];
    return [binary(a, b, dtype, (x, y) => fb(x, y) | 0)];
  };
}

/** XLA max/min propagate NaN. */
const nanmax = (x: number, y: number) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : x > y ? x : y);
const nanmin = (x: number, y: number) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : x < y ? x : y);

function int_div(x: number, y: number): number {
  if (y === 0) return -1;  // XLA: x / 0 = -1 for signed integers.
  return Math.trunc(x / y);
}

function integer_pow(x: number, y: number, round: (v: number) => number): number {
  // Mirrors jax's lowering: binary exponentiation with intermediate rounding, then 1/acc if y < 0.
  let n = Math.abs(y);
  let acc: number | null = null;
  let base = x;
  while (n > 0) {
    if (n & 1) acc = acc === null ? base : round(acc * base);
    n >>= 1;
    if (n) base = round(base * base);
  }
  const r = acc === null ? 1 : acc;
  return y < 0 ? round(1 / r) : r;
}

// ==================================================================================================
// Gather / scatter (XLA semantics, index vector dimension last).

function gather([operand, indices]: NDArray[], p: Params, out_types: [DType, number[]][]): NDArray[] {
  const dn = p.dimension_numbers;
  const offset_dims: number[] = dn.offset_dims;
  const collapsed: number[] = dn.collapsed_slice_dims;
  const start_index_map: number[] = dn.start_index_map;
  const op_batch: number[] = dn.operand_batching_dims ?? [];
  const idx_batch: number[] = dn.start_indices_batching_dims ?? [];
  const slice_sizes: number[] = p.slice_sizes;
  const mode: string = p.mode;
  const [dtype, shape] = out_types[0];
  const out = new NDArray(dtype, shape);
  const os = strides(shape), ops = strides(operand.shape);
  const nd_out = shape.length, nd_op = operand.ndim;
  const batch_out_dims = [...Array(nd_out).keys()].filter(d => !offset_dims.includes(d));
  const window_op_dims = [...Array(nd_op).keys()].filter(d => !collapsed.includes(d) && !op_batch.includes(d));
  const idx_shape = indices.shape;
  const nvec = idx_shape[idx_shape.length - 1];
  const idx_batch_shape = idx_shape.slice(0, -1);
  const ibs = strides(idx_batch_shape);
  let fill: number;
  if (p.fill_value !== null && p.fill_value !== undefined) fill = Number(p.fill_value);
  else if (is_float(dtype)) fill = NaN;
  else if (dtype === 'bool') fill = 1;
  else if (dtype.startsWith('uint')) fill = 4294967295;
  else fill = -2147483648;
  const n = out.size;
  // Precomputed index plans (no per-element allocation or searches).
  const is_window = new Uint8Array(nd_op);
  for (const d of window_op_dims) is_window[d] = 1;
  const window_out = new Int32Array(nd_op).fill(-1);
  window_op_dims.forEach((od, k) => { window_out[od] = offset_dims[k]; });
  const nb = batch_out_dims.length;
  const coord = new Int32Array(nd_out);
  const g = new Int32Array(nb);
  const start = new Int32Array(nd_op);
  const fill_or_drop = mode === 'FILL_OR_DROP' || mode === 'ONE_HOT';
  const filled = cast_value(fill, dtype);
  for (let i = 0; i < n; i++) {
    let rem = i;
    for (let d = 0; d < nd_out; d++) {
      const c = (rem / os[d]) | 0;
      coord[d] = c;
      rem -= c * os[d];
    }
    let ib = 0;
    for (let k = 0; k < nb; k++) {
      g[k] = coord[batch_out_dims[k]];
      ib += g[k] * ibs[k];
    }
    start.fill(0);
    let oob = false;
    const base = ib * nvec;
    for (let k = 0; k < nvec; k++) {
      const od = start_index_map[k];
      let s0 = indices.data[base + k];
      const max_start = operand.shape[od] - slice_sizes[od];
      if (fill_or_drop && (s0 < 0 || s0 > max_start)) oob = true;
      start[od] = s0 < 0 ? 0 : s0 > max_start ? max_start : s0;
    }
    for (let k = 0; k < op_batch.length; k++) start[op_batch[k]] = g[idx_batch[k]];
    if (oob) {
      out.data[i] = filled;
      continue;
    }
    let flat = 0;
    for (let od = 0; od < nd_op; od++) {
      const w = window_out[od];
      flat += (w >= 0 ? start[od] + coord[w] : start[od]) * ops[od];
    }
    out.data[i] = operand.data[flat];
  }
  return [out];
}

function scatter_impl(combine: ((old: number, upd: number) => number) | null) {
  return ([operand, indices, updates]: NDArray[], p: Params, out_types: [DType, number[]][]): NDArray[] => {
    const dn = p.dimension_numbers;
    const update_window_dims: number[] = dn.update_window_dims;
    const inserted: number[] = dn.inserted_window_dims;
    const to_operand: number[] = dn.scatter_dims_to_operand_dims;
    const op_batch: number[] = dn.operand_batching_dims ?? [];
    const idx_batch: number[] = dn.scatter_indices_batching_dims ?? [];
    const mode: string = p.mode;
    const dtype = out_types[0][0];
    const out = operand.clone();
    const ops = strides(operand.shape), us = strides(updates.shape);
    const nd_op = operand.ndim, nd_up = updates.ndim;
    const scatter_up_dims = [...Array(nd_up).keys()].filter(d => !update_window_dims.includes(d));
    const window_op_dims = [...Array(nd_op).keys()].filter(d => !inserted.includes(d) && !op_batch.includes(d));
    const window_size = new Array(nd_op).fill(1);
    window_op_dims.forEach((od, k) => { window_size[od] = updates.shape[update_window_dims[k]]; });
    const idx_shape = indices.shape;
    const nvec = idx_shape[idx_shape.length - 1];
    const ibs = strides(idx_shape.slice(0, -1));
    const coord = new Array(nd_up).fill(0);
    const start = new Array(nd_op).fill(0);
    const n = updates.size;
    for (let i = 0; i < n; i++) {
      let rem = i;
      for (let d = 0; d < nd_up; d++) {
        coord[d] = Math.floor(rem / us[d]);
        rem -= coord[d] * us[d];
      }
      const g = scatter_up_dims.map(d => coord[d]);
      let ib = 0;
      for (let k = 0; k < g.length; k++) ib += g[k] * ibs[k];
      start.fill(0);
      for (let k = 0; k < nvec; k++) {
        const od = to_operand[k];
        let s = indices.data[ib * nvec + k];
        if (mode === 'CLIP') s = Math.min(Math.max(s, 0), operand.shape[od] - window_size[od]);
        start[od] = s;
      }
      for (let k = 0; k < op_batch.length; k++) start[op_batch[k]] = g[idx_batch[k]];
      // XLA skips a whole update window that is out of bounds.
      let oob = false;
      for (let od = 0; od < nd_op; od++) {
        if (start[od] < 0 || start[od] > operand.shape[od] - window_size[od]) { oob = true; break; }
      }
      if (oob) continue;
      let flat = 0, w = 0;
      for (let od = 0; od < nd_op; od++) {
        let c = start[od];
        if (window_op_dims.includes(od)) c += coord[update_window_dims[w++]];
        flat += c * ops[od];
      }
      const u = updates.data[i];
      out.data[flat] = combine ? cast_value(combine(out.data[flat], u), dtype) : u;
    }
    return [out];
  };
}

// ==================================================================================================

export const JAX_OPS: Record<string, Op> = {
  add: arith((x, y) => x + y, (x, y) => int32_wrap(x + y)),
  sub: arith((x, y) => x - y, (x, y) => int32_wrap(x - y)),
  mul: arith((x, y) => x * y, (x, y) => Math.imul(x, y)),
  div: arith((x, y) => x / y, int_div),
  max: arith(nanmax, (x, y) => Math.max(x, y)),
  min: arith(nanmin, (x, y) => Math.min(x, y)),
  atan2: arith(Math.atan2),
  pow: arith(Math.pow),
  rem: arith((x, y) => x % y, (x, y) => (y === 0 ? x : x % y)),
  eq: compare((x, y) => x === y),
  ne: compare((x, y) => x !== y),
  lt: compare((x, y) => x < y),
  le: compare((x, y) => x <= y),
  gt: compare((x, y) => x > y),
  ge: compare((x, y) => x >= y),
  and: logical((x, y) => x & y),
  or: logical((x, y) => x | y),
  xor: logical((x, y) => x ^ y),
  not: ([a], _p, t) => {
    const dtype = out_dtype(t);
    return [unary(a, dtype, dtype === 'bool' ? x => (x ? 0 : 1) : dtype === 'uint32' ? x => (~x) >>> 0 : x => ~x)];
  },
  neg: ([a], _p, t) => [unary(a, out_dtype(t), is_int(out_dtype(t)) ? x => int32_wrap(-x) : x => -x)],
  abs: ([a], _p, t) => [unary(a, out_dtype(t), Math.abs)],
  sign: ([a], _p, t) => [unary(a, out_dtype(t), x => (Number.isNaN(x) ? NaN : x > 0 ? 1 : x < 0 ? -1 : x))],
  sqrt: math1(Math.sqrt),
  rsqrt: math1(x => 1 / Math.sqrt(x)),
  exp: math1(Math.exp),
  log: math1(Math.log),
  log1p: math1(Math.log1p),
  expm1: math1(Math.expm1),
  tanh: math1(Math.tanh),
  sin: math1(Math.sin),
  cos: math1(Math.cos),
  tan: math1(Math.tan),
  asin: math1(Math.asin),
  acos: math1(Math.acos),
  atan: math1(Math.atan),
  logistic: math1(x => 1 / (1 + Math.exp(-x))),
  floor: math1(Math.floor),
  ceil: math1(Math.ceil),
  round: math1(x => Math.sign(x) * Math.round(Math.abs(x))),
  is_finite: ([a]) => [unary(a, 'bool', x => (Number.isFinite(x) ? 1 : 0))],
  integer_pow: ([a], p, t) => {
    const dtype = out_dtype(t);
    const round = dtype === 'float32' ? f32 : dtype === 'int32' ? int32_wrap : (v: number) => v;
    return [unary(a, dtype, x => integer_pow(x, p.y, round))];
  },
  square: ([a], _p, t) => [unary(a, out_dtype(t), out_dtype(t) === 'float32' ? x => f32(x * x) : x => x * x)],
  select_n: ([pred, ...cases], _p, t) => {
    const [dtype, shape] = t[0];
    const out = new NDArray(dtype, shape);
    const n = out.size;
    const pv = pred.data, scalar_pred = pv.length === 1;
    const cs = cases.map(c => (c.data.length === n ? c.data : broadcast_to(c, shape).data));
    for (let i = 0; i < n; i++) out.data[i] = cs[pv[scalar_pred ? 0 : i]][i];
    return [out];
  },
  clamp: ([lo, x, hi], _p, t) => {
    const [dtype, shape] = t[0];
    const l = broadcast_to(lo, shape), h = broadcast_to(hi, shape);
    const out = new NDArray(dtype, shape);
    for (let i = 0; i < out.size; i++) out.data[i] = nanmin(nanmax(x.data[i], l.data[i]), h.data[i]);
    return [out];
  },
  convert_element_type: ([a], p) => [astype(a, p.new_dtype)],
  copy: ([a]) => [a],
  copy_p: ([a]) => [a],
  device_put: inputs => inputs,
  optimization_barrier: inputs => inputs,
  stop_gradient: ([a]) => [a],
  broadcast_in_dim: ([a], p) => {
    const shape: number[] = p.shape;
    const dims: number[] = p.broadcast_dimensions;
    // Insert size-1 axes so `a` aligns with `shape`, then numpy-broadcast.
    const aligned = new Array(shape.length).fill(1);
    dims.forEach((d, i) => { aligned[d] = a.shape[i]; });
    const monotonic = dims.every((d, i) => i === 0 || d > dims[i - 1]);
    if (!monotonic) throw new Error('broadcast_in_dim with non-monotonic dimensions');
    return [broadcast_to(reshape(a, aligned), shape)];
  },
  reshape: ([a], p) => {
    if (p.dimensions) throw new Error('reshape with dimensions');
    return [reshape(a, p.new_sizes)];
  },
  squeeze: ([a], p) => [reshape(a, a.shape.filter((_, d) => !p.dimensions.includes(d)))],
  expand_dims: ([a], p) => {
    const shape = [...a.shape];
    for (const d of [...p.dimensions].sort((x: number, y: number) => x - y)) shape.splice(d, 0, 1);
    return [reshape(a, shape)];
  },
  slice: ([a], p) => [slice(a, p.start_indices, p.limit_indices, p.strides ?? undefined)],
  dynamic_slice: ([a, ...starts], p) => {
    const sizes: number[] = p.slice_sizes;
    const st = starts.map((s, d) => Math.min(Math.max(s.item(), 0), a.shape[d] - sizes[d]));
    return [slice(a, st, st.map((s, d) => s + sizes[d]))];
  },
  dynamic_update_slice: ([a, upd, ...starts]) => {
    const out = a.clone();
    const st = starts.map((s, d) => Math.min(Math.max(s.item(), 0), a.shape[d] - upd.shape[d]));
    const as = strides(a.shape), us = strides(upd.shape);
    for (let i = 0; i < upd.size; i++) {
      let rem = i, flat = 0;
      for (let d = 0; d < upd.ndim; d++) {
        const c = Math.floor(rem / us[d]);
        rem -= c * us[d];
        flat += (st[d] + c) * as[d];
      }
      out.data[flat] = upd.data[i];
    }
    return [out];
  },
  concatenate: (inputs, p) => [concatenate(inputs, p.dimension)],
  split: ([a], p) => {
    const outs: NDArray[] = [];
    let start = 0;
    for (const s of p.sizes as number[]) {
      const st = a.shape.map(() => 0), lim = [...a.shape];
      st[p.axis] = start;
      lim[p.axis] = start + s;
      outs.push(slice(a, st, lim));
      start += s;
    }
    return outs;
  },
  transpose: ([a], p) => {
    const { transpose } = require_ndarray();
    return [transpose(a, p.permutation)];
  },
  reduce_sum: ([a], p, t) => {
    const dtype = out_dtype(t);
    return [reduce(a, p.axes, dtype, 0, (acc, x) => acc + x)];
  },
  reduce_max: ([a], p, t) => [reduce(a, p.axes, out_dtype(t), -Infinity, nanmax)],
  reduce_min: ([a], p, t) => [reduce(a, p.axes, out_dtype(t), Infinity, nanmin)],
  reduce_or: ([a], p) => [reduce(a, p.axes, 'bool', 0, (acc, x) => (acc || x ? 1 : 0))],
  reduce_and: ([a], p) => [reduce(a, p.axes, 'bool', 1, (acc, x) => (acc && x ? 1 : 0))],
  reduce_prod: ([a], p, t) => [reduce(a, p.axes, out_dtype(t), 1, (acc, x) => acc * x)],
  argmax: ([a], p, t) => {
    const axis = p.axes[0];
    const dtype = out_dtype(t);
    const outer = size(a.shape.slice(0, axis)), n = a.shape[axis], inner = size(a.shape.slice(axis + 1));
    const out = new NDArray(dtype, t[0][1]);
    for (let o = 0; o < outer; o++) for (let i = 0; i < inner; i++) {
      let best = 0, bv = -Infinity;
      for (let k = 0; k < n; k++) {
        const v = a.data[(o * n + k) * inner + i];
        if (v > bv || (Number.isNaN(v) && !Number.isNaN(bv))) { bv = v; best = k; }
      }
      out.data[o * inner + i] = best;
    }
    return [out];
  },
  iota: (_i, p) => {
    const shape: number[] = p.shape;
    const out = new NDArray(p.dtype, shape);
    const s = strides(shape);
    for (let i = 0; i < out.size; i++) out.data[i] = Math.floor(i / s[p.dimension]) % shape[p.dimension];
    return [out];
  },
  reduce_window: ([a, init], p, t) => {
    // Generic reduce-window (XLA): window dims/strides/padding per dimension.
    const [dtype, shape] = t[0];
    const out = new NDArray(dtype, shape);
    const win: number[] = p.window_dimensions, str: number[] = p.window_strides, pad: number[][] = p.padding;
    const f = { add: (x: number, y: number) => x + y, max: nanmax, min: nanmin, mul: (x: number, y: number) => x * y }[p.kind as string]!;
    const as = strides(a.shape), os = strides(shape), nd = shape.length;
    const wn = size(win), ws = strides(win);
    for (let i = 0; i < out.size; i++) {
      let rem = i;
      const base = new Array(nd);
      for (let d = 0; d < nd; d++) { const c = Math.floor(rem / os[d]); rem -= c * os[d]; base[d] = c * str[d] - pad[d][0]; }
      let acc = init.data[0];
      for (let w = 0; w < wn; w++) {
        let r2 = w, flat = 0, ok = true;
        for (let d = 0; d < nd; d++) {
          const c = Math.floor(r2 / ws[d]); r2 -= c * ws[d];
          const x = base[d] + c;
          if (x < 0 || x >= a.shape[d]) { ok = false; break; }
          flat += x * as[d];
        }
        if (ok) acc = f(acc, a.data[flat]);
      }
      out.data[i] = cast_value(acc, dtype);
    }
    return [out];
  },
  gather,
  scatter: scatter_impl(null),
  'scatter-add': scatter_impl((a, b) => a + b),
  scatter_add: scatter_impl((a, b) => a + b),
};

import * as ndarray_module from './ndarray.ts';
function require_ndarray() { return ndarray_module; }
