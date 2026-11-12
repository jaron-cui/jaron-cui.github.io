/**
 * This defines the `Signal` class, which is a primitive node that represents a tensor-valued
 * signal.
 */
import * as torch from '../torch';
import * as nodes from './nodes';

/**
 * A primitive node that represents a tensor-valued signal. It can be connected to other nodes
 * that consume signals through the common `value` attribute. Many nodes subclass this and implement
 * distinct internal logic, but it is useful to directly instantiate this class for input from code
 * external to the circuits library (e.g. writing environment observations).
 *
 * Attributes:
 *   value: Current tensor value of the signal.
 */
export class Signal extends nodes.PrimitiveNode {
  /** Current tensor value of the signal. */
  value: torch.nn.Buffer;

  constructor({ value = 0., ...kwargs }: { value?: torch.Tensor | number, [key: string]: unknown } = {}) {
    super(kwargs);
    // Allows pointer to the same tensor.
    let tensor = torch.as_tensor(value, { dtype: 'float32' });
    if (tensor.ndim === 0) tensor = tensor.unsqueeze(0);
    this.value = new torch.nn.Buffer(tensor, { persistent: false });
  }
}
