/**
 * Straight-line expression IR (shared by codegen.ts's JavaScript and WebAssembly backends) and its
 * WebAssembly encoder.
 *
 * Every expression evaluates to a double with exactly the semantics of the JavaScript the JS backend
 * renders (codegen.ts `render_js`): float32 rounding via f32.demote/f64.promote (= Math.fround),
 * ToInt32 wrapping via i64.trunc_sat + i32.wrap, NaN rules of the MAX/MIN/SIGN helpers, and the same
 * Math functions (imported, so the very same implementations). So both backends produce identical
 * bits.
 *
 * Memory layout (one imported memory, f64 cells): [register file R | constant arrays].
 */

export type E =
  | { t: 'n'; v: number }                       // literal
  | { t: 'r'; i: number }                       // R[i]
  | { t: 'c'; c: number; i: number }            // C[c][i] (constant array element)
  | { t: 's'; s: number; i: number }            // S[s][i] (slot array element; JS only)
  | { t: 'op'; op: string; a: E[]; p?: any };

export type Stmt =
  | { t: 'st'; i: number; e: E }                // R[i] = e
  | { t: 'dyn'; base: number; terms: { e: E; lim: number; stride: number }[]; writes: [number, E][]; drop?: boolean };
// 'dyn': R[base + b + w] = e for each write, b = sum_d start_d * stride_d with start_d clamped to
// [0, lim_d] (dynamic_update_slice), or, with `drop`, no writes at all when any start_d is outside
// [0, lim_d] (scatter FILL_OR_DROP). Starts are integer-valued.

export const n = (v: number): E => ({ t: 'n', v });
export const op = (o: string, ...a: E[]): E => ({ t: 'op', op: o, a });
export const opp = (o: string, p: any, ...a: E[]): E => ({ t: 'op', op: o, a, p });

/** Whether an expression/statement can run in WebAssembly (no slot-array reads). */
export function wasm_ok(e: E, const_ok: (c: number) => boolean): boolean {
  switch (e.t) {
    case 'n': case 'r': return true;
    case 'c': return const_ok(e.c);
    case 's': return false;
    case 'op': return e.a.every(x => wasm_ok(x, const_ok));
  }
}

export function stmt_wasm_ok(s: Stmt, const_ok: (c: number) => boolean): boolean {
  if (s.t === 'st') return wasm_ok(s.e, const_ok);
  return s.terms.every(t => wasm_ok(t.e, const_ok)) && s.writes.every(([, e]) => wasm_ok(e, const_ok));
}

// ---- Binary encoding -------------------------------------------------------------------------

function uleb(out: number[], v: number) {
  do {
    let b = v & 0x7f;
    v = Math.floor(v / 128);
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
}

function sleb(out: number[], v: number) {
  // v is an int32.
  v |= 0;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) { out.push(b); return; }
    out.push(b | 0x80);
  }
}

const f64buf = new DataView(new ArrayBuffer(8));
function f64bytes(out: number[], v: number) {
  f64buf.setFloat64(0, v, true);
  for (let k = 0; k < 8; k++) out.push(f64buf.getUint8(k));
}

function str(out: number[], s: string) {
  const b = new TextEncoder().encode(s);
  uleb(out, b.length);
  for (const x of b) out.push(x);
}

function section(out: number[], id: number, body: number[]) {
  out.push(id);
  uleb(out, body.length);
  for (const x of body) out.push(x);
}

/** Imported Math functions: [name, arity]. Order = function index. */
export const IMPORTS: [string, number][] = [
  ['exp', 1], ['log', 1], ['log1p', 1], ['tanh', 1], ['sin', 1], ['cos', 1], ['asin', 1], ['acos', 1],
  ['atan', 1], ['atan2', 2], ['pow', 2],
];
const IMPORT_INDEX = new Map(IMPORTS.map(([name], k) => [name, k]));

// Opcodes.
const I32_CONST = 0x41, F64_CONST = 0x44, F64_LOAD = 0x2b, F64_STORE = 0x39;
const LOCAL_GET = 0x20, LOCAL_SET = 0x21, LOCAL_TEE = 0x22, CALL = 0x10, SELECT = 0x1b;
const F64_EQ = 0x61, F64_NE = 0x62, F64_LT = 0x63, F64_GT = 0x64, F64_LE = 0x65, F64_GE = 0x66;
const F64_ABS = 0x99, F64_NEG = 0x9a, F64_CEIL = 0x9b, F64_FLOOR = 0x9c, F64_TRUNC = 0x9d, F64_SQRT = 0x9f;
const F64_ADD = 0xa0, F64_SUB = 0xa1, F64_MUL = 0xa2, F64_DIV = 0xa3, F64_MIN = 0xa4, F64_MAX = 0xa5;
const I32_EQZ = 0x45, I32_AND = 0x71, I32_OR = 0x72, I32_XOR = 0x73, I32_MUL = 0x6c, I32_ADD = 0x6a, I32_SHL = 0x74;
const I32_WRAP_I64 = 0xa7, F32_DEMOTE = 0xb6, F64_PROMOTE = 0xbb, F64_CONVERT_I32_S = 0xb7, F64_CONVERT_I32_U = 0xb8;
const I32_TRUNC_SAT_F64_S = [0xfc, 0x02], I64_TRUNC_SAT_F64_S = [0xfc, 0x06];

const COMPARE: Record<string, number> = { eq: F64_EQ, ne: F64_NE, lt: F64_LT, le: F64_LE, gt: F64_GT, ge: F64_GE };
const ARITH: Record<string, number> = { add: F64_ADD, sub: F64_SUB, mul: F64_MUL, div: F64_DIV };
const UNARY: Record<string, number> = { neg: F64_NEG, abs: F64_ABS, sqrt: F64_SQRT, floor: F64_FLOOR, ceil: F64_CEIL };

/** Function body builder: f64 locals with reuse; local 0 is the single i32 local (dyn offsets). */
class Body {
  code: number[] = [];
  private nf64 = 0;
  private free: number[] = [];
  private const_base: (c: number) => number;
  constructor(const_base: (c: number) => number) { this.const_base = const_base; }

  private local(): number {
    if (this.free.length) return this.free.pop()!;
    return 1 + this.nf64++;
  }
  private release(l: number) { this.free.push(l); }

  private b(...xs: number[]) { for (const x of xs) this.code.push(x); }
  private f64(v: number) { this.b(F64_CONST); f64bytes(this.code, v); }
  private i32(v: number) { this.b(I32_CONST); sleb(this.code, v); }
  private get(l: number) { this.b(LOCAL_GET); uleb(this.code, l); }
  private set(l: number) { this.b(LOCAL_SET); uleb(this.code, l); }
  private load(cell: number) { this.i32(0); this.b(F64_LOAD, 3); uleb(this.code, cell * 8); }
  private to_i32() { this.b(...I64_TRUNC_SAT_F64_S, I32_WRAP_I64); }
  /** Evaluates `e` into a fresh local (caller releases). Literals and loads are re-evaluated instead. */
  private hold(e: E): () => void {
    if (e.t === 'n' || e.t === 'r' || e.t === 'c') return () => this.expr(e);
    const l = this.local();
    this.expr(e);
    this.set(l);
    const use = () => this.get(l);
    (use as any).release = () => this.release(l);
    return use;
  }
  private drop(use: () => void) { (use as any).release?.(); }
  /** Pushes JS truthiness of the value (i32: x === x && x !== 0). */
  private truthy(use: () => void) {
    use(); use(); this.b(F64_EQ);
    use(); this.f64(0); this.b(F64_NE);
    this.b(I32_AND);
  }
  private is_boolean(e: E): boolean {
    return e.t === 'op' && (e.op in COMPARE || e.op === 'nz' || e.op === 'b01' || e.op === 'bnot');
  }
  private round(kind: string) {
    if (kind === 'F') this.b(F32_DEMOTE, F64_PROMOTE);
    else if (kind === 'I32') { this.to_i32(); this.b(F64_CONVERT_I32_S); }
  }

  expr(e: E): void {
    switch (e.t) {
      case 'n': this.f64(e.v); return;
      case 'r': this.load(e.i); return;
      case 'c': this.load(this.const_base(e.c) + e.i); return;
      case 's': throw new Error('wasm: slot read');
    }
    const a = e.a;
    const o = e.op;
    if (o in ARITH) { this.expr(a[0]); this.expr(a[1]); this.b(ARITH[o]); return; }
    if (o in COMPARE) { this.expr(a[0]); this.expr(a[1]); this.b(COMPARE[o], F64_CONVERT_I32_U); return; }
    if (o in UNARY) { this.expr(a[0]); this.b(UNARY[o]); return; }
    const imp = IMPORT_INDEX.get(o);
    if (imp !== undefined) { for (const x of a) this.expr(x); this.b(CALL); uleb(this.code, imp); return; }
    switch (o) {
      case 'max': case 'min': {
        // (x !== x || y !== y) ? NaN : (x > y ? x : y)   [min: x < y]
        const x = this.hold(a[0]), y = this.hold(a[1]);
        this.f64(NaN);
        x(); y(); x(); y(); this.b(o === 'max' ? F64_GT : F64_LT, SELECT);
        x(); x(); this.b(F64_NE); y(); y(); this.b(F64_NE, I32_OR);
        this.b(SELECT);
        this.drop(x); this.drop(y);
        return;
      }
      case 'sign': {
        // x !== x ? NaN : x > 0 ? 1 : x < 0 ? -1 : x
        const x = this.hold(a[0]);
        this.f64(NaN);
        this.f64(1); this.f64(-1); x(); x(); this.f64(0); this.b(F64_LT, SELECT); x(); this.f64(0); this.b(F64_GT, SELECT);
        x(); x(); this.b(F64_NE, SELECT);
        this.drop(x);
        return;
      }
      case 'rsqrt': this.f64(1); this.expr(a[0]); this.b(F64_SQRT, F64_DIV); return;
      case 'logistic':
        this.f64(1); this.f64(1); this.expr(a[0]); this.b(F64_NEG, CALL); uleb(this.code, IMPORT_INDEX.get('exp')!);
        this.b(F64_ADD, F64_DIV);
        return;
      case 'f32': this.expr(a[0]); this.b(F32_DEMOTE, F64_PROMOTE); return;
      case 'i32': this.expr(a[0]); this.to_i32(); this.b(F64_CONVERT_I32_S); return;
      case 'u32': this.expr(a[0]); this.to_i32(); this.b(F64_CONVERT_I32_U); return;
      case 'and': case 'or': case 'xor':
        this.expr(a[0]); this.to_i32(); this.expr(a[1]); this.to_i32();
        this.b(o === 'and' ? I32_AND : o === 'or' ? I32_OR : I32_XOR, F64_CONVERT_I32_S);
        return;
      case 'inot': this.expr(a[0]); this.to_i32(); this.i32(-1); this.b(I32_XOR, F64_CONVERT_I32_S); return;
      case 'imul': this.expr(a[0]); this.to_i32(); this.expr(a[1]); this.to_i32(); this.b(I32_MUL, F64_CONVERT_I32_S); return;
      case 'idiv': {
        // y === 0 ? -1 : Math.trunc(x / y)
        const y = this.hold(a[1]);
        this.f64(-1); this.expr(a[0]); y(); this.b(F64_DIV, F64_TRUNC); y(); this.f64(0); this.b(F64_EQ, SELECT);
        this.drop(y);
        return;
      }
      case 'nz': this.expr(a[0]); this.f64(0); this.b(F64_NE, F64_CONVERT_I32_U); return;
      case 'b01': {
        if (this.is_boolean(a[0])) { this.expr(a[0]); return; }
        const x = this.hold(a[0]);
        this.truthy(x); this.b(F64_CONVERT_I32_U);
        this.drop(x);
        return;
      }
      case 'bnot': {
        const x = this.hold(a[0]);
        this.truthy(x); this.b(I32_EQZ, F64_CONVERT_I32_U);
        this.drop(x);
        return;
      }
      case 'sel': {
        // c ? t : f
        this.expr(a[1]); this.expr(a[2]);
        const c = this.hold(a[0]);
        this.truthy(c); this.b(SELECT);
        this.drop(c);
        return;
      }
      case 'nsel': {
        // [c0, c1, ...][p]  (p a valid index)
        const p = this.hold(a[0]);
        const cases = a.slice(1);
        this.expr(cases[cases.length - 1]);
        for (let k = cases.length - 2; k >= 0; k--) {
          // stack: v (for p > k) -> select(c_k, v, p == k)
          const v = this.local();
          this.set(v);
          this.expr(cases[k]); this.get(v); p(); this.f64(k); this.b(F64_EQ, SELECT);
          this.release(v);
        }
        this.drop(p);
        return;
      }
      case 'f2i': {
        // x !== x ? 0 : (t = trunc(x)) < lo ? lo : t > hi ? hi : t
        const { lo, hi } = e.p;
        const t = this.local();
        this.expr(a[0]); this.b(F64_TRUNC); this.set(t);
        this.f64(0);
        this.f64(lo); this.f64(hi); this.get(t); this.get(t); this.f64(hi); this.b(F64_GT, SELECT);
        this.get(t); this.f64(lo); this.b(F64_LT, SELECT);
        this.get(t); this.get(t); this.b(F64_NE, SELECT);
        this.release(t);
        return;
      }
      case 'ipow': {
        // Square-and-multiply as the JS IPOW helper, unrolled for the static exponent.
        const { y, round } = e.p;
        const base = this.local(), acc = this.local();
        this.expr(a[0]); this.set(base);
        let m = Math.abs(y), has = false;
        while (m > 0) {
          if (m & 1) {
            if (!has) { this.get(base); this.set(acc); has = true; } else { this.get(acc); this.get(base); this.b(F64_MUL); this.round(round); this.set(acc); }
          }
          m >>= 1;
          if (m) { this.get(base); this.get(base); this.b(F64_MUL); this.round(round); this.set(base); }
        }
        if (y < 0) this.f64(1);
        if (has) this.get(acc); else this.f64(1);
        if (y < 0) { this.b(F64_DIV); this.round(round); }
        this.release(base); this.release(acc);
        return;
      }
    }
    throw new Error(`wasm: op ${o}`);
  }

  stmt(s: Stmt) {
    if (s.t === 'st') {
      this.i32(0); this.expr(s.e); this.b(F64_STORE, 3); uleb(this.code, s.i * 8);
      return;
    }
    // b = sum_d min(max(start_d, 0), lim_d) * stride_d   (i32 local 0), then R[base + b + w] = e.
    if (s.drop) {
      // block; per term: t = start (f64 local); exit the block unless 0 <= t <= lim; b += t * stride.
      this.b(0x02, 0x40);
      this.i32(0); this.set(0);
      for (const t of s.terms) {
        const l = this.local();
        this.expr(t.e); this.b(LOCAL_TEE); uleb(this.code, l);
        this.f64(0); this.b(F64_LT);
        this.get(l); this.f64(t.lim); this.b(F64_GT, I32_OR);
        this.b(0x0d, 0);  // br_if 0
        this.get(0); this.get(l); this.b(...I32_TRUNC_SAT_F64_S); this.i32(t.stride); this.b(I32_MUL, I32_ADD);
        this.set(0);
        this.release(l);
      }
      for (const [w, e] of s.writes) {
        this.get(0); this.i32(3); this.b(I32_SHL);
        this.expr(e);
        this.b(F64_STORE, 3); uleb(this.code, (s.base + w) * 8);
      }
      this.b(0x0b);
      return;
    }
    this.i32(0);
    for (const t of s.terms) {
      this.expr(t.e); this.f64(0); this.b(F64_MAX); this.f64(t.lim); this.b(F64_MIN);
      this.b(...I32_TRUNC_SAT_F64_S); this.i32(t.stride); this.b(I32_MUL, I32_ADD);
    }
    this.set(0);
    for (const [w, e] of s.writes) {
      this.get(0); this.i32(3); this.b(I32_SHL);
      this.expr(e);
      this.b(F64_STORE, 3); uleb(this.code, (s.base + w) * 8);
    }
  }

  finish(): number[] {
    const out: number[] = [];
    const decls: number[] = [];
    uleb(decls, this.nf64 ? 2 : 1);
    uleb(decls, 1); decls.push(0x7f);                       // local 0: i32
    if (this.nf64) { uleb(decls, this.nf64); decls.push(0x7c); } // locals 1..: f64
    const body = [...decls, ...this.code, 0x0b];
    uleb(out, body.length);
    for (const x of body) out.push(x);
    return out;
  }

  get size() { return this.code.length; }
}

/**
 * Assembles functions (each a list of statement groups) into one module. Returns the module bytes;
 * function k is exported as `f${k}`.
 */
export function assemble(functions: Stmt[][], pages: number, const_base: (c: number) => number): Uint8Array {
  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  // Types: 0: () -> (), 1: (f64) -> f64, 2: (f64, f64) -> f64.
  section(out, 1, [3, 0x60, 0, 0, 0x60, 1, 0x7c, 1, 0x7c, 0x60, 2, 0x7c, 0x7c, 1, 0x7c]);
  const imports: number[] = [];
  uleb(imports, IMPORTS.length + 1);
  str(imports, 'env'); str(imports, 'mem'); imports.push(0x02, 0x00); uleb(imports, pages);
  for (const [name, arity] of IMPORTS) { str(imports, 'm'); str(imports, name); imports.push(0x00, arity); }
  section(out, 2, imports);
  const fsec: number[] = [];
  uleb(fsec, functions.length);
  for (let k = 0; k < functions.length; k++) fsec.push(0);
  section(out, 3, fsec);
  const exps: number[] = [];
  uleb(exps, functions.length);
  functions.forEach((_, k) => { str(exps, `f${k}`); exps.push(0x00); uleb(exps, IMPORTS.length + k); });
  section(out, 7, exps);
  const code: number[] = [];
  uleb(code, functions.length);
  for (const stmts of functions) {
    const b = new Body(const_base);
    for (const s of stmts) b.stmt(s);
    for (const x of b.finish()) code.push(x);
  }
  section(out, 10, code);
  return new Uint8Array(out);
}

/** Rough encoded size of a statement (for splitting functions). */
export function stmt_cost(s: Stmt): number {
  const ecost = (e: E): number => (e.t === 'op' ? 4 + e.a.reduce((acc, x) => acc + ecost(x), 0) : 8);
  return s.t === 'st' ? 8 + ecost(s.e) : s.terms.reduce((a, t) => a + 20 + ecost(t.e), 0) + s.writes.reduce((a, [, e]) => a + 10 + ecost(e), 0);
}

export function instantiate(bytes: Uint8Array, memory: WebAssembly.Memory): Record<string, () => void> {
  const m: Record<string, any> = {};
  for (const [name] of IMPORTS) m[name] = (Math as any)[name];
  const mod = new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>);
  return new WebAssembly.Instance(mod, { env: { mem: memory }, m }).exports as any;
}
