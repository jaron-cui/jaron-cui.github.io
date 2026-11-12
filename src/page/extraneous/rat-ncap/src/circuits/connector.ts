/**
 * This module defines `Connector` classes, which model synapses and connectivity motifs.
 */
import * as torch from '../torch';
import * as collections from '../utils/collections';
import * as buffers from '../utils/torch/buffers';
import * as signal from './signal';

export interface Connection {
  source: signal.Signal;
  attr: string;
  weight: number | torch.nn.Parameter;
  delay: buffers.DelayBuffer;
  noise: number;
  meta: collections.AttrDict;
}

export interface ConnectKwargs {
  attr?: string;
  weight?: number | torch.nn.Parameter;
  delay?: number;
  noise?: number;
  name?: string | null;
  [key: string]: unknown;
}

/**
 * A data structure that connects to `Signal` nodes and integrates their current values into
 * an output. It can be viewed as a general way to model synapses and connectivity motifs.
 *
 * The current implementation models a chemical synapse through a simple weighted sum of connected
 * signals with optional noise and delay. A future implementation may support electrical synapses
 * and more complex connectivity patterns (e.g. topographical, probabilistic, multicompartmental).
 *
 * As this class is not a node in the circuit tree, any `torch.Tensor`/`torch.nn.Parameter` (e.g.
 * connection weights) should be managed externally and attached to a `torch.nn.Module`.
 */
export class Connector {
  connections = new Map<string, Connection>();
  parent: torch.nn.Module;

  constructor(parent: torch.nn.Module) {
    this.parent = parent;
  }

  /**
   * Connects a signal source to the connector with a given weight, delay, and/or noise.
   *
   * Args:
   *   source: Source signal node.
   *   attr: Attribute of the source signal to connect. Default: 'value'.
   *   weight: Synaptic weight, whcih can be a scalar or a tensor of the same shape as the
   *     source signal.
   *   delay: Delay of the connection (in timesteps).
   *   noise: Gaussian noise standard deviation of the synaptic weight, mean 1.
   *   name: Name of the connection.
   *   **kwargs: Metadata to associate with the connection.
   */
  connect(
    source: signal.Signal,
    { attr = 'value', weight = 1., delay = 1, noise = 0., name = null, ...kwargs }: ConnectKwargs = {},
  ) {
    if (!(0 <= noise && noise <= 1)) throw new Error(`Expected 0 <= \`noise\` <= 1`);
    if (!(delay >= 1)) throw new Error(`Expected \`delay\` >= 1`);
    const x = getattr<torch.Tensor>(source, attr);
    const connection: Connection = {
      source: source,
      attr: attr,
      weight: weight,
      delay: new buffers.DelayBuffer(x.shape, delay),
      noise: noise,
      meta: { ...kwargs },
    };
    name = name ?? String(this.connections.size);
    // In functional mode, torch replaces parameters and buffers registered to any `torch.nn.Module`
    // but not non-`Module` data structures like this `Connector`. Therefore, we must register these
    // to the parent `Module` and must retrieve them on usage.
    if (weight instanceof torch.Tensor) {
      this.parent.register_parameter(`weight_${name}`, weight);
    }
    this.parent.register_buffer(`buffer_${name}`, connection.delay.timesteps, false);
    this.connections.set(name, connection);
    return this;
  }

  get length(): number {
    return this.connections.size;
  }

  /** Resets the connections to zeros. */
  reset(reset: torch.Tensor | null = null) {
    for (const c of this.connections.values()) {
      c.delay.fill(reset === null ? 0 : reset.not().mul(c.delay.timesteps));
    }
  }

  /** Integrates the current values of all connected signals. */
  integrate(): torch.Tensor {
    let total = torch.zeros(1);
    for (const [name, c] of this.connections) {
      c.delay.timesteps = getattr<torch.Tensor>(this.parent, `buffer_${name}`);
      total = total.add(c.delay.get());
    }
    return total;
  }

  /** Populates the connector with current values of all connected signals. */
  populate() {
    for (const [name, c] of this.connections) {
      let x = getattr<torch.Tensor>(c.source, c.attr);
      let w = getattr<torch.Tensor | number>(this.parent, `weight_${name}`, c.weight);
      c.delay.timesteps = getattr<torch.Tensor>(this.parent, `buffer_${name}`);
      if (c.noise) {
        w = torch.add(w, torch.randn(w instanceof torch.Tensor ? w.shape : []).mul(c.noise));
      }
      x = torch.mul(w, x);
      c.delay.step(x);
    }
  }
}

/** Python `getattr(obj, name[, default])`. */
function getattr<T>(obj: object, name: string, default_?: T): T {
  if (name in obj) return (obj as Record<string, T>)[name];
  if (default_ !== undefined) return default_;
  throw new Error(`AttributeError: '${obj.constructor.name}' object has no attribute '${name}'`);
}
