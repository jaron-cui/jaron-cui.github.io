/**
 * This module defines the `Simulator` class, which manages the computations of a neural circuit tree.
 *
 * NOTE: `generators.Generator` and `monitors.Monitor` are not ported; only `units.Unit` nodes are
 * initialized, reset, and updated.
 */
import * as torch from '../torch';
import * as config from './config';
import * as nodes from './nodes';
import * as units from './units';

function _simulator_init(node: nodes.ModuleNode, cfg: config.SimulatorConfig) {
  if (node instanceof units.Unit) {
    node.init(cfg);
  }
}

function _simulator_reset(node: nodes.ModuleNode, reset: torch.Tensor | null = null) {
  if (node instanceof units.Unit) {
    node.reset(reset);
  }
}

function _simulator_step(node: nodes.ModuleNode) {
  // Update values, no dependencies.
  if (node instanceof units.Unit) {
    node.step();
  }
}

function _simulator_populate(node: nodes.ModuleNode) {
  // Read values, via dependencies.
  if (node instanceof units.Unit) {
    node.populate();
  }
}

/**
 * The top-level node that manages the computations of a neural circuit tree. It recursively
 * initializes, resets, and updates nodes.
 */
export class Simulator extends nodes.ContainerNode {
  cfg: config.SimulatorConfig;
  /** Number of elapsed simulated steps. */
  steps: torch.nn.Buffer;
  /** Duration of elapsed simulated time (in miliseconds), which depends on `cfg.timestep`. */
  time: torch.nn.Buffer;

  constructor(kwargs: ConstructorParameters<typeof config.SimulatorConfig>[0] = {}) {
    super();
    this.cfg = new config.SimulatorConfig(kwargs);
    console.assert(this.cfg.timestep > 0);

    this.steps = new torch.nn.Buffer(torch.zeros(1, { dtype: 'int64' }), { persistent: false });
    this.time = new torch.nn.Buffer(torch.zeros(1), { persistent: false });
  }

  /** Initializes the simulator and resets it to its initial state. */
  override init() {
    nodes.visit(this, node => _simulator_init(node, this.cfg));
    this.reset();
  }

  /** Resets the simulator to its initial state. */
  override reset(reset: torch.Tensor | null = null) {
    nodes.visit(this, node => _simulator_reset(node, reset));
    this.steps.set_(reset === null ? 0 : reset.not().mul(this.steps));
    this.time.set_(reset === null ? 0 : reset.not().mul(this.time));
  }

  /** Advances the simulator to an updated state. */
  step() {
    // Some nodes may have dependencies on others, so we need to traverse in the right order.
    nodes.visit(this, _simulator_step);
    nodes.visit(this, _simulator_populate);
    this.steps.add_(1);
    this.time.add_(this.cfg.timestep);
  }
}
