/** Port of `libs/utils/torch/buffers.py`. */
import * as torch from '../../torch';

/** A buffer that stores tensors for a fixed number of timesteps. */
export class DelayBuffer {
  delay: number;
  shape: number[];
  timesteps: torch.Tensor;

  constructor(shape: number[], delay: number = 1) {
    if (!(delay >= 1)) throw new Error(`Expected delay >= 1`);
    this.delay = delay;
    this.shape = shape;
    this.timesteps = torch.zeros([delay, ...shape]);
  }

  clear() {
    this.timesteps.set_(0.);
  }

  fill(value: torch.TensorLike = 0.) {
    this.timesteps.set_(value);
  }

  step(elem: torch.TensorLike = 0.) {
    // Use cat rather than roll to avoid in-place operation.
    elem = torch.as_tensor(elem as torch.Tensor | number, { dtype: this.timesteps.dtype });
    this.timesteps.set_(torch.cat([elem.unsqueeze(0), this.timesteps.slice(null, -1)]));
  }

  get(t: number = -1): torch.Tensor {
    console.assert(-this.delay <= t && t <= -1, `Expected -${this.delay} <= t <= -1, got t=${t}`);
    return this.timesteps.index(t);
  }

  get length(): number {
    return this.timesteps.shape[0];
  }
}
