/**
 * Interpreter for captured graphs (`ap-graph/1`, see python/graph_ir.py).
 *
 *   const graph = Graph.load(json, bin);
 *   const outputs = graph.run('env_step', inputs, { physics });   // Map<name, NDArray>
 *
 * Functions are evaluated eqn by eqn. `jit` calls and `scan` loops run their sub-functions; the
 * `mujoco_physics` primitive is delegated to a `Physics` implementation (physics.ts).
 */
import { NDArray, scalar, size, is_key, astype, reshape, full, type DType } from './ndarray.ts';
import { JAX_OPS } from './jax_ops.ts';
import { TORCH_OPS } from './torch_ops.ts';
import { CompiledProgram, Session } from './codegen.ts';

export interface Physics {
  call(op: 'step' | 'forward', params: Record<string, any>, inputs: NDArray[]): NDArray[];
}

interface FunctionJson {
  dialect: 'jax' | 'torch';
  vars: [DType, number[]][];
  inputs: number[];
  outputs: any[];
  eqns: { op: string, in: any[], out: number[], params: Record<string, any> }[];
}

interface EntryJson {
  function: string;
  inputs: { name: string, dtype: DType, shape: number[] }[];
  outputs: { name: string, dtype?: DType, shape?: number[], mutates?: boolean }[];
}

export interface GraphJson {
  format: string;
  functions: Record<string, FunctionJson>;
  entries: Record<string, EntryJson>;
  constants: { dtype: DType, shape: number[], offset: number, nbytes: number }[];
  values: Record<string, Record<string, number>>;
  warnings: string[];
}

export interface RunOptions {
  physics?: Physics;
  /** Use the unoptimized reference interpreter (eqn by eqn, no inlining). */
  reference?: boolean;
  /** Run JAX programs as generated JavaScript (default true). */
  codegen?: boolean;
  /** Called after every eqn (debugging/profiling). */
  trace?: (fid: string, index: number, op: string, outputs: NDArray[]) => void;
}

function decode_number(x: any): number {
  if (x === 'nan') return NaN;
  if (x === 'inf') return Infinity;
  if (x === '-inf') return -Infinity;
  if (typeof x === 'boolean') return x ? 1 : 0;
  return x;
}

export class Graph {
  json: GraphJson;
  bin: ArrayBuffer;
  private constants: (NDArray | undefined)[];
  /** Executed-op counts per op name (when counting is on). */
  counts: Map<string, number> | null = null;
  /** Milliseconds per op name (when profiling is on; adds overhead). */
  profile: Map<string, number> | null = null;
  private programs = new Map<string, Program>();
  private compiled = new Map<Program, CompiledProgram>();

  compiled_of(p: Program): CompiledProgram {
    let c = this.compiled.get(p);
    if (!c) {
      c = new CompiledProgram(p);
      this.compiled.set(p, c);
    }
    return c;
  }

  /** The flattened, pre-resolved form of a JAX function (cached). */
  program(fid: string): Program {
    let p = this.programs.get(fid);
    if (!p) {
      p = new Program(this, fid);
      this.programs.set(fid, p);
    }
    return p;
  }

  constructor(json: GraphJson, bin: ArrayBuffer) {
    if (json.format !== 'ap-graph/1') throw new Error(`Unknown graph format ${json.format}`);
    this.json = json;
    this.bin = bin;
    this.constants = new Array(json.constants.length);
  }

  static load(json: GraphJson, bin: ArrayBuffer | Uint8Array): Graph {
    const buffer = bin instanceof Uint8Array
      ? bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer : bin;
    return new Graph(json, buffer);
  }

  constant(index: number): NDArray {
    let c = this.constants[index];
    if (c) return c;
    const { dtype, shape, offset, nbytes } = this.json.constants[index];
    const raw = this.bin.slice(offset, offset + nbytes);
    let data;
    switch (dtype) {
      case 'float32': data = new Float32Array(raw); break;
      case 'float64': data = new Float64Array(raw); break;
      case 'int32': data = new Int32Array(raw); break;
      case 'uint32': data = new Uint32Array(raw); break;
      case 'bool': case 'uint8': data = new Uint8Array(raw); break;
      case 'int64': data = Float64Array.from(new BigInt64Array(raw), Number); break;
      default:
        if (is_key(dtype)) { data = new Uint32Array(raw); break; }
        throw new Error(`constant dtype ${dtype}`);
    }
    c = new NDArray(dtype, shape, data);
    this.constants[index] = c;
    return c;
  }

  /** A named group of constants (e.g. 'env_state', 'actor_params') as a name -> array map. */
  values(group: string): Map<string, NDArray> {
    const out = new Map<string, NDArray>();
    for (const [name, index] of Object.entries(this.json.values[group] ?? {})) out.set(name, this.constant(index).clone());
    return out;
  }

  entry(name: string): EntryJson {
    const e = this.json.entries[name];
    if (!e) throw new Error(`No entry ${name}`);
    return e;
  }

  /**
   * A stateful runner for a JAX entry (generated code): `carry(output name)` names the input an
   * output feeds on the next step (e.g. 'state/...' -> itself). Inputs are set by name; outputs are
   * read by name on demand. Shares the program's registers: do not `run` the same entry meanwhile.
   */
  session(name: string, carry: (output: string) => string | undefined, fixed?: Map<string, NDArray>) {
    const entry = this.entry(name);
    let program = this.program(entry.function);
    if (fixed?.size) {
      // Inputs that never change (e.g. parameters): everything computed from them and constants
      // alone is evaluated once here and becomes a constant of a specialized program.
      const by_index = new Map<number, NDArray>();
      entry.inputs.forEach((i, k) => {
        const a = fixed.get(i.name);
        if (a) by_index.set(k, a.dtype === i.dtype ? a : astype(a, i.dtype));
      });
      program = program.fold(by_index);
    }
    const compiled = this.compiled_of(program);
    const in_index = new Map(entry.inputs.map((i, k) => [i.name, k]));
    const out_index = new Map(entry.outputs.map((o, k) => [o.name, k]));
    const pairs: [number, number][] = [];
    entry.outputs.forEach((o, k) => {
      const target = carry(o.name);
      if (target !== undefined && in_index.has(target)) pairs.push([k, in_index.get(target)!]);
    });
    const session: Session = compiled.session(pairs);
    return {
      set: (input: string, a: NDArray) => {
        const k = in_index.get(input);
        if (k === undefined) throw new Error(`${name}: no input ${input}`);
        const spec = entry.inputs[k];
        session.set(k, a.dtype === spec.dtype || is_key(spec.dtype) || is_key(a.dtype) ? a : astype(a, spec.dtype));
      },
      step: (options: RunOptions = {}) => session.step(options),
      get: (output: string) => {
        const k = out_index.get(output);
        if (k === undefined) throw new Error(`${name}: no output ${output}`);
        return session.get(k);
      },
      outputs: entry.outputs.map(o => o.name),
    };
  }

  /** Runs an entry with named inputs; returns named outputs (mutations under their input names). */
  run(name: string, inputs: Map<string, NDArray>, options: RunOptions = {}): Map<string, NDArray> {
    const entry = this.entry(name);
    const args = entry.inputs.map(i => {
      const v = inputs.get(i.name);
      if (!v) throw new Error(`${name}: missing input ${i.name}`);
      if (is_key(i.dtype) && !is_key(v.dtype)) {  // Raw key data (uint32, trailing key dims).
        return new NDArray(i.dtype, [...i.shape], Uint32Array.from(v.data));
      }
      if (!is_key(i.dtype) && is_key(v.dtype)) {  // Graphs that take raw key data (HLO).
        return new NDArray(i.dtype, [...i.shape], Uint32Array.from(v.data));
      }
      const want = size(i.shape), got = v.size;
      if (want !== got) throw new Error(`${name}: input ${i.name} has shape [${v.shape}], expected [${i.shape}]`);
      return v.shape.length === i.shape.length ? v : new NDArray(v.dtype, [...i.shape], v.data);
    });
    const fn = this.json.functions[entry.function];
    const outs = options.reference || (fn.dialect === 'torch' && options.codegen === false)
      ? this.call(entry.function, args, options)
      : options.codegen === false
        ? this.program(entry.function).run(args, options)
        : this.compiled_of(this.program(entry.function)).run(args, options);
    const result = new Map<string, NDArray>();
    entry.outputs.forEach((o, k) => result.set(o.name, outs[k]));
    return result;
  }

  call(fid: string, args: NDArray[], options: RunOptions = {}): NDArray[] {
    const fn = this.json.functions[fid];
    const env: (NDArray | undefined)[] = new Array(fn.vars.length);
    fn.inputs.forEach((v, k) => { env[v] = args[k]; });
    const torch = fn.dialect === 'torch';

    const atom = (a: any): any => {
      if (typeof a === 'number') {
        if (torch) return a;  // A scalar argument.
        const v = env[a];
        if (!v) throw new Error(`${fid}: unbound variable ${a}`);
        return v;
      }
      if (a === null || typeof a === 'boolean' || typeof a === 'string') return torch ? decode_number(a) : a;
      if (Array.isArray(a)) return a.map(atom);
      if ('v' in a) {
        const v = env[a.v];
        if (!v) throw new Error(`${fid}: unbound variable ${a.v}`);
        return v;
      }
      if ('const' in a) return this.constant(a.const);
      if ('lit' in a) return scalar(decode_number(a.lit), a.dtype);
      if ('dtype' in a) return a;
      throw new Error(`${fid}: bad atom ${JSON.stringify(a)}`);
    };

    for (let i = 0; i < fn.eqns.length; i++) {
      const eqn = fn.eqns[i];
      const out_types = eqn.out.map(v => fn.vars[v]);
      let outs: NDArray[];
      if (torch) {
        const op = TORCH_OPS[eqn.op];
        if (!op) throw new Error(`Unsupported torch op ${eqn.op}`);
        const params: Record<string, any> = {};
        for (const [k, v] of Object.entries(eqn.params)) params[k] = atom(v);
        outs = [op(eqn.in.map(atom), params, out_types[0])];
      } else {
        const inputs = eqn.in.map(atom) as NDArray[];
        outs = this.eval_jax(eqn.op, inputs, eqn.params, out_types, options);
      }
      if (this.counts) this.counts.set(eqn.op, (this.counts.get(eqn.op) ?? 0) + 1);
      for (let k = 0; k < eqn.out.length; k++) {
        const t = out_types[k], o = outs[k];
        if (o.size !== size(t[1])) {
          throw new Error(`${fid}#${i} ${eqn.op}: output ${k} has shape [${o.shape}], expected [${t[1]}]`);
        }
        let v = o.dtype === t[0] || is_key(t[0]) ? o : astype(o, t[0]);
        if (v.shape.length !== t[1].length || v.shape.some((d, j) => d !== t[1][j])) v = reshape(v, [...t[1]]);
        env[eqn.out[k]] = v;
      }
      options.trace?.(fid, i, eqn.op, outs);
    }
    return fn.outputs.map(atom) as NDArray[];
  }

  private eval_jax(
    op: string, inputs: NDArray[], params: Record<string, any>, out_types: [DType, number[]][], options: RunOptions,
  ): NDArray[] {
    switch (op) {
      case 'jit':
      case 'pjit':
      case 'closed_call':
      case 'core_call':
      case 'remat':
      case 'checkpoint':
        return this.call(params.jaxpr.fn, inputs, options);
      case 'custom_jvp_call':
      case 'custom_vjp_call':
      case 'custom_vjp_call_jaxpr':
        return this.call((params.call_jaxpr ?? params.fun_jaxpr).fn, inputs, options);
      case 'scan':
        return this.scan(inputs, params, options);
      case 'mujoco_physics': {
        if (!options.physics) throw new Error('mujoco_physics needs a Physics implementation');
        return options.physics.call(params.op, params, inputs);
      }
      default: {
        const f = JAX_OPS[op];
        if (!f) throw new Error(`Unsupported jax op ${op}`);
        return f(inputs, params, out_types);
      }
    }
  }

  private scan(inputs: NDArray[], p: Record<string, any>, options: RunOptions): NDArray[] {
    const { length, num_consts, num_carry, reverse } = p;
    const consts = inputs.slice(0, num_consts);
    let carry = inputs.slice(num_consts, num_consts + num_carry);
    const xs = inputs.slice(num_consts + num_carry);
    const body = this.json.functions[p.jaxpr.fn];
    const n_ys = body.outputs.length - num_carry;
    const ys_types = body.outputs.slice(num_carry).map((a: any) => body.vars[a]);
    const ys = ys_types.map(([dtype, shape]) => new NDArray(dtype, [length, ...shape]));
    for (let k = 0; k < length; k++) {
      const i = reverse ? length - 1 - k : k;
      const x_i = xs.map(x => {
        const n = size(x.shape.slice(1));
        return new NDArray(x.dtype, x.shape.slice(1), x.data.slice(i * n, (i + 1) * n));
      });
      const out = this.call(p.jaxpr.fn, [...consts, ...carry, ...x_i], options);
      carry = out.slice(0, num_carry);
      for (let j = 0; j < n_ys; j++) {
        const y = out[num_carry + j];
        ys[j].data.set(y.data, i * y.data.length);
      }
    }
    return [...carry, ...ys];
  }
}


/** A tensor argument of a torch eqn (distinguishes slots from scalar arguments). */
class TRef { o: Operand; constructor(o: Operand) { this.o = o; } }

// ==================================================================================================
// Compiled programs: JAX functions flattened (jit calls inlined, no-op eqns aliased away) into a
// linear list of instructions over numbered slots, with operands, params, and literals resolved once.

type Operand = number | NDArray;  // A slot index, or a constant/literal.

interface Instr {
  op: string;
  kind: 'op' | 'scan' | 'physics';
  f: ((inputs: NDArray[], params: Record<string, any>, out_types: [DType, number[]][]) => NDArray[]) | null;
  ins: Operand[];
  args: NDArray[];  // Reused argument buffer.
  outs: number[];
  out_types: [DType, number[]][];
  params: Record<string, any>;
  body?: Program;
}

const INLINE = new Set(['jit', 'pjit', 'closed_call', 'core_call', 'remat', 'checkpoint',
                        'custom_jvp_call', 'custom_vjp_call', 'custom_vjp_call_jaxpr']);
const ALIAS = new Set(['copy', 'copy_p', 'device_put', 'optimization_barrier', 'stop_gradient']);

function same_shape(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

export class Program {
  graph: Graph;
  instrs: Instr[] = [];
  nslots = 0;
  inputs: number[] = [];
  input_types: [DType, number[]][] = [];
  outputs: Operand[] = [];
  stats: Record<string, number> = { eqns: 0, inlined: 0, aliased: 0, rewrites: 0 };
  /** Types of slots created by the torch translation (inputs included). */
  slot_types = new Map<number, [DType, number[]]>();
  /** Torch var id -> operand (debugging translations). */
  debug_bind = new Map<number, Operand>();

  constructor(graph: Graph, fid: string) {
    this.graph = graph;
    const fn = graph.json.functions[fid];
    const ins: Operand[] = fn.inputs.map(() => this.nslots++);
    this.inputs = ins as number[];
    this.input_types = fn.inputs.map(v => fn.vars[v]);
    this.inputs.forEach((slot, k) => this.slot_types.set(slot, this.input_types[k]));
    this.outputs = fn.dialect === 'torch' ? this.flatten_torch(fid, ins) : this.flatten(fid, ins);
  }

  /**
   * A copy with the given inputs fixed (by input index): instructions whose operands are all
   * constants or fixed values are evaluated now and replaced by their results. Random ops, scans
   * and physics are never evaluated. Fixed inputs stay inputs (now unused).
   */
  fold(fixed: Map<number, NDArray>): Program {
    const p = Object.create(Program.prototype) as Program;
    Object.assign(p, this);
    p.stats = { ...this.stats, folded: 0 };
    const known = new Map<number, NDArray>();
    fixed.forEach((a, k) => known.set(this.inputs[k], a));
    const resolve = (o: Operand): Operand => (typeof o === 'number' && known.has(o) ? known.get(o)! : o);
    p.instrs = [];
    for (const instr of this.instrs) {
      const ins = instr.ins.map(resolve);
      if (instr.kind === 'op' && instr.f && !/rand|normal|bernoulli|uniform|rng/i.test(instr.op)
          && ins.every(o => typeof o !== 'number')) {
        const outs = instr.f(ins as NDArray[], instr.params, instr.out_types);
        outs.forEach((a, k) => known.set(instr.outs[k], a.clone()));
        p.stats.folded++;
        continue;
      }
      p.instrs.push({ ...instr, ins, args: new Array(ins.length) });
    }
    p.outputs = this.outputs.map(resolve);
    return p;
  }

  /**
   * Torch (ATen) functions: common ops are translated to the equivalent JAX-style instructions
   * (so generated code handles them); any other op runs its TORCH_OPS implementation as an opaque
   * instruction. Shapes and dtypes come from the export's type table.
   */
  private flatten_torch(fid: string, args: Operand[]): Operand[] {
    const fn = this.graph.json.functions[fid];
    const bind = new Map<number, Operand>();
    fn.inputs.forEach((v, k) => bind.set(v, args[k]));
    const type_of = (o: Operand): [DType, number[]] => (typeof o === 'number' ? this.slot_types.get(o)! : [o.dtype, o.shape]);
    const emit = (op: string, ins: Operand[], out_type: [DType, number[]], params: Record<string, any> = {}): Operand => {
      // Fold constants.
      if (JAX_OPS[op] && ins.every(o => typeof o !== 'number')) {
        let c = JAX_OPS[op](ins as NDArray[], params, [out_type])[0];
        if (c.dtype !== out_type[0]) c = astype(c, out_type[0]);
        if (!same_shape(c.shape, out_type[1])) c = reshape(c, [...out_type[1]]);
        return c;
      }
      if ((op === 'reshape' || op === 'copy') && same_shape(type_of(ins[0])[1], out_type[1]) && type_of(ins[0])[0] === out_type[0]) return ins[0];
      if (op === 'convert_element_type' && type_of(ins[0])[0] === out_type[0]) return ins[0];
      const slot = this.nslots++;
      this.slot_types.set(slot, out_type);
      const f = JAX_OPS[op];
      if (!f) throw new Error(`torch translation: no op ${op}`);
      this.instrs.push({ op, kind: 'op', f, ins, args: new Array(ins.length), outs: [slot], out_types: [out_type], params, origin: current } as any);
      return slot;
    };
    const lit = (x: number, dtype: DType) => scalar(x, dtype);
    // Broadcast `o` to `shape` (numpy: align trailing dims), then cast.
    const to = (o: Operand, t: [DType, number[]]): Operand => {
      const [dt, sh] = type_of(o);
      let r = o;
      if (!same_shape(sh, t[1])) {
        const dims = sh.map((_, i) => t[1].length - sh.length + i);
        r = emit('broadcast_in_dim', [r], [dt, t[1]], { shape: t[1], broadcast_dimensions: dims });
      }
      if (dt !== t[0]) r = emit('convert_element_type', [r], t, { new_dtype: t[0] });
      return r;
    };
    const norm = (d: number, nd: number) => (d < 0 ? d + nd : d);
    const BIN: Record<string, string> = {
      'aten.add.Tensor': 'add', 'aten.sub.Tensor': 'sub', 'aten.mul.Tensor': 'mul', 'aten.div.Tensor': 'div',
      'aten.eq.Tensor': 'eq', 'aten.eq.Scalar': 'eq', 'aten.ne.Tensor': 'ne', 'aten.ne.Scalar': 'ne',
      'aten.lt.Tensor': 'lt', 'aten.lt.Scalar': 'lt', 'aten.le.Tensor': 'le', 'aten.le.Scalar': 'le',
      'aten.gt.Tensor': 'gt', 'aten.gt.Scalar': 'gt', 'aten.ge.Tensor': 'ge', 'aten.ge.Scalar': 'ge',
      'aten.bitwise_and.Tensor': 'and', 'aten.bitwise_or.Tensor': 'or',
    };
    const UN: Record<string, string> = {
      'aten.neg.default': 'neg', 'aten.exp.default': 'exp', 'aten.log.default': 'log', 'aten.sign.default': 'sign',
      'aten.bitwise_not.default': 'not', 'aten.sqrt.default': 'sqrt', 'aten.tanh.default': 'tanh', 'aten.abs.default': 'abs',
    };
    let current = '';
    for (const [ei, eqn] of fn.eqns.entries()) {
      current = `#${ei} ${eqn.op}`;
      this.stats.eqns++;
      const out_t = fn.vars[eqn.out[0]] as [DType, number[]];
      // Tensors become TRef (slot or constant); scalars stay numbers, so the two cannot be confused.
      const val = (a: any): any => {
        if (a !== null && typeof a === 'object' && !Array.isArray(a)) {
          if ('v' in a) { const o = bind.get(a.v); if (o === undefined) throw new Error(`${fid}: unbound ${a.v}`); return new TRef(o); }
          if ('const' in a) return new TRef(this.graph.constant(a.const));
          return a;
        }
        if (Array.isArray(a)) return a.map(val);
        return decode_number(a);
      };
      const A = eqn.in.map(val).map((x: any) => (x instanceof TRef ? x.o : Array.isArray(x) ? x.map((y: any) => (y instanceof TRef ? y.o : y)) : x));
      const tensor_args = new Set<any>();
      eqn.in.forEach((a: any, k: number) => {
        if (a && typeof a === 'object' && ('v' in a || 'const' in a)) tensor_args.add(k);
      });
      const isT = (k: number) => tensor_args.has(k);
      // Operand for a tensor-or-scalar argument (scalars become literals of the output's dtype).
      const operand = (k: number, dt: DType): Operand => (isT(k) ? A[k] : lit(A[k], dt.startsWith('float') ? dt : (typeof A[k] === 'number' && !Number.isInteger(A[k]) ? 'float32' : dt)));
      let result: Operand | null = null;
      const op = eqn.op;
      if (op in BIN) {
        const cmp = !['add', 'sub', 'mul', 'div', 'and', 'or'].includes(BIN[op]);
        const compute_dt: DType = cmp ? (isT(0) ? type_of(A[0])[0] : 'float32') : out_t[0];
        let a = operand(0, compute_dt), b = operand(1, cmp && isT(0) ? type_of(A[0])[0] : compute_dt);
        if (!cmp) { a = to(a, [out_t[0], type_of(a)[1]]); b = to(b, [out_t[0], type_of(b)[1]]); }
        if ((op === 'aten.add.Tensor' || op === 'aten.sub.Tensor') && A[2] !== undefined && A[2] !== null && A[2] !== 1) {
          b = emit('mul', [b, lit(A[2], out_t[0])], [out_t[0], type_of(b)[1]]);
        }
        // Broadcast both to the output shape so ops see equal shapes (or scalars).
        if (!same_shape(type_of(a)[1], out_t[1]) && size(type_of(a)[1]) !== 1) a = to(a, [type_of(a)[0], out_t[1]]);
        if (!same_shape(type_of(b)[1], out_t[1]) && size(type_of(b)[1]) !== 1) b = to(b, [type_of(b)[0], out_t[1]]);
        result = emit(BIN[op], [a, b], out_t);
      } else if (op in UN) {
        result = emit(UN[op], [to(A[0], [out_t[0], type_of(A[0])[1]])], out_t);
      } else if (op === 'aten.reciprocal.default') {
        result = emit('div', [lit(1, out_t[0]), to(A[0], [out_t[0], type_of(A[0])[1]])], out_t);
      } else if (op === 'aten.clamp.default' || op === 'aten.hardtanh.default') {
        let x: Operand = to(A[0], [out_t[0], type_of(A[0])[1]]);
        const lo = op === 'aten.hardtanh.default' ? (A[1] ?? -1) : A[1], hi = op === 'aten.hardtanh.default' ? (A[2] ?? 1) : A[2];
        if (lo !== null && lo !== undefined) x = emit('max', [x, lit(lo, out_t[0])], out_t);
        if (hi !== null && hi !== undefined) x = emit('min', [x, lit(hi, out_t[0])], out_t);
        result = x;
      } else if (op === 'aten.clamp.Tensor') {
        let x: Operand = to(A[0], out_t);
        if (A[1] !== null && A[1] !== undefined) x = emit('max', [x, to(A[1], out_t)], out_t);
        if (A[2] !== null && A[2] !== undefined) x = emit('min', [x, to(A[2], out_t)], out_t);
        result = x;
      } else if (['aten.clone.default', 'aten.alias.default', 'aten.lift_fresh_copy.default'].includes(op)) {
        result = A[0];
      } else if (op === 'aten._to_copy.default') {
        result = to(A[0], out_t);
      } else if (op === 'aten.copy.default') {
        result = to(A[1], out_t);
      } else if (op === 'aten.expand.default') {
        result = to(A[0], [type_of(A[0])[0], out_t[1]]);
      } else if (op === 'aten.full.default') {
        result = full(out_t[1], A[1], out_t[0]);
      } else if (['aten.view.default', 'aten._unsafe_view.default', 'aten.reshape.default', 'aten.unsqueeze.default', 'aten.squeeze.dims', 'aten.squeeze.dim'].includes(op)) {
        result = emit('reshape', [A[0]], out_t, { new_sizes: out_t[1], dimensions: null });
      } else if (op === 'aten.permute.default') {
        const nd = type_of(A[0])[1].length;
        result = emit('transpose', [A[0]], out_t, { permutation: (A[1] as number[]).map(d => norm(d, nd)) });
      } else if (op === 'aten.select.int') {
        const sh = type_of(A[0])[1], d = norm(A[1], sh.length);
        const i = A[2] < 0 ? A[2] + sh[d] : A[2];
        const st = sh.map(() => 0), lim = [...sh];
        st[d] = i; lim[d] = i + 1;
        const sl = emit('slice', [A[0]], [out_t[0], lim.map((l, k) => l - st[k])], { start_indices: st, limit_indices: lim, strides: null });
        result = emit('reshape', [sl], out_t, { new_sizes: out_t[1], dimensions: null });
      } else if (op === 'aten.slice.Tensor') {
        const sh = type_of(A[0])[1], d = norm(A[1] ?? 0, sh.length), n = sh[d];
        const c = (x: number) => Math.min(Math.max(x < 0 ? x + n : x, 0), n);
        const s0 = c(A[2] ?? 0), e0 = Math.max(c(A[3] ?? n), s0), step = A[4] ?? 1;
        const st = sh.map(() => 0), lim = [...sh], strides = sh.map(() => 1);
        st[d] = s0; lim[d] = e0; strides[d] = step;
        result = emit('slice', [A[0]], out_t, { start_indices: st, limit_indices: lim, strides });
      } else if (op === 'aten.cat.default') {
        const parts = (A[0] as Operand[]).filter(t => !(type_of(t)[1].length === 1 && type_of(t)[1][0] === 0)).map(t => to(t, [out_t[0], type_of(t)[1]]));
        const nd = out_t[1].length;
        result = parts.length === 1 ? parts[0] : emit('concatenate', parts, out_t, { dimension: norm(A[1] ?? 0, nd) });
      }
      if (result === null) {
        // Opaque: run the ATen implementation with the original argument structure.
        const operands: Operand[] = [];
        const template = (a: any): any => {
          if (Array.isArray(a)) return a.map(template);
          if (a instanceof TRef) { operands.push(a.o); return { __operand: operands.length - 1 }; }
          return a;
        };
        const tmpl_args = eqn.in.map(val).map(template);
        const tmpl_params: Record<string, any> = {};
        for (const [k, v] of Object.entries(eqn.params)) tmpl_params[k] = template(val(v));
        const impl = TORCH_OPS[op];
        if (!impl) throw new Error(`Unsupported torch op ${op}`);
        const fill = (a: any, xs: NDArray[]): any => (Array.isArray(a) ? a.map(x => fill(x, xs)) : a && typeof a === 'object' && '__operand' in a ? xs[a.__operand] : a);
        const slot = this.nslots++;
        this.slot_types.set(slot, out_t);
        this.instrs.push({
          op, kind: 'op', ins: operands, args: new Array(operands.length), outs: [slot], out_types: [out_t], params: {},
          f: (xs: NDArray[]) => [impl(tmpl_args.map(a => fill(a, xs)), Object.fromEntries(Object.entries(tmpl_params).map(([k, v]) => [k, fill(v, xs)])), out_t)],
        });
        result = slot;
      }
      bind.set(eqn.out[0], result);
      this.debug_bind.set(eqn.out[0], result);
    }
    return fn.outputs.map((a: any) => {
      if (a && typeof a === 'object' && 'v' in a) return bind.get(a.v)!;
      if (a && typeof a === 'object' && 'const' in a) return this.graph.constant(a.const);
      throw new Error(`${fid}: bad output ${JSON.stringify(a)}`);
    });
  }

  /** Emits a function's eqns with its inputs bound to `args`; returns its output operands. */
  private flatten(fid: string, args: Operand[]): Operand[] {
    const fn = this.graph.json.functions[fid];
    const bind = new Map<number, Operand>();
    fn.inputs.forEach((v, k) => bind.set(v, args[k]));
    const type_of = (o: Operand, a: any): [DType, number[]] =>
      typeof a === 'number' ? fn.vars[a] : [(o as NDArray).dtype, (o as NDArray).shape];
    const operand = (a: any): Operand => {
      if (typeof a === 'number') {
        const o = bind.get(a);
        if (o === undefined) throw new Error(`${fid}: unbound variable ${a}`);
        return o;
      }
      if ('const' in a) return this.graph.constant(a.const);
      if ('lit' in a) return scalar(decode_number(a.lit), a.dtype);
      throw new Error(`${fid}: bad atom ${JSON.stringify(a)}`);
    };
    // Values that are `convert_element_type(pred: bool)`, for XLA's `convert(pred) * x` rewrite.
    const from_pred = new Map<number, Operand>();
    for (const eqn of fn.eqns) {
      this.stats.eqns++;
      let ins = eqn.in.map(operand);
      const out_types = eqn.out.map(v => fn.vars[v]);
      let op = eqn.op;
      if (op === 'convert_element_type' && typeof eqn.in[0] === 'number' && fn.vars[eqn.in[0]][0] === 'bool'
          && out_types[0][0] !== 'bool') {
        from_pred.set(eqn.out[0], ins[0]);
      }
      // XLA's algebraic simplifier turns `convert(pred) * x` into `select(pred, x, 0)`, so a false
      // predicate yields 0 even where x is inf/NaN. Mirror it (the graph would give NaN otherwise).
      if (op === 'mul') {
        const k = eqn.in.findIndex(a => typeof a === 'number' && from_pred.has(a));
        if (k >= 0) {
          const pred = from_pred.get(eqn.in[k] as number)!;
          const other = ins[1 - k];
          const pred_shape = typeof pred === 'number' ? null : pred.shape;
          const pred_size = pred_shape ? size(pred_shape) : size(fn.vars[eqn.in[k] as number][1]);
          const other_size = typeof other === 'number' ? size(type_of(other, eqn.in[1 - k])[1]) : other.size;
          if (pred_size === size(out_types[0][1]) || pred_size === 1) {
            if (other_size === size(out_types[0][1]) || other_size === 1) {
              op = 'select_n';
              ins = [pred, scalar(0, out_types[0][0]), other];
              this.stats.rewrites = (this.stats.rewrites ?? 0) + 1;
            }
          }
        }
      }
      if (INLINE.has(op)) {
        const callee = (eqn.params.jaxpr ?? eqn.params.call_jaxpr ?? eqn.params.fun_jaxpr).fn;
        const outs = this.flatten(callee, ins);
        eqn.out.forEach((v, k) => bind.set(v, outs[k]));
        this.stats.inlined++;
        continue;
      }
      // No-ops: identity ops, same-type conversions, same-shape broadcasts/reshapes.
      if (eqn.in.length === 1 && eqn.out.length === 1) {
        const [dtype, shape] = type_of(ins[0], eqn.in[0]);
        const [odtype, oshape] = out_types[0];
        const noop = ALIAS.has(op)
          || (op === 'convert_element_type' && dtype === odtype)
          || ((op === 'broadcast_in_dim' || op === 'reshape' || op === 'squeeze')
              && same_shape(shape, oshape) && dtype === odtype);
        if (noop) {
          bind.set(eqn.out[0], ins[0]);
          this.stats.aliased++;
          continue;
        }
      }
      // Constant folding: ops whose inputs are all constants are evaluated once here.
      if (op !== 'scan' && op !== 'mujoco_physics' && JAX_OPS[op] && ins.every(o => typeof o !== 'number')
          && !out_types.some(t => is_key(t[0])) && out_types.every(t => size(t[1]) <= 1 << 16)) {
        const vals = JAX_OPS[op](ins as NDArray[], eqn.params, out_types);
        vals.forEach((v, k) => {
          const t = out_types[k];
          let c = v.dtype === t[0] ? v : astype(v, t[0]);
          if (!same_shape(c.shape, t[1])) c = reshape(c, [...t[1]]);
          bind.set(eqn.out[k], c);
        });
        this.stats.folded = (this.stats.folded ?? 0) + 1;
        continue;
      }
      const outs = eqn.out.map(() => this.nslots++);
      eqn.out.forEach((v, k) => bind.set(v, outs[k]));
      const instr: Instr = {
        op, kind: 'op', f: null, ins, args: new Array(ins.length), outs, out_types,
        params: eqn.params,
      };
      if (op === 'scan') {
        instr.kind = 'scan';
        instr.body = this.graph.program(eqn.params.jaxpr.fn);
      } else if (op === 'mujoco_physics') {
        instr.kind = 'physics';
      } else {
        instr.f = JAX_OPS[op];
        if (!instr.f) throw new Error(`Unsupported jax op ${op}`);
      }
      this.instrs.push(instr);
    }
    return fn.outputs.map(operand);
  }

  run(args: NDArray[], options: RunOptions = {}): NDArray[] {
    return this.run_slots(args, options).outputs;
  }

  run_slots(args: NDArray[], options: RunOptions = {}): { outputs: NDArray[], slots: NDArray[] } {
    const slots: NDArray[] = new Array(this.nslots);
    for (let k = 0; k < this.inputs.length; k++) slots[this.inputs[k]] = args[k];
    const counts = this.graph.counts, profile = this.graph.profile;
    for (const instr of this.instrs) {
      const t0 = profile ? performance.now() : 0;
      const a = instr.args;
      for (let k = 0; k < instr.ins.length; k++) {
        const o = instr.ins[k];
        a[k] = typeof o === 'number' ? slots[o] : o;
      }
      let outs: NDArray[];
      try {
        outs = instr.kind === 'op' ? instr.f!(a, instr.params, instr.out_types) : this.exec_special(instr, a, options);
      } catch (e) {
        throw new Error(`${instr.op} (${(instr as any).origin ?? ''}): ${e instanceof Error ? e.message : e}`);
      }
      if (counts) counts.set(instr.op, (counts.get(instr.op) ?? 0) + 1);
      if (profile && instr.kind === 'op') profile.set(instr.op, (profile.get(instr.op) ?? 0) + performance.now() - t0);
      for (let k = 0; k < instr.outs.length; k++) {
        const t = instr.out_types[k];
        let v = outs[k];
        if (v.dtype !== t[0] && !is_key(t[0])) v = astype(v, t[0]);
        if (!same_shape(v.shape, t[1])) v = reshape(v, [...t[1]]);
        slots[instr.outs[k]] = v;
      }
    }
    return { outputs: this.outputs.map(o => (typeof o === 'number' ? slots[o] : o)), slots };
  }

  /** Runs a scan or physics instruction. */
  exec_special(instr: Instr, args: NDArray[], options: RunOptions): NDArray[] {
    if (instr.kind === 'scan') return this.scan(instr, args, options);
    if (!options.physics) throw new Error('mujoco_physics needs a Physics implementation');
    return options.physics.call(instr.params.op, instr.params, args);
  }

  /** Runs the loop body as generated code when enabled. */
  body_run(body: Program, args: NDArray[], options: RunOptions): NDArray[] {
    return options.codegen === false ? body.run(args, options) : this.graph.compiled_of(body).run(args, options);
  }

  private scan(instr: Instr, inputs: NDArray[], options: RunOptions): NDArray[] {
    const { length, num_consts, num_carry, reverse } = instr.params;
    const body = instr.body!;
    if (options.codegen !== false && inputs.length === num_consts + num_carry && instr.out_types.length === num_carry) {
      // A loop (fori_loop): no per-iteration inputs/outputs; keep the carry inside generated code.
      return this.graph.compiled_of(body).run_loop(
        inputs.slice(0, num_consts), inputs.slice(num_consts), length, options);
    }
    const consts = inputs.slice(0, num_consts);
    let carry = inputs.slice(num_consts, num_consts + num_carry);
    const xs = inputs.slice(num_consts + num_carry);
    const ys_types = instr.out_types.slice(num_carry);
    const ys = ys_types.map(([dtype, shape]) => new NDArray(dtype, [...shape]));
    for (let k = 0; k < length; k++) {
      const i = reverse ? length - 1 - k : k;
      const x_i = xs.map(x => {
        const n = size(x.shape.slice(1));
        return new NDArray(x.dtype, x.shape.slice(1), x.data.slice(i * n, (i + 1) * n));
      });
      const out = this.body_run(body, [...consts, ...carry, ...x_i], options);
      carry = out.slice(0, num_carry);
      for (let j = 0; j < ys.length; j++) {
        const y = out[num_carry + j];
        ys[j].data.set(y.data, i * y.data.length);
      }
    }
    return [...carry, ...ys];
  }
}
