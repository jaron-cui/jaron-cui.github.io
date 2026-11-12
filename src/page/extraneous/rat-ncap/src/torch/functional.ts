/**
 * Element-wise and reduction functions shared by `torch` and `torch.nn` (`torch.nn.functional`).
 */
import { Tensor, TensorLike, elementwise } from './tensor';

export function relu(input: Tensor): Tensor {
  return elementwise([input], input.dtype, x => x > 0 ? x : 0);
}

export function hardtanh(input: Tensor, min_val: number = -1.0, max_val: number = 1.0): Tensor {
  return clamp(input, Math.fround(min_val), Math.fround(max_val));
}

/** `torch.clamp(input, min, max)`, where a NaN input stays NaN and `min > max` yields `max`. */
export function clamp(
  input: Tensor,
  min: TensorLike | null = null,
  max: TensorLike | null = null,
): Tensor {
  let out = input;
  if (min !== null) out = elementwise([out, min], out.dtype, (x, lo) => Number.isNaN(x) ? x : Math.max(x, lo));
  if (max !== null) out = elementwise([out, max], out.dtype, (x, hi) => Number.isNaN(x) ? x : Math.min(x, hi));
  return out;
}
