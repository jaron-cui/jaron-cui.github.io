/**
 * Compiles a flattened JAX `Program` (graph.ts) to JavaScript source, exploiting that every shape
 * and dtype is static:
 *
 * - Values of up to MAX_UNROLL elements live in one preallocated Float64Array register file at
 *   static offsets (no allocation per op); larger values live in a slot array as typed arrays.
 * - Elementwise ops, converts, selects, broadcasts, slices, concatenations, reductions and
 *   integer powers on small arrays become straight-line expressions with static index maps
 *   (float32 results rounded with Math.fround, int32 with |0), so no per-op dispatch or allocation
 *   of wrappers remains.
 * - Everything else (gather, scatter, large arrays, scan, physics) calls the generic implementation
 *   with NDArray wrappers.
 *
 * The code is split into chunks (V8 does not optimize very large functions).
 *
 * Backends for the straight-line part (lowered to the expression IR of wasm_backend.ts first):
 * - 'js': JavaScript source (V8 optimizes it after ~1500 calls; slower until then).
 * - 'wasm': WebAssembly functions over the same register file, which then lives in wasm memory, so
 *   the JavaScript parts (generic ops, physics copies) read and write it directly. Bit-identical to
 *   'js' (same IR semantics), and fast from the first call.
 */
import { NDArray, strides, size, is_key, type DType } from './ndarray.ts';
import { JAX_OPS } from './jax_ops.ts';
import type { Program, RunOptions } from './graph.ts';
import { type E, type Stmt, n, op, opp, stmt_wasm_ok, stmt_cost, assemble, instantiate } from './wasm_backend.ts';

const MAX_UNROLL = 64;     // Elementwise ops up to this many elements are unrolled.
const MAX_REGISTER = 4096; // Values up to this many elements live in the register file.
const CHUNK = 60;         // Instructions per generated function.
const WASM_FN_BYTES = 6000;  // Approximate code size per generated wasm function (small: engines tier up small functions sooner).

export type Backend = 'js' | 'wasm';

type Operand = number | NDArray;

function typed_ctor(dtype: DType): string {
  switch (dtype) {
    case 'float32': return 'Float32Array';
    case 'float64': case 'int64': return 'Float64Array';
    case 'int32': return 'Int32Array';
    case 'uint32': return 'Uint32Array';
    case 'bool': case 'uint8': return 'Uint8Array';
    default: if (is_key(dtype)) return 'Uint32Array';
  }
  throw new Error(`codegen: dtype ${dtype}`);
}

/** Rounds/casts an expression to a dtype's value semantics. */
function cast(e: E, dtype: DType): E {
  switch (dtype) {
    case 'float32': return op('f32', e);
    case 'int32': return op('i32', e);
    case 'uint32': return op('u32', e);
    case 'bool': return op('b01', e);
    default: return e;
  }
}

function num(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (Object.is(x, -0)) return '-0';
  return String(x);
}

const BIN: Record<string, (a: E, b: E, dt: DType) => E> = {
  add: (a, b, dt) => (dt === 'int32' ? op('i32', op('add', a, b)) : op('add', a, b)),
  sub: (a, b, dt) => (dt === 'int32' ? op('i32', op('sub', a, b)) : op('sub', a, b)),
  mul: (a, b, dt) => (dt === 'int32' ? op('imul', a, b) : op('mul', a, b)),
  div: (a, b, dt) => (dt === 'int32' ? op('idiv', a, b) : op('div', a, b)),
  max: (a, b) => op('max', a, b),
  min: (a, b) => op('min', a, b),
  atan2: (a, b) => op('atan2', a, b),
  pow: (a, b) => op('pow', a, b),
  eq: (a, b) => op('eq', a, b),
  ne: (a, b) => op('ne', a, b),
  lt: (a, b) => op('lt', a, b),
  le: (a, b) => op('le', a, b),
  gt: (a, b) => op('gt', a, b),
  ge: (a, b) => op('ge', a, b),
  and: (a, b) => op('and', a, b),
  or: (a, b) => op('or', a, b),
  xor: (a, b) => op('xor', a, b),
};

const UN: Record<string, (a: E, dt: DType) => E> = {
  neg: a => op('neg', a),
  abs: a => op('abs', a),
  sign: a => op('sign', a),
  sqrt: a => op('sqrt', a),
  rsqrt: a => op('rsqrt', a),
  exp: a => op('exp', a),
  log: a => op('log', a),
  log1p: a => op('log1p', a),
  tanh: a => op('tanh', a),
  sin: a => op('sin', a),
  cos: a => op('cos', a),
  asin: a => op('asin', a),
  acos: a => op('acos', a),
  atan: a => op('atan', a),
  floor: a => op('floor', a),
  ceil: a => op('ceil', a),
  logistic: a => op('logistic', a),
  not: (a, dt) => (dt === 'bool' ? op('bnot', a) : op('inot', a)),
  convert_element_type: a => a,
  square: a => op('mul', a, a),
};

const JS_CALL: Record<string, string> = {
  max: 'MAX', min: 'MIN', atan2: 'Math.atan2', pow: 'Math.pow', imul: 'Math.imul', idiv: 'IDIV', abs: 'Math.abs',
  sign: 'SIGN', sqrt: 'Math.sqrt', exp: 'Math.exp', log: 'Math.log', log1p: 'Math.log1p', tanh: 'Math.tanh',
  sin: 'Math.sin', cos: 'Math.cos', asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan', floor: 'Math.floor',
  ceil: 'Math.ceil', f32: 'F',
};
const JS_INFIX: Record<string, string> = {
  add: '+', sub: '-', mul: '*', div: '/', eq: '===', ne: '!==', lt: '<', le: '<=', gt: '>', ge: '>=', and: '&', or: '|', xor: '^',
};

/** The JavaScript form of an expression (semantics mirrored by wasm_backend.ts). */
function render_js(e: E): string {
  switch (e.t) {
    case 'n': return `(${num(e.v)})`;
    case 'r': return `R[${e.i}]`;
    case 'c': return `C[${e.c}][${e.i}]`;
    case 's': return `S[${e.s}][${e.i}]`;
  }
  const a = e.a.map(render_js);
  const o = e.op;
  if (o in JS_INFIX) return `(${a[0]}${JS_INFIX[o]}${a[1]})`;
  if (o in JS_CALL) return `${JS_CALL[o]}(${a.join(',')})`;
  switch (o) {
    case 'neg': return `(-${a[0]})`;
    case 'rsqrt': return `(1/Math.sqrt(${a[0]}))`;
    case 'logistic': return `(1/(1+Math.exp(-${a[0]})))`;
    case 'i32': return `((${a[0]})|0)`;
    case 'u32': return `((${a[0]})>>>0)`;
    case 'b01': return `((${a[0]})?1:0)`;
    case 'nz': return `(${a[0]}!==0)`;
    case 'bnot': return `(${a[0]}?0:1)`;
    case 'inot': return `(~${a[0]})`;
    case 'sel': return `(${a[0]}?${a[1]}:${a[2]})`;
    case 'nsel': return `[${a.slice(1).join(',')}][${a[0]}]`;
    case 'f2i': return `F2I(${a[0]},${e.p.lo},${e.p.hi})`;
    case 'ipow': return `IPOW(${a[0]},${e.p.y},${e.p.round})`;
  }
  throw new Error(`codegen: op ${o}`);
}

function render_stmt(s: Stmt): string {
  if (s.t === 'st') return `R[${s.i}]=${render_js(s.e)};`;
  const terms = s.terms.map(t => `Math.min(Math.max(${render_js(t.e)},0),${t.lim})*${t.stride}`);
  return `{const b=${terms.length ? terms.join('+') : '0'};${s.writes.map(([w, e]) => `R[${s.base}+b+${w}]=${render_js(e)};`).join('')}}`;
}

/** Flat input index for each output position of a numpy-style broadcast. */
function bcast_map(shape: readonly number[], out_shape: readonly number[]): number[] {
  const n = size(out_shape), nd = out_shape.length, off = nd - shape.length;
  const s = strides(shape), os = strides(out_shape);
  const idx = new Array(n);
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

interface Deferral {
  skip_carry: Set<number>;   // Carry indices not copied per iteration.
  skip_slots: Set<number>;   // Physics output slots not written per iteration.
  deferred: any[];           // Plan outputs (located at their carry input's registers) copied after the loop.
}

/** Writes an mjData field value into registers with the output's dtype semantics. */
function write_field(R: Float64Array, out: any, value: any) {
  const off = out.loc.off, n = out.loc.n;
  if (typeof value === 'number') { R[off] = out.round ? Math.fround(value) : out.int ? Math.trunc(value) : value; return; }
  if (n === 1) { R[off] = out.round ? Math.fround(value[0]) : out.int ? Math.trunc(value[0]) : value[0]; return; }
  if (out.round || out.int) { const t = new out.ctor(n); t.set(value); R.set(t, off); } else R.set(value, off);
}

export class CompiledProgram {
  /** When set, generic (non-generated) instructions accumulate [ms, calls] per op and shape here. */
  static profile: Map<string, [number, number]> | null = null;
  program: Program;
  source = '';
  private chunks: ((S: any[], C: any[], N: NDArray[], R: Float64Array) => void)[] = [];
  private consts: any[] = [];
  private consts_nd: NDArray[] = [];  // The same constants as NDArrays (for generic ops).
  /** Register offset per slot (undefined: the slot holds a typed array in S). */
  private reg: number[] = [];
  private root: number[] = [];
  private aliased = new Set<number>();
  private in_place = new Set<number>();
  private R = new Float64Array(0);
  /** Slot -> [dtype, shape] (static). */
  private types: [DType, number[]][] = [];
  stats = { unrolled: 0, generic: 0, physics: 0, wasm: 0 };
  /** Straight-line code as JavaScript, or as WebAssembly where possible (default for new programs). */
  static default_backend: Backend = 'wasm';
  backend: Backend;
  wasm_bytes = 0;
  private live = new Set<number>();
  private plans = new Map<number, any>();
  /** Physics plans while running as a loop body with deferred outputs (see `loop_deferral`). */
  private loop_plans = new Map<number, any>();
  private in_loop = false;
  private deferral: { nc: number; result: Deferral | null } | null = null;

  constructor(program: Program, backend: Backend = CompiledProgram.default_backend) {
    this.program = program;
    this.backend = backend;
    this.build();
  }

  private build() {
    const p = this.program;
    const types = this.types;
    for (let k = 0; k < p.inputs.length; k++) {
      types[p.inputs[k]] = p.input_types[k];
    }
    for (const instr of p.instrs) instr.outs.forEach((s, k) => { types[s] = instr.out_types[k]; });

    // Register file layout: small, non-key values get a static offset. Values are written once per
    // run (SSA), so some results can share their operand's registers instead of copying:
    // - reshapes (row-major: same elements in the same order), and
    // - dynamic_update_slice whose operand has no other use (updated in place).
    // `root` tracks the slot that owns the memory, for the loop carry copies.
    const reg = this.reg;
    const root = this.root;
    const uses = new Map<number, number>();
    for (const instr of p.instrs) for (const o of instr.ins) if (typeof o === 'number') uses.set(o, (uses.get(o) ?? 0) + 1);
    for (const o of p.outputs) if (typeof o === 'number') uses.set(o, (uses.get(o) ?? 0) + 2);
    // Only values that generated code or physics reads/writes need registers; e.g. MuJoCo model
    // leaves that only feed the physics call (which ignores them) stay as plain arrays.
    const needs_reg = new Set<number>();
    for (const instr of p.instrs) {
      const skip = instr.kind === 'physics' ? instr.params.model_paths.length : 0;
      instr.ins.forEach((o, k) => { if (typeof o === 'number' && k >= skip) needs_reg.add(o); });
      for (const o of instr.outs) needs_reg.add(o);
    }
    const resident = (slot: number) => { const t = types[slot]; return t && needs_reg.has(slot) && size(t[1]) <= MAX_REGISTER && !is_key(t[0]); };
    // Pass 1: alias roots (reshape-like results and in-place updates share their operand's memory).
    const input_set = new Set(p.inputs);
    for (const s0 of p.inputs) if (resident(s0)) root[s0] = s0;
    for (const instr of p.instrs) {
      const o = instr.outs[0], a = instr.ins[0];
      const same_dtype = typeof a === 'number' && types[a] && types[o] && types[a][0] === types[o][0];
      if (instr.outs.length === 1 && typeof a === 'number' && root[a] !== undefined && resident(o) && same_dtype
          && size(types[a][1]) === size(types[o][1])) {
        const reshape = ['reshape', 'squeeze', 'expand_dims', 'copy'].includes(instr.op) && instr.kind === 'op';
        const dus_in_place = instr.op === 'dynamic_update_slice' && uses.get(a) === 1 && !input_set.has(root[a]);
        if (reshape || dus_in_place) {
          root[o] = root[a];
          this.aliased.add(o);
          if (dus_in_place) this.in_place.add(o);
          continue;
        }
      }
      for (const s1 of instr.outs) if (resident(s1)) root[s1] = s1;
    }
    // Pass 2: last use of each root (inputs and outputs live throughout).
    const last = new Map<number, number>();
    const touch = (slot: number, i: number) => { const r = root[slot]; if (r !== undefined) last.set(r, Math.max(last.get(r) ?? -1, i)); };
    p.instrs.forEach((instr, i) => { for (const o of instr.ins) if (typeof o === 'number') touch(o, i); for (const o of instr.outs) touch(o, i); });
    for (const s0 of p.inputs) if (root[s0] !== undefined) last.set(root[s0], Infinity);
    for (const o of p.outputs) if (typeof o === 'number' && root[o] !== undefined) last.set(root[o], Infinity);
    // Pass 3: first-fit allocation with reuse of dead roots' space.
    const free: [number, number][] = [];  // [offset, size], sorted by offset
    let nreg = 0;
    const take = (n: number): number => {
      for (let k = 0; k < free.length; k++) {
        const [off, sz] = free[k];
        if (sz >= n) {
          if (sz === n) free.splice(k, 1); else free[k] = [off + n, sz - n];
          return off;
        }
      }
      const off = nreg;
      nreg += n;
      return off;
    };
    const give = (off: number, n: number) => {
      let k = 0;
      while (k < free.length && free[k][0] < off) k++;
      free.splice(k, 0, [off, n]);
      // Coalesce neighbours.
      if (k + 1 < free.length && free[k][0] + free[k][1] === free[k + 1][0]) { free[k][1] += free[k + 1][1]; free.splice(k + 1, 1); }
      if (k > 0 && free[k - 1][0] + free[k - 1][1] === free[k][0]) { free[k - 1][1] += free[k][1]; free.splice(k, 1); }
    };
    const offset = new Map<number, number>();
    for (const s0 of p.inputs) if (root[s0] === s0) offset.set(s0, take(size(types[s0][1])));
    const dying = new Map<number, number[]>();
    for (const [r, i] of last) if (Number.isFinite(i)) { if (!dying.has(i)) dying.set(i, []); dying.get(i)!.push(r); }
    p.instrs.forEach((instr, i) => {
      for (const o of instr.outs) if (root[o] === o && !offset.has(o)) offset.set(o, take(size(types[o][1])));
      for (const r of dying.get(i) ?? []) if (offset.has(r) && !input_set.has(r)) give(offset.get(r)!, size(types[r][1]));
    });
    types.forEach((_, slot) => { const r = root[slot]; if (r !== undefined && offset.has(r)) reg[slot] = offset.get(r)!; });
    // Slots read by any instruction or returned: other results are dead (physics skips them).
    for (const instr of p.instrs) for (const o of instr.ins) if (typeof o === 'number') this.live.add(o);
    for (const o of p.outputs) if (typeof o === 'number') this.live.add(o);
    const consts = this.consts;
    const const_index = new Map<NDArray, number>();
    const cref = (a: NDArray): number => {
      let i = const_index.get(a);
      if (i === undefined) {
        i = consts.length;
        consts.push(a.size === 1 && !is_key(a.dtype) ? a.data[0] : a.data);
        this.consts_nd.push(a);
        const_index.set(a, i);
      }
      return i;
    };
    const type_of = (o: Operand): [DType, number[]] => (typeof o === 'number' ? types[o] : [o.dtype, o.shape]);
    // Element `i` of operand `o` (broadcast via `map` if given).
    const elem = (o: Operand, i: number): E => {
      if (typeof o !== 'number') {
        if (o.size === 1 && !is_key(o.dtype)) return n(o.data[0] as number);
        return { t: 'c', c: cref(o), i };
      }
      return reg[o] !== undefined ? { t: 'r', i: reg[o] + i } : { t: 's', s: o, i };
    };
    // Wrap a value as an NDArray for generic ops.
    const wrap = (o: Operand): string => {
      if (typeof o !== 'number') return `N[${cref(o)}]`;
      const [dt, sh] = types[o];
      if (reg[o] !== undefined) return `X.from_reg(${JSON.stringify(dt)},${JSON.stringify(sh)},${reg[o]})`;
      return `W(${JSON.stringify(dt)},${JSON.stringify(sh)},S[${o}])`;
    };

    // Per instruction: straight-line statements (either backend) or JavaScript source.
    const items: ({ ir: Stmt[] } | { js: string })[] = [];

    p.instrs.forEach((instr, ii) => {
      const out_t = instr.out_types[0];
      const nel = size(out_t[1]);
      const dt = out_t[0];
      const so = instr.outs[0];
      const emit_elementwise = (expr: (i: number) => E) => {
        const base = reg[so];
        const stmts: Stmt[] = [];
        for (let i = 0; i < nel; i++) stmts.push({ t: 'st', i: base + i, e: cast(expr(i), dt) });
        items.push({ ir: stmts });
        this.stats.unrolled++;
      };
      // Index map for operand `o` broadcast to the output shape (handles rank-0 literals).
      const bmap = (o: Operand): number[] => {
        const [, sh] = type_of(o);
        if (size(sh) === 1) return new Array(nel).fill(0);
        if (size(sh) === nel) return [...Array(nel).keys()];
        return bcast_map(sh, out_t[1]);
      };
      const small = nel <= MAX_UNROLL && instr.kind === 'op' && instr.outs.length === 1 && !is_key(dt);
      if (this.aliased.has(so) && !this.in_place.has(so)) { this.stats.unrolled++; return; }  // Shares its operand's registers.

      if (small && instr.op in BIN && instr.ins.length === 2) {
        const [a, b] = instr.ins;
        const ma = bmap(a), mb = bmap(b);
        const in_dt = type_of(a)[0];
        const f = BIN[instr.op];
        emit_elementwise(i => f(elem(a, ma[i]), elem(b, mb[i]), in_dt === 'bool' ? 'bool' : dt));
        return;
      }
      if (small && instr.op in UN && instr.ins.length === 1) {
        const [a] = instr.ins;
        const ma = bmap(a);
        const in_dt = type_of(a)[0];
        if (instr.op === 'convert_element_type' && (dt === 'bool')) {
          emit_elementwise(i => op('nz', elem(a, ma[i])));
        } else if (instr.op === 'convert_element_type' && (dt === 'int32' || dt === 'uint32') && (in_dt === 'float32' || in_dt === 'float64')) {
          emit_elementwise(i => opp('f2i', { lo: dt === 'int32' ? -2147483648 : 0, hi: dt === 'int32' ? 2147483647 : 4294967295 }, elem(a, ma[i])));
        } else {
          emit_elementwise(i => UN[instr.op](elem(a, ma[i]), dt));
        }
        return;
      }
      if (small && instr.op === 'integer_pow') {
        const [a] = instr.ins;
        const ma = bmap(a);
        const round = dt === 'float32' ? 'F' : dt === 'int32' ? 'I32' : 'ID';
        emit_elementwise(i => opp('ipow', { y: instr.params.y, round }, elem(a, ma[i])));
        return;
      }
      if (small && instr.op === 'select_n') {
        const [pred, ...cases] = instr.ins;
        const mp = bmap(pred), mc = cases.map(bmap);
        if (cases.length === 2) {
          emit_elementwise(i => op('sel', elem(pred, mp[i]), elem(cases[1], mc[1][i]), elem(cases[0], mc[0][i])));
        } else {
          emit_elementwise(i => op('nsel', elem(pred, mp[i]), ...cases.map((c, k) => elem(c, mc[k][i]))));
        }
        return;
      }
      if (small && instr.op === 'broadcast_in_dim') {
        const [a] = instr.ins;
        const [, sh] = type_of(a);
        const aligned = new Array(out_t[1].length).fill(1);
        (instr.params.broadcast_dimensions as number[]).forEach((d, i) => { aligned[d] = sh[i]; });
        const m = size(sh) === 1 ? new Array(nel).fill(0) : bcast_map(aligned, out_t[1]);
        emit_elementwise(i => elem(a, m[i]));
        return;
      }
      if (small && (instr.op === 'reshape' || instr.op === 'squeeze' || instr.op === 'expand_dims')) {
        const [a] = instr.ins;
        emit_elementwise(i => elem(a, i));
        return;
      }
      if (small && instr.op === 'slice') {
        const [a] = instr.ins;
        const [, sh] = type_of(a);
        const st: number[] = instr.params.start_indices;
        const step: number[] = instr.params.strides ?? st.map(() => 1);
        const ss = strides(sh), os = strides(out_t[1]);
        emit_elementwise(i => {
          let rem = i, flat = 0;
          for (let d = 0; d < sh.length; d++) {
            const c = Math.floor(rem / os[d]);
            rem -= c * os[d];
            flat += (st[d] + c * step[d]) * ss[d];
          }
          return elem(a, flat);
        });
        return;
      }
      if (small && instr.op === 'concatenate') {
        const axis: number = instr.params.dimension;
        const srcs: [Operand, number][] = [];  // Per output element: (operand, flat index).
        const os = strides(out_t[1]);
        const offsets: number[] = [];
        let acc = 0;
        for (const a of instr.ins) { offsets.push(acc); acc += type_of(a)[1][axis]; }
        for (let i = 0; i < nel; i++) {
          const coord = [];
          let rem = i;
          for (let d = 0; d < out_t[1].length; d++) { const c = Math.floor(rem / os[d]); rem -= c * os[d]; coord.push(c); }
          let k = 0;
          while (k + 1 < instr.ins.length && coord[axis] >= offsets[k + 1]) k++;
          const sh = type_of(instr.ins[k])[1];
          const ss = strides(sh);
          let flat = 0;
          for (let d = 0; d < sh.length; d++) flat += (d === axis ? coord[d] - offsets[k] : coord[d]) * ss[d];
          srcs.push([instr.ins[k], flat]);
        }
        emit_elementwise(i => elem(srcs[i][0], srcs[i][1]));
        return;
      }
      if (instr.kind === 'op' && instr.op === 'split' && type_of(instr.ins[0])[1].length <= 2 && size(type_of(instr.ins[0])[1]) <= MAX_UNROLL) {
        const [a] = instr.ins;
        const [, sh] = type_of(a);
        const axis: number = instr.params.axis;
        const ss = strides(sh);
        let start = 0;
        const stmts: Stmt[] = [];
        instr.outs.forEach((s, k) => {
          const t = instr.out_types[k];
          const tn = size(t[1]), ts = strides(t[1]);
          for (let i = 0; i < tn; i++) {
            let rem = i, flat = 0;
            for (let d = 0; d < t[1].length; d++) {
              const c = Math.floor(rem / ts[d]);
              rem -= c * ts[d];
              flat += (d === axis ? c + start : c) * ss[d];
            }
            stmts.push({ t: 'st', i: reg[s] + i, e: elem(a, flat) });
          }
          start += t[1][axis];
        });
        items.push({ ir: stmts });
        this.stats.unrolled++;
        return;
      }
      if (small && instr.op === 'clamp') {
        const [lo, x, hi] = instr.ins;
        const ml = bmap(lo), mx = bmap(x), mh = bmap(hi);
        emit_elementwise(i => op('min', op('max', elem(x, mx[i]), elem(lo, ml[i])), elem(hi, mh[i])));
        return;
      }
      if (small && ['reduce_sum', 'reduce_max', 'reduce_min', 'reduce_and', 'reduce_or', 'reduce_prod'].includes(instr.op)) {
        // Sequential accumulation in double, rounded once (as the generic implementation).
        const [a] = instr.ins;
        const [, sh] = type_of(a);
        const axes: number[] = instr.params.axes;
        const ss = strides(sh), os = strides(out_t[1]);
        const groups: number[][] = Array.from({ length: nel }, () => []);
        const total = size(sh);
        for (let f = 0; f < total; f++) {
          let rem = f, o = 0, k = 0;
          for (let d = 0; d < sh.length; d++) {
            const c = Math.floor(rem / ss[d]);
            rem -= c * ss[d];
            if (!axes.includes(d)) o += c * os[k++];
          }
          groups[o].push(f);
        }
        const fold = (xs: E[], f: (acc: E, x: E) => E, init: E | null, empty: number): E => {
          if (init !== null) return xs.reduce(f, init);
          return xs.length ? xs.slice(1).reduce(f, xs[0]) : n(empty);
        };
        const combine = {
          reduce_sum: (xs: E[]) => fold(xs, (acc, x) => op('add', acc, x), null, 0),
          reduce_prod: (xs: E[]) => fold(xs, (acc, x) => op('mul', acc, x), null, 1),
          reduce_max: (xs: E[]) => fold(xs, (acc, x) => op('max', acc, x), n(-Infinity), 0),
          reduce_min: (xs: E[]) => fold(xs, (acc, x) => op('min', acc, x), n(Infinity), 0),
          reduce_and: (xs: E[]) => fold(xs.map(x => op('b01', x)), (acc, x) => op('and', acc, x), null, 1),
          reduce_or: (xs: E[]) => fold(xs.map(x => op('b01', x)), (acc, x) => op('or', acc, x), null, 0),
        }[instr.op as 'reduce_sum']!;
        if (groups.every(g => g.length <= MAX_UNROLL)) {
          emit_elementwise(i => combine(groups[i].map(f => elem(a, f))));
          return;
        }
      }
      if (small && instr.op === 'gather' && typeof instr.ins[1] !== 'number') {
        // Constant indices: the source element of every output is static.
        const [operand, indices] = instr.ins;
        const [, osh] = type_of(operand);
        const probe = new NDArray('float64', [...osh]);
        for (let i = 0; i < probe.size; i++) probe.data[i] = i;
        const [m] = JAX_OPS.gather([probe, indices as NDArray], instr.params, [['float64', out_t[1]]]);
        if (Array.from(m.data).every(v => Number.isInteger(v))) {
          emit_elementwise(i => elem(operand, m.data[i] as number));
          return;
        }
      }
      if (instr.op === 'dynamic_update_slice' && instr.kind === 'op' && reg[so] !== undefined
          && (nel <= 4 * MAX_UNROLL || this.in_place.has(so)) && size(type_of(instr.ins[1])[1]) <= 4 * MAX_UNROLL) {
        // Copy the operand, then write the update at a runtime (clamped) offset.
        const [operand, update, ...starts] = instr.ins;
        const [, sh] = type_of(operand);
        const [, ush] = type_of(update);
        const ss = strides(sh), us = strides(ush);
        const base = reg[so];
        const stmts: Stmt[] = [];
        if (!this.in_place.has(so)) for (let i = 0; i < nel; i++) stmts.push({ t: 'st', i: base + i, e: elem(operand, i) });
        const nu = size(ush);
        const writes: [number, E][] = [];
        for (let j = 0; j < nu; j++) {
          let rem = j, w = 0;
          for (let d = 0; d < ush.length; d++) { const c = Math.floor(rem / us[d]); rem -= c * us[d]; w += c * ss[d]; }
          writes.push([w, elem(update, j)]);
        }
        stmts.push({ t: 'dyn', base, terms: starts.map((st, d) => ({ e: elem(st, 0), lim: sh[d] - ush[d], stride: ss[d] })), writes });
        items.push({ ir: stmts });
        this.stats.unrolled++;
        return;
      }
      if (instr.kind === 'physics') {
        // Direct copies between registers/slots and mjData (see `phys`), falling back to the
        // generic path for physics implementations without direct access or multiple worlds.
        this.stats.physics++;
        const outs_unwrap = instr.outs.map((s, k) => (reg[s] !== undefined
          ? `X.to_reg(r[${k}],${reg[s]});` : `S[${s}]=r[${k}].data;`)).join('');
        items.push({ js: `if(!X.phys(${ii},S)){const r=X.exec(${ii},[${instr.ins.map(wrap).join(',')}]);${outs_unwrap}}` });
        return;
      }
      // Generic: call the op implementation (or scan) on NDArray wrappers.
      this.stats.generic++;
      const outs_unwrap = instr.outs.map((s, k) => (reg[s] !== undefined
        ? `X.to_reg(r[${k}],${reg[s]});` : `S[${s}]=r[${k}].data;`)).join('');
      items.push({ js: `{const r=X.exec(${ii},[${instr.ins.map(wrap).join(',')}]);${outs_unwrap}}` });
    });

    // Backend. WebAssembly: runs of straight-line items become wasm functions over the register file
    // (in wasm memory, shared with the JavaScript parts); items reading slot arrays stay JavaScript.
    const const_ok = (c: number) => typeof this.consts_nd[c].data[0] === 'number' || this.consts_nd[c].size === 0;
    const use_wasm = this.backend === 'wasm' && typeof WebAssembly !== 'undefined';
    const wasm_fns: Stmt[][] = [];
    const entries: string[] = [];  // Chunk sources, in order.
    let js_chunk: string[] = [];
    let fn: Stmt[] | null = null, fn_cost = 0;
    const flush_js = () => { if (js_chunk.length) entries.push(`(S,C,N,R)=>{\n${js_chunk.join('\n')}\n}`); js_chunk = []; };
    const flush_fn = () => { if (fn && fn.length) { entries.push(`X.w.f${wasm_fns.length}`); wasm_fns.push(fn); } fn = null; fn_cost = 0; };
    for (const item of items) {
      if ('ir' in item && use_wasm && item.ir.every(s => stmt_wasm_ok(s, const_ok))) {
        flush_js();
        if (fn === null) fn = [];
        fn.push(...item.ir);
        fn_cost += item.ir.reduce((a, s) => a + stmt_cost(s), 0);
        this.stats.wasm++;
        if (fn_cost > WASM_FN_BYTES) flush_fn();
        continue;
      }
      flush_fn();
      if (js_chunk.length >= CHUNK) flush_js();
      js_chunk.push('ir' in item ? item.ir.map(render_stmt).join('') : item.js);
    }
    flush_fn();
    flush_js();

    const wasm_api: Record<string, any> = {};
    if (wasm_fns.length) {
      // Memory: [registers | constants read by wasm code].
      const const_base = new Map<number, number>();
      let cells = nreg;
      const visit = (e: E) => {
        if (e.t === 'c' && !const_base.has(e.c)) { const_base.set(e.c, cells); cells += this.consts_nd[e.c].size; }
        else if (e.t === 'op') e.a.forEach(visit);
      };
      for (const f of wasm_fns) for (const s of f) {
        if (s.t === 'st') visit(s.e); else { s.terms.forEach(t => visit(t.e)); s.writes.forEach(([, e]) => visit(e)); }
      }
      const pages = Math.max(1, Math.ceil(cells * 8 / 65536));
      const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
      this.R = new Float64Array(memory.buffer, 0, nreg);
      const M = new Float64Array(memory.buffer);
      for (const [c, off] of const_base) M.set(this.consts_nd[c].data as ArrayLike<number>, off);
      const bytes = assemble(wasm_fns, pages, c => const_base.get(c)!);
      this.wasm_bytes = bytes.length;
      Object.assign(wasm_api, instantiate(bytes, memory));
    } else {
      this.R = new Float64Array(nreg);
    }
    this.source = `[\n${entries.join(',\n')}\n]`;
    const helpers = `
      const F = Math.fround;
      const I32 = x => x | 0;
      const ID = x => x;
      const MAX = (x, y) => (x !== x || y !== y ? NaN : x > y ? x : y);
      const MIN = (x, y) => (x !== x || y !== y ? NaN : x < y ? x : y);
      const SIGN = x => (x !== x ? NaN : x > 0 ? 1 : x < 0 ? -1 : x);
      const IDIV = (x, y) => (y === 0 ? -1 : Math.trunc(x / y));
      const F2I = (x, lo, hi) => (x !== x ? 0 : (x = Math.trunc(x)) < lo ? lo : x > hi ? hi : x);
      const IPOW = (x, y, round) => {
        let n = Math.abs(y), acc = null, base = x;
        while (n > 0) { if (n & 1) acc = acc === null ? base : round(acc * base); n >>= 1; if (n) base = round(base * base); }
        const r = acc === null ? 1 : acc;
        return y < 0 ? round(1 / r) : r;
      };
      const W = (dtype, shape, v) => X.wrap(dtype, shape, v);
      const U = (a, scalar) => (scalar ? a.data[0] : a.data);
      return ${this.source};`;
    const X: any = this.runtime_handle();
    X.w = wasm_api;
    this.chunks = new Function('X', helpers)(X);
  }

  private exec_options: RunOptions = {};

  /** Copy plan for a physics instruction: which operands feed mjData, which results it writes. */
  private make_plan(ii: number, physics: any, skip: Set<number> | null = null): any {
    const instr = this.program.instrs[ii];
    const p = instr.params;
    const paths: string[] = p.data_paths;
    const batched: boolean[] = p.data_batched;
    const n_model = p.model_paths.length;
    const loc_of = (o: any): any => {
      if (typeof o !== 'number') return { const: o, n: o.size };
      const t = this.types[o];
      return { off: this.reg[o], slot: o, n: size(t[1]) };
    };
    const inputs: any[] = [], outputs: any[] = [];
    for (let k = 0; k < paths.length; k++) {
      const o = instr.ins[n_model + k];
      const t = (typeof o === 'number' ? this.types[o] : [o.dtype, o.shape]) as [DType, number[]];
      if (batched[k] && t[1][0] !== 1) return null;  // Multiple worlds: generic path.
      const n = size(t[1]);
      const name = physics.field_name(paths[k], n);
      if (name !== null && physics.is_input(name)) inputs.push({ name, loc: loc_of(o) });
      const out = instr.outs[k];
      if (!this.live.has(out) || skip?.has(out)) continue;
      const [dtype] = instr.out_types[k];
      outputs.push({
        name, in: loc_of(o), loc: loc_of(out), round: dtype === 'float32', int: dtype.startsWith('int') || dtype.startsWith('uint'),
        ctor: { float32: Float32Array, float64: Float64Array, int32: Int32Array, uint32: Uint32Array, bool: Uint8Array }[dtype as string] ?? Float64Array,
      });
      const added = outputs[outputs.length - 1];
      if (added.loc.off !== undefined && added.loc.n > 1 && (added.round || added.int)) added.scratch = new added.ctor(added.loc.n);
    }
    return { op: p.op, inputs, outputs };
  }

  private runtime_handle() {
    const self = this;
    return {
      wrap(dtype: DType, shape: number[], v: any): NDArray {
        if (typeof v === 'number') {
          const a = new NDArray(dtype, shape);
          a.data[0] = v;
          return a;
        }
        return new NDArray(dtype, shape, v);
      },
      from_reg(dtype: DType, shape: number[], off: number): NDArray {
        const a = new NDArray(dtype, shape);
        const n = a.data.length;
        for (let i = 0; i < n; i++) a.data[i] = self.R[off + i];
        return a;
      },
      to_reg(a: NDArray, off: number) {
        const d = a.data, R = self.R;
        for (let i = 0; i < d.length; i++) R[off + i] = d[i];
      },
      phys(ii: number, S: any[]): boolean {
        const physics: any = self.exec_options.physics;
        if (!physics || typeof physics.direct !== 'function') return false;
        const plans = self.in_loop ? self.loop_plans : self.plans;
        let plan = plans.get(ii);
        if (plan === undefined) {
          plan = self.make_plan(ii, physics, self.in_loop ? self.deferral!.result!.skip_slots : null);
          plans.set(ii, plan);
        }
        if (plan === null) return false;
        const R = self.R;
        const view = (loc: any): any => (loc.const ? loc.const.data : loc.off !== undefined ? R.subarray(loc.off, loc.off + loc.n) : S[loc.slot]);
        physics.direct(plan.op, (d: any) => {
          for (const inp of plan.inputs) {
            const v = view(inp.loc);
            if (typeof d[inp.name] === 'number') d[inp.name] = v[0]; else d[inp.name].set(v);
          }
        }, (d: any) => {
          for (const out of plan.outputs) {
            let src = out.name === null ? view(out.in) : d[out.name];
            if (typeof src === 'number') src = [src];  // Scalar mjData fields (time, nefc, ...).
            const loc = out.loc;
            if (loc.off !== undefined) {
              const off = loc.off, n = loc.n;
              if (out.name === null && out.in.off !== undefined) {
                // Pass-through register to register: values already have the output's type.
                if (out.in.off !== off) R.copyWithin(off, out.in.off, out.in.off + n);
              } else if (n === 1) {
                R[off] = out.round ? Math.fround(src[0]) : out.int ? Math.trunc(src[0]) : src[0];
              } else if (out.scratch) {
                // Native conversions: rounding to float32 (or truncating to int) via a typed array.
                out.scratch.set(src);
                R.set(out.scratch, off);
              } else {
                R.set(src, off);
              }
            } else if (out.name === null && !out.in.const && out.in.off === undefined) {
              S[loc.slot] = src;  // Pass-through by reference (arrays are never mutated in place).
            } else {
              const a = new out.ctor(loc.n);
              a.set(src);
              S[loc.slot] = a;
            }
          }
        });
        return true;
      },
      exec(ii: number, args: NDArray[]): NDArray[] {
        const instr = self.program.instrs[ii];
        const prof = CompiledProgram.profile;
        const t0 = prof ? performance.now() : 0;
        const r = instr.kind === 'op' ? instr.f!(args, instr.params, instr.out_types)
          : self.program.exec_special(instr, args, self.exec_options);
        if (prof) {
          const key = `${instr.kind === 'op' ? instr.op : instr.kind} ${instr.out_types.map(t => t[1].join('x')).join(',')}`;
          const e = prof.get(key) ?? [0, 0];
          e[0] += performance.now() - t0; e[1]++;
          prof.set(key, e);
        }
        return r;
      },
    };
  }

  /**
   * Loop-carried physics outputs that need no copy per iteration. With the loop body's single
   * physics call, a carry k whose output is physics data field j, read by nothing else, and whose
   * carry input is read only by that same physics call at position j:
   * - pass-through fields (no mjData counterpart) never change: skipped entirely;
   * - mjData fields physics does not read (not INPUT_FIELDS) are copied once, after the last
   *   iteration, from mjData (which then holds the values the last iteration would have copied).
   */
  private loop_deferral(nc: number, physics: any): Deferral | null {
    if (this.deferral && this.deferral.nc === nc) return this.deferral.result;
    const result = this.analyze_deferral(nc, physics);
    this.deferral = { nc, result };
    return result;
  }

  private analyze_deferral(nc: number, physics: any): Deferral | null {
    if (!physics || typeof physics.direct !== 'function' || typeof physics.data !== 'function') return null;
    const p = this.program, reg = this.reg;
    const phys = p.instrs.map((x, i) => [x, i] as const).filter(([x]) => x.kind === 'physics');
    if (phys.length !== 1) return null;
    const [instr, ii] = phys[0];
    const plan = this.make_plan(ii, physics);
    if (plan === null) return null;
    const n_model = instr.params.model_paths.length;
    const uses = new Map<number, number>();
    for (const x of p.instrs) for (const o of x.ins) if (typeof o === 'number') uses.set(o, (uses.get(o) ?? 0) + 1);
    const out_count = new Map<number, number>();
    for (const o of p.outputs) if (typeof o === 'number') out_count.set(o, (out_count.get(o) ?? 0) + 1);
    const result: Deferral = { skip_carry: new Set(), skip_slots: new Set(), deferred: [] };
    for (let k = 0; k < p.outputs.length; k++) {
      const src = p.outputs[k], dst = p.inputs[nc + k];
      if (typeof src !== 'number' || dst === undefined) continue;
      const j = instr.outs.indexOf(src);
      if (j < 0 || uses.has(src) || out_count.get(src) !== 1) continue;
      if (instr.ins[n_model + j] !== dst || uses.get(dst) !== 1) continue;
      if (reg[src] === undefined || reg[dst] === undefined) continue;
      const entry = plan.outputs.find((o: any) => o.loc.slot === src);
      if (!entry) continue;
      if (entry.name === null) {
        result.skip_carry.add(k); result.skip_slots.add(src);
      } else if (!physics.is_input(entry.name)) {
        result.skip_carry.add(k); result.skip_slots.add(src);
        result.deferred.push({ ...entry, loc: { off: reg[dst], slot: dst, n: entry.loc.n } });
      }
    }
    return result.skip_carry.size ? result : null;
  }

  /**
   * Runs the program as a loop body `length` times (scan with no per-iteration outputs): carry
   * outputs are copied straight into the carry input slots between iterations, and only the final
   * carry is materialized.
   */
  run_loop(consts: NDArray[], carry: NDArray[], length: number, options: RunOptions = {}): NDArray[] {
    this.exec_options = options;
    const deferral = this.loop_deferral(consts.length, options.physics);
    const p = this.program;
    const S: any[] = new Array(p.nslots);
    const R = this.R, reg = this.reg;
    const load = (slot: number, a: NDArray) => {
      if (reg[slot] !== undefined) {
        const off = reg[slot], d = a.data;
        for (let i = 0; i < d.length; i++) R[off + i] = d[i];
      } else {
        S[slot] = a.data;
      }
    };
    const nc = consts.length;
    consts.forEach((a, k) => load(p.inputs[k], a));
    carry.forEach((a, k) => load(p.inputs[nc + k], a));
    // Per carry: copy from the body output to the carry input slot. Outputs computed inside the
    // body are copied directly (R.copyWithin); outputs that are themselves input slots (permuted
    // pass-through) or constants are staged first, since writing inputs could clobber them.
    const inputs = new Set(p.inputs);
    const direct_reg: [number, number, number][] = [];  // [dst_off, src_off, n]
    const direct_obj: [number, number][] = [];          // [dst_slot, src_slot]
    const staged: { src: any; dst: number }[] = [];
    carry.forEach((_, k) => {
      const dst = p.inputs[nc + k], src = p.outputs[k];
      if (src === dst || deferral?.skip_carry.has(k)) return;
      if (typeof src === 'number' && !inputs.has(src) && !inputs.has(this.root[src] ?? src)
          && (reg[src] !== undefined) === (reg[dst] !== undefined)) {
        if (reg[src] !== undefined) direct_reg.push([reg[dst], reg[src], size(this.types[src][1])]);
        else direct_obj.push([dst, src]);
      } else {
        staged.push({ src, dst });
      }
    });
    const C = this.consts, N = this.consts_nd;
    const tmp: any[] = new Array(staged.length);
    this.in_loop = deferral !== null;
    for (let it = 0; it < length; it++) {
      for (const f of this.chunks) f(S, C, N, R);
      for (let k = 0; k < staged.length; k++) {
        const src = staged[k].src;
        if (typeof src !== 'number') tmp[k] = src;
        else if (reg[src] !== undefined) tmp[k] = R.slice(reg[src], reg[src] + size(this.types[src][1]));
        else tmp[k] = S[src];
      }
      for (let k = 0; k < direct_reg.length; k++) {
        const [d, s0, n] = direct_reg[k];
        if (n === 1) R[d] = R[s0]; else R.copyWithin(d, s0, s0 + n);
      }
      for (let k = 0; k < direct_obj.length; k++) S[direct_obj[k][0]] = S[direct_obj[k][1]];
      for (let k = 0; k < staged.length; k++) {
        const dst = staged[k].dst, v = tmp[k];
        if (v instanceof NDArray) { load(dst, v); continue; }
        if (reg[dst] !== undefined) R.set(v, reg[dst]);
        else S[dst] = v;
      }
    }
    this.in_loop = false;
    if (deferral && length > 0) {
      // Deferred physics outputs: mjData after the last iteration holds their final values.
      const d = (options.physics as any).data(0);
      for (const f of deferral.deferred) write_field(R, f, d[f.name]);
    }
    return carry.map((_, k) => {
      const slot = p.inputs[nc + k];
      const [dtype, shape] = this.types[slot];
      if (reg[slot] !== undefined) {
        const a = new NDArray(dtype, [...shape]);
        for (let i = 0; i < a.data.length; i++) a.data[i] = R[reg[slot] + i];
        return a;
      }
      return new NDArray(dtype, [...shape], S[slot]);
    });
  }

  /**
   * A stateful runner: inputs live in the program's slots across calls, `carry` maps output indices
   * to the input indices they feed next call (e.g. env state), and outputs are materialized only on
   * request. Avoids converting the full state to and from arrays on every step.
   */
  session(carry: [number, number][]): Session {
    return new Session(this, carry);
  }

  /** @internal */ get_internals() {
    return { R: this.R, reg: this.reg, root: this.root, types: this.types, chunks: this.chunks, consts: this.consts, consts_nd: this.consts_nd };
  }

  /** @internal */ set_options(options: RunOptions) { this.exec_options = options; }

  run(args: NDArray[], options: RunOptions = {}): NDArray[] {
    this.exec_options = options;
    const p = this.program;
    const S: any[] = new Array(p.nslots);
    const R = this.R, reg = this.reg;
    for (let k = 0; k < p.inputs.length; k++) {
      const a = args[k], slot = p.inputs[k];
      if (reg[slot] !== undefined) {
        const off = reg[slot], d = a.data;
        for (let i = 0; i < d.length; i++) R[off + i] = d[i];
      } else {
        S[slot] = a.data;
      }
    }
    const C = this.consts, N = this.consts_nd;
    for (const f of this.chunks) f(S, C, N, R);
    return p.outputs.map(o => {
      if (typeof o !== 'number') return o;
      const [dtype, shape] = this.types[o];
      if (reg[o] !== undefined) {
        const a = new NDArray(dtype, [...shape]);
        const off = reg[o];
        for (let i = 0; i < a.data.length; i++) a.data[i] = R[off + i];
        return a;
      }
      return new NDArray(dtype, [...shape], S[o]);
    });
  }
}


export class Session {
  private compiled: CompiledProgram;
  private S: any[];
  private direct_reg: [number, number, number][] = [];
  private direct_obj: [number, number][] = [];
  private staged: { src: any; dst: number }[] = [];

  private carried = new Map<number, number>();  // output index -> input index

  constructor(compiled: CompiledProgram, carry: [number, number][]) {
    this.compiled = compiled;
    for (const [k_out, k_in] of carry) this.carried.set(k_out, k_in);
    const p = compiled.program;
    const { reg, root, types } = compiled.get_internals();
    this.S = new Array(p.nslots);
    const inputs = new Set(p.inputs);
    for (const [k_out, k_in] of carry) {
      const dst = p.inputs[k_in], src = p.outputs[k_out];
      if (src === dst) continue;
      if (typeof src === 'number' && !inputs.has(src) && !inputs.has(root[src] ?? src)
          && (reg[src] !== undefined) === (reg[dst] !== undefined)) {
        if (reg[src] !== undefined) this.direct_reg.push([reg[dst], reg[src], size(types[src][1])]);
        else this.direct_obj.push([dst, src]);
      } else {
        this.staged.push({ src, dst });
      }
    }
  }

  /** Sets input `k` (an NDArray, row-major, the input's dtype/shape). */
  set(k: number, a: NDArray) {
    const p = this.compiled.program;
    const { R, reg } = this.compiled.get_internals();
    const slot = p.inputs[k];
    if (reg[slot] !== undefined) R.set(a.data as ArrayLike<number>, reg[slot]);
    else this.S[slot] = a.data;
  }

  /** Runs once, then feeds the carried outputs into their inputs for the next call. */
  step(options: RunOptions = {}) {
    const c = this.compiled;
    c.set_options(options);
    const { R, reg, types, chunks, consts, consts_nd } = c.get_internals();
    const S = this.S;
    for (const f of chunks) f(S, consts, consts_nd, R);
    const tmp = this.staged.map(({ src }) => (typeof src !== 'number' ? src.data
      : reg[src] !== undefined ? R.slice(reg[src], reg[src] + size(types[src][1])) : S[src]));
    for (const [d, s0, n] of this.direct_reg) { if (n === 1) R[d] = R[s0]; else R.copyWithin(d, s0, s0 + n); }
    for (const [d, s0] of this.direct_obj) S[d] = S[s0];
    this.staged.forEach(({ dst }, k) => { if (reg[dst] !== undefined) R.set(tmp[k], reg[dst]); else S[dst] = tmp[k]; });
  }

  /**
   * Output `k` of the last step, as an NDArray. Carried outputs are read from the input slots they
   * were copied to (same values).
   */
  get(k: number): NDArray {
    const c = this.compiled, p = c.program;
    const { R, reg, types } = c.get_internals();
    const k_in = this.carried.get(k);
    const o = k_in !== undefined ? p.inputs[k_in] : p.outputs[k];  // Carried: its input slot holds it.
    if (typeof o !== 'number') return o;
    const [dtype, shape] = types[o];
    if (reg[o] !== undefined) {
      const a = new NDArray(dtype, [...shape]);
      const off = reg[o];
      for (let i = 0; i < a.data.length; i++) a.data[i] = R[off + i];
      return a;
    }
    return new NDArray(dtype, [...shape], this.S[o]);
  }
}
