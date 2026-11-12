/**
 * Maps Hydra `_target_` Python paths to their TypeScript ports, for `hydra.instantiate`.
 */
import { Registry, Target, cls } from './hydra';
import * as torch from './torch';
import * as collections from './utils/collections';
import * as experimental from './models/experimental';
import * as ncap from './models/ncap';
import * as cxe from './composer/mjx_env';
import * as cxt from './composer/transforms';
import { Floor } from './envs/arenas/floor';
import { Rat, rat_actuators_pos_mid } from './envs/bodies/rat/rat';
import { InteractiveLocomotion } from './envs/tasks/interactive_locomotion';

/**
 * Training-only targets. Their effects (initial values, constraint bounds) are superseded by the
 * checkpoint's `state_dict`, so at inference they are explicit no-ops.
 */
const TRAINING_ONLY = {
  /** `utils.torch.block.block_initializer(...)` returns an `on_initialize(module)` callback. */
  block_initializer: () => (module: unknown) => {},
  /** `models.constrain(param, ...)` sets parameter constraint bounds in place. */
  constrain: () => {},
};

export const REGISTRY: Registry = new Map<string, Target>([
  // Models.
  ['models.ncap_es', ncap.ncap_es],
  ['models.AfferentFeedbackNetwork', cls(ncap.AfferentFeedbackNetwork)],
  ['models.BrainstemCommandNetwork', cls(ncap.BrainstemCommandNetwork)],
  ['models.Constrainer', cls(ncap.Constrainer)],
  ['models.ObservationRectifier', cls(ncap.ObservationRectifier)],
  ['models.PatternFormationNetwork', cls(ncap.PatternFormationNetwork)],
  ['models.init_bc_fixed', ncap.init_bc_fixed],
  ['models.init_zeros', ncap.init_zeros],
  ['models.experimental.RhythmGenerationCircuit2', cls(experimental.RhythmGenerationCircuit2)],
  ['models.init_rg_rat6', ncap.init_rg_rat6],
  // Activations.
  ['torch.nn.Hardtanh', cls(torch.nn.Hardtanh)],
  ['torch.nn.Identity', cls(torch.nn.Identity)],
  ['torch.nn.ReLU', cls(torch.nn.ReLU)],
  // Utilities.
  ['utils.collections.GlobDict', (kwargs: Record<string, unknown>) => new collections.GlobDict(kwargs)],
  // Environments.
  ['composer.MjxEnv', cls(cxe.MjxEnv)],
  ['composer.transforms.SpringMuscleController', cls(cxt.SpringMuscleController)],
  ['envs.arenas.Floor', cls(Floor)],
  ['envs.bodies.Rat', cls(Rat)],
  ['envs.bodies.rat_actuators_pos_mid', rat_actuators_pos_mid],
  ['web.envs.tasks.InteractiveLocomotion', cls(InteractiveLocomotion)],
  // Training-only.
  ['utils.torch.block.block_initializer', TRAINING_ONLY.block_initializer],
  ['models.constrain', TRAINING_ONLY.constrain],
]);
