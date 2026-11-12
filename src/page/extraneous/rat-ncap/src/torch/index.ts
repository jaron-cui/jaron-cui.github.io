/**
 * A minimal, inference-only stand-in for the `torch` namespace. Function names and argument orders
 * follow PyTorch. Python keyword arguments are passed as a trailing object, e.g.
 * `torch.clamp(x, min=0, max=1)` -> `torch.clamp(x, {min: 0, max: 1})`.
 *
 * Python operators map to methods when the left operand is a tensor (`a + b` -> `a.add(b)`), and to
 * the functions below when it may be a scalar (`1 - z` -> `torch.sub(1, z)`). These functions
 * return a plain `number` when both operands are numbers, matching Python float arithmetic.
 */
import { DType, Scalar, Tensor, TensorLike, alloc, as_tensor_like, cat, elementwise, matmul } from './tensor';
import * as F from './functional';
import * as nn from './nn';

export { Tensor, cat, matmul, nn, F as functional };
export type { DType, Scalar, TensorLike };
export const concat = cat;

// ==================================================================================================
// Construction.

type NestedNumbers = number | boolean | NestedNumbers[];

function flatten(value: NestedNumbers): { data: number[], shape: number[] } {
  if (!Array.isArray(value)) return { data: [Number(value)], shape: [] };
  if (value.length === 0) return { data: [], shape: [0] };
  const parts = value.map(flatten);
  return { data: parts.flatMap(p => p.data), shape: [value.length, ...parts[0].shape] };
}

/** `torch.tensor(data)`: copies `data`; numbers default to float32, booleans to bool. */
export function tensor(value: NestedNumbers | Tensor, { dtype }: { dtype?: DType } = {}): Tensor {
  if (value instanceof Tensor) return value.clone().to(dtype ?? value.dtype);
  const { data, shape } = flatten(value);
  let first: NestedNumbers = value;
  while (Array.isArray(first)) first = first[0];
  const resolved = dtype ?? (typeof first === 'boolean' ? 'bool' : 'float32');
  const out = alloc(resolved, data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i];
  return new Tensor(out, shape, resolved);
}

/** `torch.as_tensor(data)`: returns `data` itself when it is already a tensor of `dtype`. */
export function as_tensor(value: NestedNumbers | Tensor, { dtype }: { dtype?: DType } = {}): Tensor {
  if (value instanceof Tensor) return dtype === undefined ? value : value.to(dtype);
  return tensor(value, { dtype });
}

function shape_of(size: (number | number[])[]): number[] {
  return size.length === 1 && Array.isArray(size[0]) ? size[0] : size as number[];
}

export function full(size: number[], fill_value: number, { dtype = 'float32' }: { dtype?: DType } = {}): Tensor {
  const out = new Tensor(alloc(dtype, size.reduce((a, b) => a * b, 1)), [...size], dtype);
  return out.fill_(fill_value);
}

/** `torch.zeros(*size, dtype=...)`, e.g. `torch.zeros(1)` or `torch.zeros([2, 3], {dtype})`. */
export function zeros(...args: (number | number[] | { dtype?: DType })[]): Tensor {
  const { size, kwargs } = split_size_args(args);
  return full(size, 0, kwargs);
}

export function ones(...args: (number | number[] | { dtype?: DType })[]): Tensor {
  const { size, kwargs } = split_size_args(args);
  return full(size, 1, kwargs);
}

function split_size_args(args: (number | number[] | { dtype?: DType })[]) {
  const last = args.at(-1);
  const has_kwargs = last !== undefined && typeof last === 'object' && !Array.isArray(last);
  const kwargs = (has_kwargs ? last : {}) as { dtype?: DType };
  const size = shape_of((has_kwargs ? args.slice(0, -1) : args) as (number | number[])[]);
  return { size, kwargs };
}

export function zeros_like(input: Tensor): Tensor { return full(input.shape, 0, { dtype: input.dtype }); }
export function ones_like(input: Tensor): Tensor { return full(input.shape, 1, { dtype: input.dtype }); }

// ==================================================================================================
// Arithmetic with possibly-scalar left operands.

export function add(a: number, b: number): number;
export function add(a: TensorLike, b: TensorLike): Tensor;
export function add(a: TensorLike, b: TensorLike): Tensor | number {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  return a instanceof Tensor ? a.add(b) : as_operand(a, b).add(b);
}

export function sub(a: number, b: number): number;
export function sub(a: TensorLike, b: TensorLike): Tensor;
export function sub(a: TensorLike, b: TensorLike): Tensor | number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return a instanceof Tensor ? a.sub(b) : as_operand(a, b).sub(b);
}

export function mul(a: number, b: number): number;
export function mul(a: TensorLike, b: TensorLike): Tensor;
export function mul(a: TensorLike, b: TensorLike): Tensor | number {
  if (typeof a === 'number' && typeof b === 'number') return a * b;
  return a instanceof Tensor ? a.mul(b) : as_operand(a, b).mul(b);
}

export function div(a: number, b: number): number;
export function div(a: TensorLike, b: TensorLike): Tensor;
export function div(a: TensorLike, b: TensorLike): Tensor | number {
  if (typeof a === 'number' && typeof b === 'number') return a / b;
  return a instanceof Tensor ? a.div(b) : as_operand(a, b).div(b);
}

/** Wraps scalar `a` as a 0-dim tensor in the dtype it takes when combined with tensor `b`. */
function as_operand(a: Scalar, b: TensorLike): Tensor {
  const float = (b instanceof Tensor && b.dtype === 'float32') || !Number.isInteger(Number(a));
  return as_tensor_like(a, float ? 'float32' : 'int64');
}

// ==================================================================================================
// Element-wise functions.

export const relu = F.relu;

/** `torch.clamp(input, min, max)` or `torch.clamp(input, {min, max})`. */
export function clamp(
  input: Tensor,
  min?: TensorLike | null | { min?: TensorLike | null, max?: TensorLike | null },
  max?: TensorLike | null,
): Tensor {
  if (min !== null && typeof min === 'object' && !(min instanceof Tensor)) {
    return F.clamp(input, min.min ?? null, min.max ?? null);
  }
  return F.clamp(input, min ?? null, max ?? null);
}
export const clip = clamp;

export function exp(input: Tensor): Tensor { return elementwise([input], 'float32', Math.exp); }
export function log(input: Tensor): Tensor { return elementwise([input], 'float32', Math.log); }
export function tanh(input: Tensor): Tensor { return elementwise([input], 'float32', Math.tanh); }
export function sigmoid(input: Tensor): Tensor {
  return elementwise([input], 'float32', x => 1 / (1 + Math.exp(-x)));
}
export function sign(input: Tensor): Tensor {
  return elementwise([input], input.dtype === 'bool' ? 'int64' : input.dtype, x => x > 0 ? 1 : x < 0 ? -1 : 0);
}

export function where(condition: Tensor, input: TensorLike, other: TensorLike): Tensor {
  const dtype = input instanceof Tensor ? input.dtype : other instanceof Tensor ? other.dtype : 'float32';
  return elementwise([condition, input, other], dtype, (c, a, b) => c ? a : b);
}

export function maximum(input: Tensor, other: Tensor): Tensor {
  return elementwise([input, other], input.dtype, (a, b) => Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.max(a, b));
}

export function minimum(input: Tensor, other: Tensor): Tensor {
  return elementwise([input, other], input.dtype, (a, b) => Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.min(a, b));
}

// ==================================================================================================
// Random numbers. These cannot reproduce PyTorch's random streams, only their distributions.

let rng_state = 0x9e3779b9;

/** `torch.manual_seed(seed)`: seeds the (non-PyTorch-compatible) global generator. */
export function manual_seed(seed: number) {
  rng_state = seed >>> 0;
}

function uniform(): number {
  // Mulberry32.
  rng_state = (rng_state + 0x6d2b79f5) >>> 0;
  let t = rng_state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function normal(): number {
  // Box-Muller.
  const u = 1 - uniform();
  const v = uniform();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randn(...size: (number | number[])[]): Tensor {
  const out = zeros(...size);
  for (let i = 0; i < out.data.length; i++) out.data[i] = normal();
  return out;
}

export function randn_like(input: Tensor): Tensor {
  return randn(input.shape);
}
