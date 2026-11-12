/** Port of `libs/composer/math.py` (subset). */
import * as jnp from '../jax/numpy';
import * as torch from '../torch';
import type { TensorLike } from '../torch/tensor';

export type ArrayLike = number | number[] | jnp.Array;

/** Linearly rescale x from [x1, x2, x3] to [y1, y2, y3]. */
export function rescale_linear3(
  x: jnp.Array,
  x1: TensorLike,
  x2: TensorLike,
  x3: TensorLike,
  y1: TensorLike,
  y2: TensorLike,
  y3: TensorLike,
  { clip = false }: { clip?: boolean } = {},
): jnp.Array {
  // `torch.*` keeps Python-float arithmetic (e.g. `y2 - y1` on scale constants) in float64.
  // Python writes `(x < x2) * (...)`, but XLA simplifies a bool-times-value product into
  // `select(mask, value, 0)`, so a masked-out branch that is inf/NaN (e.g. when x1 == x2) yields 0
  // rather than `0 * inf = NaN`. `jnp.where` reproduces JAX's actual results.
  const left = jnp.where(x.lt(x2), torch.add(y1, torch.mul(torch.sub(y2, y1), x.sub(x1)).div(torch.sub(x2, x1))), 0);
  const right = jnp.where(x.ge(x2), torch.add(y2, torch.mul(torch.sub(y3, y2), x.sub(x2)).div(torch.sub(x3, x2))), 0);
  let y = jnp.nan_to_num(left.add(right), { nan: y2, posinf: y2, neginf: y2 });  // Handle x1 == x2 or x2 == x3.
  if (clip) {
    y = jnp.clip(y, jnp.minimum(jnp.minimum(y1, y2), y3), jnp.maximum(jnp.maximum(y1, y2), y3));
  }
  return y;
}

/** Convert input to a tuple of floats. */
export function float_tuple(x: ArrayLike): number[] {
  if (typeof x === 'number') return [x];
  return Array.isArray(x) ? [...x] : x.tolist();
}

/** Convert input to a tuple of ints. */
export function int_tuple(x: ArrayLike): number[] {
  return float_tuple(x).map(Math.trunc);
}

/**
 * Convert a quaternion to [roll, pitch, yaw] angles, in ZYX-order so that drift in yaw (Z) does
 * not affect roll (X) and pitch (Y).
 */
export function quat_to_rpy(quat: jnp.Array): jnp.Array {
  const [w, x, y, z] = [0, 1, 2, 3].map(i => quat.index(i));
  const roll = jnp.arctan2(w.mul(x).add(y.mul(z)).mul(2.), jnp.asarray(1.).sub(x.mul(x).add(y.mul(y)).mul(2.)));
  const pitch = jnp.arcsin(w.mul(y).sub(z.mul(x)).mul(2.));
  const yaw = jnp.arctan2(w.mul(z).add(x.mul(y)).mul(2.), jnp.asarray(1.).sub(y.mul(y).add(z.mul(z)).mul(2.)));
  return jnp.concatenate([roll, pitch, yaw]);
}
