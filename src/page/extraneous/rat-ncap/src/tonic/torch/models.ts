/**
 * Port of `libs3/tonic/tonic/torch/models` (`ActorOnly` and `DeterministicPolicyHead` subset).
 */
import * as torch from '../../torch';
import * as gymnasium from '../../gymnasium';

/** The interface `ActorOnly` requires of its actor (`tonic.torch.models.actors.ActorLike`). */
export interface ActorLike extends torch.nn.Module {
  initialize(
    observation_space: gymnasium.spaces.Dict,
    action_space: gymnasium.spaces.Dict,
    observation_normalizer?: null,
  ): void;
}

// ==================================================================================================
// actor_critics.py

/** Actor-only model for policy-only algorithms. */
export class ActorOnly<A extends ActorLike = ActorLike> extends torch.nn.Module {
  actor: A;
  observation_normalizer: null;
  on_initialize: ((model: ActorOnly<A>) => void) | null;

  constructor({
    actor,
    observation_normalizer = null,
    on_initialize = null,
  }: {
    actor: A,
    observation_normalizer?: null,  // Observation normalizers are not ported.
    on_initialize?: ((model: ActorOnly<A>) => void) | null,
  }) {
    super();
    this.actor = actor;
    this.observation_normalizer = observation_normalizer;
    this.on_initialize = on_initialize;
  }

  initialize(
    observation_space: gymnasium.spaces.Dict,
    action_space: gymnasium.spaces.Dict,
  ) {
    this.actor.initialize(
      observation_space,
      action_space,
      this.observation_normalizer,
    );
    if (this.on_initialize) {
      this.on_initialize(this);
    }
  }
}

// ==================================================================================================
// actors.py

/** Deterministic policy for DDPG-style algorithms. */
export class DeterministicPolicyHead extends torch.nn.Module {
  activation: () => torch.nn.Module;
  bias: boolean;
  init_fn: ((module: torch.nn.Module) => void) | null;
  action_space!: gymnasium.spaces.Box;
  action_layer!: torch.nn.Sequential;

  /**
   * Initialize the policy head.
   *
   * Args:
   *   activation: Activation function for the action layer (e.g., Tanh for bounded actions).
   *   bias: Whether to use bias in the linear layer.
   *   init_fn: Optional initialization function for the layer.
   */
  constructor({
    activation,
    bias = true,
    init_fn = null,
  }: {
    activation: () => torch.nn.Module,  // NOTE: Python defaults to `torch.nn.Tanh`, which is not ported.
    bias?: boolean,
    init_fn?: ((module: torch.nn.Module) => void) | null,
  }) {
    super();
    this.activation = activation;
    this.bias = bias;
    this.init_fn = init_fn;
  }

  /**
   * Initialize the action layer.
   *
   * Args:
   *   input_size: Input features dimension.
   *   action_space: `Box` action space (`Dict` action spaces are not ported).
   */
  initialize(input_size: number, action_space: gymnasium.spaces.Box) {
    this.action_space = action_space;
    const action_size = action_space.shape.reduce((a, b) => a * b, 1);
    this.action_layer = new torch.nn.Sequential(
      new torch.nn.Linear(input_size, action_size, { bias: this.bias }),
      this.activation(),
    );
    if (this.init_fn) {
      this.action_layer.apply(this.init_fn);
    }
  }

  /**
   * Compute deterministic action.
   *
   * Args:
   *   inputs: Input features [input_size].
   *
   * Returns:
   *   Actions tensor [action_size], reshaped to the action space's shape.
   */
  override forward(inputs: torch.Tensor): torch.Tensor {
    const actions = this.action_layer.forward(inputs);  // [action_size]
    // Reshape box actions.
    return unpack_tensors(this.action_space, actions);
  }
}

// ==================================================================================================
// space.py

/** `tonic.torch.space.unpack_tensors` for a `Box`: reshapes trailing dims to the space's shape. */
export function unpack_tensors(space: gymnasium.spaces.Box, value: torch.Tensor): torch.Tensor {
  return value.reshape(...value.shape.slice(0, value.shape.length - space.shape.length), ...space.shape);
}
