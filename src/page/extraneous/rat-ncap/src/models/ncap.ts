/**
 * Port of `projects/rodent/models/ncap.py`.
 *
 * This file defines the modular Quadruped NCAP architecture based on neural circuits in the limbs
 * and spinal cord of quadruped mammals. The architecture is composed of:
 *
 * - 1 x **Rhythm Generation** (RG) module that coordinates gait between limbs.
 * - 4 x **Pattern Formation** (PF) modules that generate joint activation patterns within each limb.
 * - 4 x **Afferent Feedback** (AF) modules that provide sensory feedback from each limb.
 * - 1 x **Brainstem Command** (BC) module that controls speed and gait.
 *
 * Ported so far: everything used by `1_prod/1_4_flxext`'s actor (`ncap_es`). Not ported:
 * `ncap_esrl`, `BrainstemCommandSignal`, RG variants and initializers other than
 * `RhythmGenerationCircuit2`/`init_rg_rat6`, and `load_checkpoint`.
 */
import * as torch from '../torch';
import * as cc from '../circuits';
import * as gymnasium from '../gymnasium';
import * as cxg from '../composer/utils/gym';
import * as ttm from '../tonic/torch/models';
import * as utt from '../utils/torch';
import * as utb from '../utils/torch/block';
import * as uts from '../utils/string';
import * as functools from '../utils/functools';
import * as collections from '../utils/collections';
import { bool, zip } from '../utils/builtins';
import type { RhythmGenerationCircuit2 } from './experimental';

type MappingLike<V> = collections.Mapping<V> | Record<string, V>;
type ModuleFactory = () => torch.nn.Module;
type BlockInitializer = (module: utb.BlockModule) => void;
type Observation = collections.Mapping<torch.Tensor>;

/** The RG circuit interface used by the actor (`RhythmGenerationCircuit` in Python). */
export type RhythmGenerationCircuit = RhythmGenerationCircuit2;

export interface NcapEsKwargs {
  pattern_formation: PatternFormationNetwork;
  afferent_feedback: AfferentFeedbackNetwork;
  rhythm_generation?: RhythmGenerationCircuit | null;
  brainstem_command?: BrainstemCommandNetwork | null;
  observation_rectifier?: ObservationRectifier | null;
  constrainer?: Constrainer | null;
  on_initialize?: ((model: ttm.ActorOnly<QuadrupedModularActor>) => void) | null;
  timestep?: number;
}

/** ES algorithm, Quadruped NCAP architecture. */
export function ncap_es({
  pattern_formation,
  afferent_feedback,
  rhythm_generation = null,
  brainstem_command = null,
  observation_rectifier = null,
  constrainer = null,
  on_initialize = null,
  timestep = 30.,
}: NcapEsKwargs): ttm.ActorOnly<QuadrupedModularActor> {
  const actor = new QuadrupedModularActor({
    pattern_formation: pattern_formation,
    afferent_feedback: afferent_feedback,
    rhythm_generation: rhythm_generation,
    brainstem_command: brainstem_command,
    observation_rectifier: observation_rectifier,
    constrainer: constrainer,
    timestep: timestep,
  });
  return new ttm.ActorOnly({ actor: actor, on_initialize: on_initialize });
}


// ==================================================================================================
// QuadrupedModularActor

/**
 * This top-level module coordinates the interactions between the RG, PF, AF, and BC modules.
 * Due to the highly modular structure, different combinations of modules can be included to test
 * architectural variants.
 */
export class QuadrupedModularActor extends torch.nn.Module implements ttm.ActorLike {
  pattern_formation: PatternFormationNetwork;
  afferent_feedback: AfferentFeedbackNetwork;
  sim: cc.Simulator | null;
  brainstem_command: BrainstemCommandNetwork | null;
  observation_rectifier: ObservationRectifier | null;
  constrainer: Constrainer | null;
  action_space!: gymnasium.spaces.Dict;
  rg_observer!: RhythmGenerationCircuitObserver;

  constructor({
    pattern_formation,
    afferent_feedback,
    rhythm_generation = null,
    brainstem_command = null,
    observation_rectifier = null,
    constrainer = null,
    timestep = 30.,  // Match to task.control_timestep = 0.03s = 30ms.
  }: Omit<NcapEsKwargs, 'on_initialize'>) {
    super();

    this.pattern_formation = pattern_formation;

    console.assert(afferent_feedback === null || rhythm_generation !== null);
    this.afferent_feedback = afferent_feedback;

    if (rhythm_generation !== null) {
      this.sim = new cc.Simulator({ timestep: timestep });
      this.sim.rhythm_generation = rhythm_generation;
    } else {
      this.sim = null;
    }

    console.assert(brainstem_command === null || rhythm_generation !== null);
    this.brainstem_command = brainstem_command;

    this.observation_rectifier = observation_rectifier;
    this.constrainer = constrainer;
  }

  initialize(
    observation_space: gymnasium.spaces.Dict,
    action_space: gymnasium.spaces.Dict,
    observation_normalizer: null = null,
  ) {
    if (observation_normalizer !== null) {
      throw new Error('NotImplementedError');
    }
    this.action_space = action_space;

    if (this.observation_rectifier !== null) {
      observation_space = this.observation_rectifier.initialize(observation_space);
    }

    if (this.sim !== null) {
      this.sim.init();
      this.rg_observer = new RhythmGenerationCircuitObserver();
      observation_space = this.rg_observer.initialize(
        this.sim.rhythm_generation as RhythmGenerationCircuit,
        observation_space,
      );

      if (this.afferent_feedback !== null) {
        const afferent_feedback_action_space = new gymnasium.spaces.Dict(new collections.Dict(
          ['flx', 'ext'].flatMap(prefix =>
            ['limbFL', 'limbFR', 'limbHL', 'limbHR'].map(segment => [
              `${prefix}_${segment}`,
              new cxg.Box({
                low: 0.0,
                high: 1.0,
                shape: [1],
              }),
            ] as [string, gymnasium.spaces.Space])),
        ));
        this.afferent_feedback.initialize(observation_space, afferent_feedback_action_space);
      }
      if (this.brainstem_command !== null) {
        this.brainstem_command.initialize(observation_space, 4);  // [freq_L, sync_L, freq_R, sync_R]
      }
    }
    this.pattern_formation.initialize(observation_space, action_space);

    if (this.constrainer) {
      this.constrainer.initialize(this.named_parameters());
      this.constrainer.constrain();
    }
  }

  reset(reset: torch.Tensor | null = null) {
    if (this.sim !== null) {
      this.sim.reset(reset);
      const rg = this.sim.rhythm_generation as RhythmGenerationCircuit;
      rg.reset(reset);
    }
  }

  /**
   * Args:
   *   observation: Dict observation with tensor values (observation_size).
   * Returns:
   *   action: Dict actions with tensor value (action_size).
   */
  override forward(observation: Observation): collections.OrderedDict<torch.Tensor> {
    if (this.observation_rectifier !== null) {
      observation = this.observation_rectifier.forward(observation);
    }

    let nonreset_af: Observation;
    let reset_af: Observation | null;
    [nonreset_af, reset_af] = this.afferent_feedback.forward(observation);

    if (this.sim !== null) {
      const rg = this.sim.rhythm_generation as RhythmGenerationCircuit;
      if (reset_af !== null) {
        // Write afferent signals into sim.
        for (const limb of ['FL', 'FR', 'HL', 'HR']) {
          const flx = reset_af.getitem(`flx_limb${limb}`);
          const ext = reset_af.getitem(`ext_limb${limb}`);
          (rg[`aff_flx_${limb}`] as cc.Signal).value.set_(flx);
          (rg[`aff_ext_${limb}`] as cc.Signal).value.set_(ext);
        }
      }
      if (this.brainstem_command !== null) {
        // Write command signals into sim, shape [4].
        const commands = this.brainstem_command.forward(observation);
        rg.freq_L.value.set_(commands.index(0));
        rg.sync_L.value.set_(commands.index(1));
        rg.freq_R.value.set_(commands.index(2));
        rg.sync_R.value.set_(commands.index(3));
        (observation as collections.Dict<torch.Tensor>).setitem('bc', commands);
      }

      // Any signals written on this timestep will be incorporated at the next timestep.
      this.sim.step();
      nonreset_af = this.rg_observer.insert(rg.get_output(), nonreset_af);
    }

    const outputs = this.pattern_formation.forward(nonreset_af);
    return new collections.OrderedDict(this.action_space.keys().map(k => [k, outputs.getitem(k)]));
  }
}

// ==================================================================================================
// PatternFormationNetwork

export interface PatternFormationNetworkKwargs {
  observation_segments: string[];
  action_segments: string[];

  observation_prefixes: string[];
  action_prefixes: string[];
  observation_segments_override?: MappingLike<string[]> | null;

  lateral_segments?: MappingLike<[string, string]> | null;
  sagittal_segments?: MappingLike<string> | null;
  transverse_segments?: MappingLike<string> | null;

  observation_prefix_shorthand?: MappingLike<string> | null;
  action_prefix_shorthand?: MappingLike<string> | null;

  action_prefix_symmetry_mapping?: MappingLike<string> | null;
  action_symmetry_mapping?: MappingLike<string> | null;

  synergies?: number | null;
  action_synergies?: MappingLike<string[]> | null;

  select_weight_id_override?: MappingLike<string | 0> | null;
  synergy_weight_id_override?: MappingLike<string | 0> | null;

  select_activation?: ModuleFactory | null;
  synergy_activation?: ModuleFactory | null;

  on_initialize_select?: BlockInitializer | null;
  on_initialize_synergy?: BlockInitializer | null;
}

/**
 * Converts observations into actions.
 *
 * There are three sequential modules:
 * 1. Scale: `scale -> activation ->`
 * 2. Select: `select -> activation ->`
 * 3. Synergy: `synergy -> activation ->`
 *
 * Scale and Synergy are optional. `scale` is a scalar weight and bias applied to each
 * observation. `select` is a linear layer that maps observations to actions, or synergy activations
 * if synergies are enabled. `synergy` is a linear layer that maps synergy activations to actions.
 */
export class PatternFormationNetwork extends torch.nn.Module {
  observation_keys: string[];
  action_keys: string[];
  synergies: number | null;
  select_layer: utb.BlockLinear;
  select_activation: DictModule | null;
  synergy_layer!: utb.SparseBlockLinear;
  synergy_activation: DictModule | null;

  /**
   * Args:
   *   observation_segments: Body segments with which observations may be associated,
   *     e.g. `['limbFL', 'limbFR', 'limbHL', 'limbHR', 'lumbarE', 'lumbarBT[<-]', 'lumbarBT[->]']`.
   *   action_segments: Body segments with which actions may be associated,
   *     e.g. `['limbFL', 'limbFR', 'limbHL', 'limbHR', 'lumbarE', 'lumbarBT']`.
   *
   *   observation_prefixes: List of observation prefixes, e.g. `['rg', 'body/proprio_pos']`.
   *   action_prefixes: List of action prefixes, e.g. `['body/muscle_flx', 'body/muscle_ext']`.
   *   observation_segments_override: Override the segments used for specific observation prefixes,
   *     e.g. `{'rg': ['limbFL', 'limbFR', 'limbHL', 'limbHR']}`,
   *     instead of using `observation_segments`.
   *
   *   lateral_segments: Mapping from contralateral symmetry group to the left and right segments,
   *     e.g. {F: ['limbFL', 'limbFR']}.
   *   sagittal_segments: Mapping from sagittal symmetry group to the segment,
   *     e.g. {Le: 'lumbarE'}.
   *   transverse_segments: Mapping from transverse symmetry group to the segment,
   *     e.g. {Lbt: 'lumbarBT'}.
   *
   *   observation_prefix_shorthand: Mapping from observation prefix to shorthand,
   *     e.g. `{'rg': 'rg', 'body/proprio_pos': 'pos'}`.
   *   action_prefix_shorthand: Mapping from action prefix to shorthand,
   *     e.g. `{'body/muscle_flx': 'flx'}`.
   *
   *   action_prefix_symmetry_mapping: Mapping from action prefix to symmetry group,
   *     e.g. `{'body/muscle_flx': 'flx'}`.
   *   action_symmetry_mapping: Mapping from action key to symmetry group,
   *     e.g. `{'body/muscle_flx_FL': 'flx_F'}`.
   *
   *   synergies: Number of synergies to use in the synergy layer. If None, no synergy layer is used.
   *   action_synergies: Mapping from action segment to the synergy segments that contribute to it.
   *
   *   select_weight_id_override: Mapping from select weight ID to override weight ID.
   *   synergy_weight_id_override: Mapping from synergy weight ID to override weight ID.
   *
   *   select_activation: Activation function for the select layer.
   *   synergy_activation: Activation function for the synergy layer.
   *
   *   on_initialize_select: Initializer for the select layer weights and biases.
   *   on_initialize_synergy: Initializer for the synergy layer weights and biases.
   */
  constructor({
    observation_segments,
    action_segments,

    observation_prefixes,
    action_prefixes,
    observation_segments_override = null,

    lateral_segments = null,
    sagittal_segments = null,
    transverse_segments = null,

    observation_prefix_shorthand = null,
    action_prefix_shorthand = null,

    action_prefix_symmetry_mapping = null,
    action_symmetry_mapping = null,

    synergies = null,
    action_synergies = null,

    select_weight_id_override = null,
    synergy_weight_id_override = null,

    select_activation = null,
    synergy_activation = () => new torch.nn.ReLU(),

    on_initialize_select = null,
    on_initialize_synergy = null,
  }: PatternFormationNetworkKwargs) {
    super();
    console.assert(observation_segments.length === new Set(observation_segments).size);
    console.assert(action_segments.length === new Set(action_segments).size);
    console.assert(observation_prefixes.length === new Set(observation_prefixes).size);
    console.assert(action_prefixes.length === new Set(action_prefixes).size);
    const segments = new Set([...observation_segments, ...action_segments]);
    const action_synergies_ = action_synergies && collections.dict(action_synergies);
    const lateral_segments_ = collections.dict(lateral_segments ?? {});
    const sagittal_segments_ = collections.dict(sagittal_segments ?? {});
    const transverse_segments_ = collections.dict(transverse_segments ?? {});

    console.assert(synergies === null || synergies > 0);
    console.assert(bool(synergies) || !bool(synergy_weight_id_override && collections.dict(synergy_weight_id_override)));
    console.assert(bool(synergies) || !bool(on_initialize_synergy));
    console.assert(bool(synergies) || !bool(synergy_activation));
    console.assert((!bool(synergies) && !bool(action_synergies_)) || (bool(synergies) && bool(action_synergies_)));
    console.assert(!bool(action_synergies_) || action_segments.every(segment => action_synergies_!.has(segment)));
    console.assert(!bool(action_synergies_) || action_synergies_!.values().every(
      synergy_segments => synergy_segments.every(segment => segments.has(segment)),
    ));
    console.assert(lateral_segments_.values().every(pair => pair.every(segment => segments.has(segment))));
    console.assert(sagittal_segments_.values().every(segment => segments.has(segment)));
    console.assert(transverse_segments_.values().every(segment => segments.has(segment)));

    const observation_prefix_shorthand_ = collections.dict(observation_prefix_shorthand ?? {});
    const action_prefix_shorthand_ = collections.dict(action_prefix_shorthand ?? {});
    const action_prefix_symmetry_mapping_ = collections.dict(action_prefix_symmetry_mapping ?? {});
    const action_symmetry_mapping_ = collections.dict(action_symmetry_mapping ?? {});
    const observation_segments_override_ = collections.dict(observation_segments_override ?? {});
    const select_weight_id_override_ = collections.dict(select_weight_id_override ?? {});
    const synergy_weight_id_override_ = collections.dict(synergy_weight_id_override ?? {});

    // Observation and action keys are expected to have the format f'{prefix}_{segment}',
    // e.g. body/proprio_pos_FL and body/muscle_flx_FL.
    // We enumerate all prefix and segment combinations to get concrete keys.
    this.observation_keys = observation_prefixes.flatMap(prefix =>
      observation_segments_override_.get(prefix, observation_segments).map(suffix => `${prefix}_${suffix}`));
    this.action_keys = action_prefixes.flatMap(prefix => action_segments.map(suffix => `${prefix}_${suffix}`));
    this.synergies = synergies;

    // Prevent bugs where the user thinks they have overridden something they have not.
    function assert_matches(name: string, default_: string[], override: Iterable<string>) {
      const unmatched = [...override].filter(o => !default_.includes(o));
      console.assert(
        !unmatched.length,
        `Overrides provided for ${name}: ${unmatched} do not correspond to anything: ${default_}.`,
      );
    }
    assert_matches('observation prefixes', observation_prefixes, observation_prefix_shorthand_);
    assert_matches('action prefixes', action_prefixes, action_prefix_shorthand_);
    assert_matches('action prefixes', action_prefixes, action_prefix_symmetry_mapping_);
    assert_matches('action keys', this.action_keys, action_symmetry_mapping_);
    assert_matches('observation prefixes', observation_prefixes, observation_segments_override_);

    const bodyplan = new BodyPlan(lateral_segments_, sagittal_segments_, transverse_segments_);

    // Define shared weights for actions.
    // Preferentially use full action_symmetry_mapping over individual prefix/suffix mappings.
    // Action weight IDs do not allow prefix symmetry because then different action prefixes would
    // be fully redundant. Same input, same weight, and same bias.
    const action_bias_ids = action_prefixes.flatMap(prefix => action_segments.map(segment =>
      action_symmetry_mapping_.get(
        `${prefix}_${segment}`,
        (
          `${action_prefix_symmetry_mapping_.get(prefix, action_prefix_shorthand_.get(prefix, prefix))}_` +
          `${bodyplan.classify_segment(segment)[0]}`
        ),
      )));
    // Shorten `action_prefixes` for readability in weight IDs.
    action_prefixes = action_prefixes.map(prefix => action_prefix_shorthand_.get(prefix, prefix));

    // The select layer output keys, output prefixes, and bias IDs differ between 1 and 2 layer PF.
    let select_prefixes = action_prefixes;
    let select_segments = action_segments;
    let select_bias_ids: string[] = action_bias_ids;
    let synergy_weight_ids: (string | 0)[][][] = [];
    if (bool(action_synergies_)) {
      select_prefixes = [''];
      select_segments = action_segments.flatMap(action_segment => action_synergies_!.getitem(action_segment));
      select_bias_ids = select_segments.map(segment => bodyplan.classify_segment(segment)[0]);
      const synergy_weight_ids_: string[][][] = action_prefixes.flatMap(action_prefix =>
        action_segments.map(action_segment => [
          action_synergies_!.getitem(action_segment).map(synergy_segment =>
            `${action_prefix}_${bodyplan.intersegment_weight_id(synergy_segment, action_segment)}`),
        ]));
      assert_matches(
        'synergy weight IDs',
        synergy_weight_ids_.flatMap(([group]) => group),
        synergy_weight_id_override_,
      );
      synergy_weight_ids = synergy_weight_ids_.map(([segment_weight_ids]) => [
        segment_weight_ids.map(weight_id => synergy_weight_id_override_.get(weight_id, weight_id)),
      ]);
    }

    let select_weight_ids: (string | 0)[][] = select_prefixes.flatMap(select_prefix =>
      select_segments.map(select_segment =>
        // e.g. posF>Fc, velLe>Lbtc
        observation_prefixes.flatMap(observation_prefix =>
          observation_segments_override_.get(observation_prefix, observation_segments).map(observation_segment =>
            `${observation_prefix_shorthand_.get(observation_prefix, observation_prefix)}` +
            `${select_prefix}` +
            `${bodyplan.intersegment_weight_id(observation_segment, select_segment)}`))));
    // TODO: Guard against when there are no matches, compatible with GlobDict.
    select_weight_ids = select_weight_ids.map(row =>
      row.map(weight_id => select_weight_id_override_.get(weight_id as string, weight_id)));
    const select_keys = select_prefixes.flatMap(select_prefix =>
      select_segments.map(select_segment => `${select_prefix}${select_segment}`));

    // Select layer.
    this.select_layer = new utb.BlockLinear({
      input_keys: this.observation_keys,
      output_keys: select_keys,
      weight_ids: select_weight_ids,
      bias_ids: select_bias_ids,
      on_initialize: on_initialize_select,
    });
    this.select_activation = (
      select_activation ? new DictModule(select_activation, select_keys) : null
    );

    // Synergy layer.
    if (bool(synergies)) {
      console.assert(bool(action_synergies_));
      this.synergy_layer = new utb.SparseBlockLinear({
        input_keys: action_prefixes.flatMap(() =>
          action_segments.map(action_segment => [...action_synergies_!.getitem(action_segment)])),
        output_keys: this.action_keys.map(k => [k]),
        weight_ids: synergy_weight_ids,
        bias_ids: action_bias_ids.map(b => [b]),
        on_initialize: on_initialize_synergy,
      });
    }
    this.synergy_activation = (
      synergy_activation ? new DictModule(synergy_activation, this.action_keys) : null
    );
  }

  initialize(
    observation_space: gymnasium.spaces.Dict,
    action_space: gymnasium.spaces.Dict,
  ) {
    const select_space = bool(this.synergies) ? new gymnasium.spaces.Dict(new collections.Dict(
      this.select_layer.output_keys.map(select_key => [
        select_key,
        new gymnasium.spaces.Box({ low: 0.0, high: 1.0, shape: [this.synergies!] }),
      ]),
    )) : action_space;

    this.select_layer.initialize(observation_space, select_space);
    if (bool(this.synergies)) {
      this.synergy_layer.initialize(select_space, action_space);
    }
  }

  override forward(observation: collections.Mapping<torch.Tensor>): collections.Mapping<torch.Tensor> {
    // 1. Compute actions if 1-layer and synergy activations if 2-layer. `a = o @ W + b`
    let action: collections.Mapping<torch.Tensor> = this.select_layer.forward(observation);
    if (this.select_activation) {
      action = this.select_activation.forward(action);
    }
    // 3. If 2-layer, compute actions from synergy activations. `a_i = s_i @ W_i`
    if (bool(this.synergies)) {
      action = this.synergy_layer.forward(action);
    }
    if (this.synergy_activation) {
      action = this.synergy_activation.forward(action);
    }
    return action;
  }
}


// ==================================================================================================
// AfferentFeedback

export interface AfferentFeedbackNetworkKwargs {
  observation_segments: string[];
  action_segments: string[];

  observation_prefixes: string[];
  action_prefixes: string[];

  lateral_segments?: MappingLike<[string, string]> | null;
  sagittal_segments?: MappingLike<string> | null;
  transverse_segments?: MappingLike<string> | null;

  observation_prefix_shorthand?: MappingLike<string> | null;
  action_prefix_shorthand?: MappingLike<string> | null;
  observation_segments_override?: MappingLike<string[]> | null;

  action_prefix_symmetry_mapping?: MappingLike<string> | null;
  action_symmetry_mapping?: MappingLike<string> | null;

  reset?: boolean;

  reset_weight_id_override?: MappingLike<string | 0> | null;

  sensor_activation?: ModuleFactory | null;
  reset_activation?: ModuleFactory | null;

  on_initialize_sensor?: BlockInitializer | null;
  on_initialize_reset?: BlockInitializer | null;
}

/**
 * Converts observations into sensor (non-resetting) and resetting afferent feedback signals.
 *
 * There are two sequential modules:
 * 1. Sensor: `sensor_layer -> sensor_activation ->`
 * 2. Reset: `reset_layer -> reset_activation ->`
 *
 * `sensor_layer` is a scalar weight and bias that converts observations into sensor signals.
 * `reset_layer` is a linear layer that converts sensor signals into resetting afferent signals.
 */
export class AfferentFeedbackNetwork extends torch.nn.Module {
  reset: boolean;
  observation_keys: string[];
  action_keys: string[];
  sensor_layer: utb.BlockScaleShift;
  sensor_activation: DictModule | null;
  reset_layer: utb.BlockLinear;
  reset_activation: DictModule | null;

  /**
   * Args:
   *   observation_segments: Body segments with which observations may be associated, e.g.
   *     `['limbFL', 'limbFR', 'limbHL', 'limbHR', 'lumbarE', 'lumbarBT[<-]', 'lumbarBT[->]']`.
   *   action_segments: Body segments with which actions may be associated, e.g.
   *     `['limbFL', 'limbFR', 'limbHL', 'limbHR', 'lumbarE', 'lumbarBT']`.
   *
   *   observation_prefixes: List of observation prefixes, e.g. `['rg', 'body/proprio_pos']`.
   *   action_prefixes: List of action prefixes, e.g. `['body/muscle_flx', 'body/muscle_ext']`.
   *
   *   lateral_segments: Mapping from contralateral symmetry group to the left and right segments,
   *     e.g. {F: ['limbFL', 'limbFR']}.
   *   sagittal_segments: Mapping from sagittal symmetry group to the segment,
   *     e.g. {Le: 'lumbarE'}.
   *   transverse_segments: Mapping from transverse symmetry group to the segment,
   *     e.g. {Lbt: 'lumbarBT'}.
   *
   *   observation_prefix_shorthand: Mapping from observation prefix to shorthand, e.g.
   *     `{'rg': 'rg', 'body/proprio_pos': 'pos'}`.
   *   action_prefix_shorthand: Mapping from action prefix to shorthand, e.g.
   *     `{'body/muscle_flx': 'flx'}`.
   *   observation_segments_override: Override the segments used for specific observation prefixes,
   *     e.g. `{'rg': ['limbFL', 'limbFR', 'limbHL', 'limbHR']}`,
   *     instead of using `observation_segments`.
   *
   *   action_prefix_symmetry_mapping: Mapping from action prefix to symmetry group, e.g.
   *     `{'body/muscle_flx': 'flx'}`.
   *   action_symmetry_mapping: Mapping from action key to symmetry group, e.g.
   *     `{'body/muscle_flx_FL': 'flx_F'}`.
   *
   *   reset: Whether to include the reset layer.
   *
   *   reset_weight_id_override: Mapping from reset weight ID to override weight ID.
   *
   *   sensor_activation: Activation function for the sensory layer.
   *   reset_activation: Activation function for the reset layer.
   *
   *   on_initialize_sensor: Initializer for the sensory layer weights and biases.
   *   on_initialize_reset: Initializer for the reset layer weights and biases.
   */
  constructor({
    observation_segments,
    action_segments,

    observation_prefixes,
    action_prefixes,

    lateral_segments = null,
    sagittal_segments = null,
    transverse_segments = null,

    observation_prefix_shorthand = null,
    action_prefix_shorthand = null,
    observation_segments_override = null,

    action_prefix_symmetry_mapping = null,
    action_symmetry_mapping = null,

    reset = false,

    reset_weight_id_override = null,

    sensor_activation = null,
    reset_activation = null,

    on_initialize_sensor = null,
    on_initialize_reset = null,
  }: AfferentFeedbackNetworkKwargs) {
    super();
    console.assert(observation_segments.length === new Set(observation_segments).size);
    console.assert(action_segments.length === new Set(action_segments).size);
    console.assert(observation_prefixes.length === new Set(observation_prefixes).size);
    console.assert(action_prefixes.length === new Set(action_prefixes).size);

    console.assert(reset || !bool(reset_activation));
    console.assert(reset || !bool(on_initialize_reset));

    this.reset = reset;

    const observation_prefix_shorthand_ = collections.dict(observation_prefix_shorthand ?? {});
    const action_prefix_shorthand_ = collections.dict(action_prefix_shorthand ?? {});
    const observation_segments_override_ = collections.dict(observation_segments_override ?? {});
    const lateral_segments_ = collections.dict(lateral_segments ?? {});
    const sagittal_segments_ = collections.dict(sagittal_segments ?? {});
    const transverse_segments_ = collections.dict(transverse_segments ?? {});
    const action_prefix_symmetry_mapping_ = collections.dict(action_prefix_symmetry_mapping ?? {});
    const action_symmetry_mapping_ = collections.dict(action_symmetry_mapping ?? {});
    const reset_weight_id_override_ = collections.dict(reset_weight_id_override ?? {});

    const bodyplan = new BodyPlan(lateral_segments_, sagittal_segments_, transverse_segments_);

    // Observation and action keys are expected to have the format f'{prefix}_{segment}',
    // e.g. body/proprio_pos_FL and body/muscle_flx_FL.
    // We enumerate all prefix and segment combinations to get concrete keys.
    this.observation_keys = observation_prefixes.flatMap(prefix =>
      observation_segments_override_.get(prefix, observation_segments).map(suffix => `${prefix}_${suffix}`));
    this.action_keys = action_prefixes.flatMap(prefix => action_segments.map(suffix => `${prefix}_${suffix}`));

    // Define shared weights for sensory layer.
    const sensor_ids = observation_prefixes.flatMap(prefix =>
      observation_segments_override_.get(prefix, observation_segments).map(segment =>
        `${prefix}_${bodyplan.classify_segment(segment)[0]}`));

    // Define shared weights for reset layer.
    // Preferentially use full action_symmetry_mapping over individual prefix/suffix mappings.
    let reset_weight_ids: (string | 0)[][] = action_prefixes.flatMap(action_prefix =>
      action_segments.map(action_segment =>
        // e.g. posF>Fc, velLe>Lbtc
        observation_prefixes.flatMap(observation_prefix =>
          observation_segments_override_.get(observation_prefix, observation_segments).map(observation_segment =>
            `${observation_prefix_shorthand_.get(observation_prefix, observation_prefix)}` +
            `${action_prefix_shorthand_.get(action_prefix, action_prefix)}` +
            `${bodyplan.intersegment_weight_id(observation_segment, action_segment)}`))));
    reset_weight_ids = reset_weight_ids.map(row =>
      row.map(weight_id => reset_weight_id_override_.get(weight_id as string, weight_id)));
    const reset_bias_ids = action_prefixes.flatMap(prefix => action_segments.map(segment =>
      action_symmetry_mapping_.get(
        `${prefix}_${segment}`,
        (
          `${action_prefix_symmetry_mapping_.get(prefix, prefix)}_` +
          `${bodyplan.classify_segment(segment)[0]}`
        ),
      )));

    // Sensor layer.
    this.sensor_layer = new utb.BlockScaleShift({
      input_keys: this.observation_keys,
      weight_ids: sensor_ids,
      bias_ids: sensor_ids,
      on_initialize: on_initialize_sensor,
    });
    this.sensor_activation = (
      sensor_activation ? new DictModule(sensor_activation, this.observation_keys) : null
    );

    // Reset layer.
    this.reset_layer = new utb.BlockLinear({
      input_keys: this.observation_keys,
      output_keys: this.action_keys,
      weight_ids: reset_weight_ids,
      bias_ids: reset_bias_ids,
      on_initialize: on_initialize_reset,
    });

    this.reset_activation = (
      reset_activation ? new DictModule(reset_activation, this.action_keys) : null
    );
  }

  initialize(
    observation_space: gymnasium.spaces.Dict,
    action_space: gymnasium.spaces.Dict,
  ) {
    this.sensor_layer.initialize(observation_space);
    if (this.reset) {
      this.reset_layer.initialize(observation_space, action_space);
    }
  }

  override forward(
    observation: collections.Mapping<torch.Tensor>,
  ): [collections.Mapping<torch.Tensor>, collections.Mapping<torch.Tensor> | null] {
    // 1. Scale each observation key and add a bias. `o_i = o_i * w_i + b_i`
    let sensor: collections.Mapping<torch.Tensor> = this.sensor_layer.forward(observation);
    if (this.sensor_activation) {
      sensor = this.sensor_activation.forward(sensor);
    }

    // 2. Compute reset. `a = o @ W + b`
    let reset: collections.Mapping<torch.Tensor> | null;
    if (this.reset) {
      reset = this.reset_layer.forward(sensor);
      if (this.reset_activation) {
        reset = this.reset_activation.forward(reset);
      }
    } else {
      reset = null;
    }

    return [sensor, reset];
  }
}


export type SegmentType = 'lateral-left' | 'lateral-right' | 'saggital' | 'transverse';

/**
 * Utility class for determining intersegmental relationships.
 *
 * We use this to set the shared weights and symmetries.
 * This produces a 2D list filled with unique weight block identifiers
 * f'{obs}{act}{obs_segment}->{act_segment}' like:
 *
 * 'rgfF>F' (rg: RG output, f: flexor muscle abbrev, F->F: front limb to same front limb)
 *   - The weight matrix that defines the contribution of RG output from a front limb's flexor and
 *     extensor units to that SAME front limb's flexor muscle action, shared between FL and FR.
 *
 * 'rgeF>Fc' (rg: RG output, e: extensor muscle abbrev, F->Fc: front limb to cross front limb)
 *   - The weight matrix that defines the contribution of RG output from a front limb's flexor and
 *     extensor units to the OTHER front limb's extensor muscle action, shared between FL and FR.
 *
 * 'posfLe>H' (pos: body/proprio_pos, f: flexor muscle abbrev, Le: lumbar_extend, H: hind limb)
 *   - The weight matrix that defines the contribution of the lumbar_extend position observation
 *     to the hind limb's flexor muscle action, shared between both hind limbs.
 *
 * These weight block identifiers can also be surrounded with '-(...)' to indicate a sign-flipped
 * relation, important for asymmetric observations like tendon bend and twist.
 * When synergies are enabled, {act}={''}, because then individual action keys are delegated
 * to the synergy layer, and the BlockLinear just controls `n` synergies per limb.
 */
export class BodyPlan {
  lateral_segments: collections.Mapping<[string, string]>;
  sagittal_segments: collections.Mapping<string>;
  transverse_segments: collections.Mapping<string>;

  constructor(
    lateral_segments: collections.Mapping<[string, string]>,
    sagittal_segments: collections.Mapping<string>,
    transverse_segments: collections.Mapping<string>,
  ) {
    this.lateral_segments = lateral_segments;
    this.sagittal_segments = sagittal_segments;
    this.transverse_segments = transverse_segments;
  }

  classify_segment(segment: string): [string, SegmentType] {
    for (const [contralateral_group, [left, right]] of this.lateral_segments.items()) {
      if (segment === left) {
        return [contralateral_group, 'lateral-left'];
      } else if (segment === right) {
        return [contralateral_group, 'lateral-right'];
      }
    }
    for (const [sagittal_group, sagittal_segment] of this.sagittal_segments.items()) {
      if (segment === sagittal_segment) {
        return [sagittal_group, 'saggital'];
      }
    }
    for (const [transverse_group, transverse_segment] of this.transverse_segments.items()) {
      if (segment === transverse_segment) {
        return [transverse_group, 'transverse'];
      }
    }
    throw new Error(`ValueError: Segment ${segment} is not classified as lateral, saggital, or transverse.`);
  }

  intersegment_weight_id(segment1: string, segment2: string): string {
    const [segment_group1, segment_type1] = this.classify_segment(segment1);
    const [segment_group2, segment_type2] = this.classify_segment(segment2);
    const contralateral_pairs: [SegmentType, SegmentType][] = [['lateral-left', 'lateral-right'], ['transverse', 'lateral-right']];
    const contralateral = contralateral_pairs.some(([a, b]) =>
      (segment_type1 === a && segment_type2 === b) || (segment_type2 === a && segment_type1 === b));
    return `${segment_group1}>${segment_group2}${contralateral ? 'c' : ''}`;
  }
}


// ==================================================================================================
// Brainstem Command modules

export function init_bc_fixed({
  head,
  torso = null,
  weight = 0.5,
  bias = -0.05,
  weight_grad = false,
  bias_grad = false,
}: {
  head: torch.nn.Module,
  torso?: torch.nn.Module | null,
  weight?: number | number[],
  bias?: number | number[],
  weight_grad?: boolean,
  bias_grad?: boolean,
}) {
  const layer = (head as ttm.DeterministicPolicyHead).action_layer.getitem(0) as torch.nn.Linear;
  layer.weight.set_(torch.tensor(weight));
  layer.weight.requires_grad = weight_grad;
  if (layer.bias !== null) {
    layer.bias.set_(torch.tensor(bias));
    layer.bias.requires_grad = bias_grad;
  }
}


/**
 * A Brainstem Command (BC) network module generates a variable command signal to control speed
 * and gait through the RG.
 */
export class BrainstemCommandNetwork extends torch.nn.Module {
  torso: torch.nn.Module | null;
  head: ttm.DeterministicPolicyHead;
  observe: string[];
  repeat: number;
  command_size: number;
  init: (kwargs: { head: torch.nn.Module, torso: torch.nn.Module | null }) => void;
  observation_space!: gymnasium.spaces.Dict;
  output_size!: number;

  constructor({
    torso = null,
    head = null,
    observe = ['target_vx'],
    repeat = 1,
    command_size = 1,
    init = init_bc_fixed,
  }: {
    torso?: torch.nn.Module | null,  // NOTE: Torsos (e.g. tonic MLPs) are not ported.
    head?: ttm.DeterministicPolicyHead | null,
    observe?: string[],
    repeat?: number,
    command_size?: number,
    init?: (kwargs: { head: torch.nn.Module, torso: torch.nn.Module | null }) => void,
  } = {}) {
    super();
    this.torso = torso;
    this.head = head ?? new ttm.DeterministicPolicyHead({
      activation: () => new torch.nn.Identity(),
      bias: true,
      init_fn: init_zeros,
    });
    this.observe = observe;
    this.repeat = repeat;
    this.command_size = command_size;
    this.init = init;
  }

  initialize(
    observation_space: gymnasium.spaces.Dict,
    output_size: number = 4,
  ) {
    this.observation_space = observation_space;
    console.assert(output_size % this.command_size === 0);
    this.output_size = output_size;
    const observation_size = this.observe.reduce(
      (sum, oname) => sum + (observation_space.getitem(oname) as gymnasium.spaces.Box).shape[0], 0,
    );
    const size = observation_size * this.repeat;
    if (this.torso !== null) {
      throw new Error('NotImplementedError: BrainstemCommandNetwork torsos are not ported.');
    }
    this.head.initialize(size, new gymnasium.spaces.Box({ low: -1, high: 1, shape: [this.command_size] }));
    this.init({ head: this.head, torso: this.torso });
  }

  /**
   * Args:
   *   observations: Dict observations with tensor values [observation_value_size].
   * Return:
   *   commands: Command signal tensor [output_size].
   */
  override forward(observations: Observation): torch.Tensor {
    let out = torch.concat(
      observations.items().filter(([oname]) => this.observe.includes(oname)).map(([, o]) => o),
      -1,
    );
    out = out.repeat_interleave(this.repeat, -1);
    const command = this.head.forward(out);  // [command_size]
    // Use non-interleaving repeat, e.g. [freq, sync] -> [freq, sync, freq, sync] with output_size=4.
    return command.repeat(this.output_size / (command.size(0) as number));  // [output_size]
  }
}


// ==================================================================================================
// ObservationRectifier

type ObsKey = string;

export type RectifyMode = 'sign' | 'flip' | 'activation';
// Suffixes appended (as f'{oname}[{suffix}]') per split component of a rectification, in order.
export const RECTIFY_SUFFIX: Record<RectifyMode, string[]> = {
  'sign': ['-', '+'],    // x -> [ReLU(-x), ReLU(x)]
  'flip': ['<-', '->'],  // x -> [high - x + low, x]
  'activation': [''],
};

type Constrain = (param: torch.Tensor) => void;

/**
 * Splits/transforms observations by key, keyed by glob pattern (first match wins).
 *
 * Keys of `rectification`, `split_key`, `activation`, `constrain_weight`, and `constrain_bias`
 * are glob patterns (see utils.collections.GlobDict) matched against ObsKeys; observation keys
 * matching no `rectification` pattern (or matching one mapped to None) pass through unmodified.
 * `constrain_weight`/`constrain_bias` values are constrain callables applied to the corresponding
 * parameter; unmatched keys are unconstrained.
 */
export class ObservationRectifier extends torch.nn.Module {
  rectification: collections.GlobDict<RectifyMode | null>;
  split_key: collections.GlobDict<boolean>;
  weight: torch.nn.ParameterDict | null;
  bias: torch.nn.ParameterDict | null;
  activation_fn: collections.GlobDict<ModuleFactory>;
  constrain_weight: collections.GlobDict<Constrain>;
  constrain_bias: collections.GlobDict<Constrain>;
  observation_space!: gymnasium.spaces.Dict;
  activation!: torch.nn.ModuleDict;

  constructor({
    rectification,
    split_key = null,
    weight = true,
    bias = true,
    activation = null,
    constrain_weight = null,
    constrain_bias = null,
  }: {
    rectification: MappingLike<RectifyMode | null>,
    split_key?: MappingLike<boolean> | null,
    weight?: boolean,
    bias?: boolean,
    activation?: MappingLike<ModuleFactory> | null,
    constrain_weight?: MappingLike<Constrain> | null,
    constrain_bias?: MappingLike<Constrain> | null,
  }) {
    super();
    this.rectification = new collections.GlobDict(collections.dict(rectification).items());
    this.split_key = new collections.GlobDict(collections.dict(split_key ?? {}).items());
    this.weight = weight ? new torch.nn.ParameterDict() : null;
    this.bias = bias ? new torch.nn.ParameterDict() : null;
    this.activation_fn = new collections.GlobDict(collections.dict(activation ?? {}).items());
    this.constrain_weight = new collections.GlobDict(collections.dict(constrain_weight ?? {}).items());
    this.constrain_bias = new collections.GlobDict(collections.dict(constrain_bias ?? {}).items());
  }

  initialize(observation_space: gymnasium.spaces.Dict): gymnasium.spaces.Dict {
    this.observation_space = observation_space;
    this.activation = new torch.nn.ModuleDict();
    for (const [label, patterns] of [
      ['constrain_weight', this.constrain_weight],
      ['constrain_bias', this.constrain_bias],
      ['activation', this.activation_fn],
    ] as [string, collections.GlobDict<unknown>][]) {
      const unmatched = patterns.keys().filter(p => !observation_space.keys().some(oname => uts.in_glob_range(p, oname)));
      if (unmatched.length) {
        throw new Error(`ValueError: ${label} patterns match no observation keys: ${unmatched}`);
      }
    }
    const observation_space_transformed = new collections.OrderedDict(observation_space.items());
    for (const oname of observation_space) {
      const rectification = this.rectification.get(oname);
      if (rectification === null) {
        continue;
      }
      const obox = observation_space.getitem(oname);
      console.assert(obox instanceof gymnasium.spaces.Box);
      const { low, high } = obox as gymnasium.spaces.Box;
      // Transform observation space based on the rectification type.
      let lows: number[][];
      let highs: number[][];
      switch (rectification) {
        case 'sign': {
          const relu = (x: number) => Math.max(x, 0);
          const low_neg = zip(low, high).map(([l, h]) => Math.min(relu(-l), relu(-h)));
          const high_neg = zip(low, high).map(([l, h]) => Math.max(relu(-l), relu(-h)));
          const low_pos = zip(low, high).map(([l, h]) => Math.min(relu(l), relu(h)));
          const high_pos = zip(low, high).map(([l, h]) => Math.max(relu(l), relu(h)));
          [lows, highs] = [[low_neg, low_pos], [high_neg, high_pos]];
          break;
        }
        case 'flip':
          [lows, highs] = [[low, low], [high, high]];
          break;
        case 'activation':
          [lows, highs] = [[low], [high]];
          break;
      }
      let suffixes = RECTIFY_SUFFIX[rectification];
      let labels: (string | string[] | null)[];
      if (obox instanceof cxg.Box && obox.labels) {
        if (obox.labels.length !== 1) {
          throw new Error(`ValueError: Expected a 1-long label for 1-D box, got ${JSON.stringify(obox.labels)}.`);
        }
        labels = suffixes.map(() => obox.labels![0]);
      } else {
        labels = suffixes.map(() => null);
      }
      if (!this.split_key.get(oname, false)) {
        [lows, highs, suffixes, labels] = [[lows.flat()], [highs.flat()], [''], [null]];
      }
      // TODO: Random seed is not preserved here.
      for (let [low, high, suffix, label] of zip(lows, highs, suffixes, labels)) {
        const oname_suffix = suffix ? `${oname}[${suffix}]` : oname;
        if (label && suffix) {
          label = typeof label === 'string' ? `${label}[${suffix}]` : label.map(l => `${l}[${suffix}]`);
        }
        observation_space_transformed.setitem(oname_suffix, new cxg.Box({
          low: low,
          high: high,
          shape: [low.length],
          labels: label ? [label] : null,
        }));
        // Initialize learnable parameters for the rectification if applicable.
        if (this.weight !== null) {
          this.weight.setitem(oname_suffix, torch.zeros([low.length]));
          const constrain_weight = this.constrain_weight.get(oname_suffix);
          if (constrain_weight !== null) {
            constrain_weight(this.weight.getitem(oname_suffix));
          }
        }
        if (this.bias !== null) {
          this.bias.setitem(oname_suffix, torch.zeros([low.length]));
          const constrain_bias = this.constrain_bias.get(oname_suffix);
          if (constrain_bias !== null) {
            constrain_bias(this.bias.getitem(oname_suffix));
          }
        }
        const act = this.activation_fn.get(oname_suffix);
        if (act !== null) {
          this.activation.setitem(oname_suffix, act());
        }
      }
    }
    return new gymnasium.spaces.Dict(observation_space_transformed);
  }

  override forward(observation: Observation): collections.Dict<torch.Tensor> {
    const observation_ = new collections.Dict(observation.items());
    const activation = this.activation;
    for (const oname of this.observation_space) {
      const rectification = this.rectification.get(oname);
      if (rectification === null) {
        continue;
      }
      // Apply rectification.
      const value = observation_.getitem(oname);
      let values: torch.Tensor[];
      switch (rectification) {
        case 'sign':
          values = [torch.clamp(value.neg(), { min: 0 }), torch.clamp(value, { min: 0 })];
          break;
        case 'flip': {
          const box = this.observation_space.getitem(oname) as gymnasium.spaces.Box;
          const [low, high] = [
            torch.as_tensor(box.low, { dtype: value.dtype }),
            torch.as_tensor(box.high, { dtype: value.dtype }),
          ];
          values = [high.sub(value).add(low), value];
          break;
        }
        case 'activation':
          values = [value];
          break;
      }
      let suffixes = RECTIFY_SUFFIX[rectification];
      // Apply learnable affine transformation if applicable.
      if (!this.split_key.get(oname, false)) {
        [values, suffixes] = [[torch.cat(values, -1)], ['']];
      }
      for (let [value, suffix] of zip(values, suffixes)) {
        const oname_suffix = suffix ? `${oname}[${suffix}]` : oname;
        if (this.weight !== null) {
          value = value.mul(this.weight.getitem(oname_suffix));
        }
        if (this.bias !== null) {
          value = value.add(this.bias.getitem(oname_suffix));
        }
        if (activation.has(oname_suffix)) {
          value = activation.getitem(oname_suffix).forward(value);
        }
        observation_.setitem(oname_suffix, value);
      }
    }
    return observation_;
  }
}


// ==================================================================================================
// RhythmGenerationCircuitObserver

/**
 * Merges RhythmGeneration outputs into observations and correspondingly expands the observation
 * space with labeled boxes, e.g. `{'rg_FL': Box(labels=['flx', 'flx2', 'ext', 'ext2'], ...)}`.
 */
export class RhythmGenerationCircuitObserver {
  observation_prefix!: string;
  output_mapping!: collections.Dict<[string, number][]>;

  initialize(
    rhythm_generation: RhythmGenerationCircuit,
    observation_space: gymnasium.spaces.Dict,
    observation_prefix: string = 'rg',
  ): gymnasium.spaces.Dict {
    this.observation_prefix = observation_prefix;
    // Parse RG output structure information for clean downstream reorganization.
    // NOTE: The RG output units are assumed to have a specific naming convention:
    //       f'{polarity}{delay}_{limb}'.
    const output_units = rhythm_generation.get_output_units();  // flx_FL, flx2_FL, ext_FL, ext2_FL, ...
    const output_structure = new collections.Dict<Map<string, [string, number, number]>>(
      ['limbFL', 'limbFR', 'limbHL', 'limbHR'].map(k => [k, new Map()]),
    );  // LimbName: {(polarity, delay): index}
    const limb_units: Record<string, string> = { FL: 'limbFL', FR: 'limbFR', HL: 'limbHL', HR: 'limbHR' };
    for (const unit of output_units) {
      const [role, limb_rg] = unit.split('_');
      const limb = limb_units[limb_rg];
      const polarity = role.slice(0, 3);
      const delay = role.length > 3 ? parseInt(role.slice(3), 10) : 0;
      if (!(['flx', 'ext'].includes(polarity) && ['FL', 'FR', 'HL', 'HR'].includes(limb_rg))) {  // TODO: Consider adding and enabling lumbar RG units.
        throw new Error(`ValueError: Unexpected RG output unit: ${unit}.`);
      }
      const structure = output_structure.getitem(limb);
      if (structure.has(`${polarity},${delay}`)) {
        throw new Error(`ValueError: Duplicate RG output unit for limb ${limb} and delay ${delay}.`);
      }
      // NOTE: `rhythm_generation.get_output()` returns per-limb tensors (local indexing), not a
      //       single global tensor, so store each unit's position within its own limb here rather
      //       than its position in the flattened `output_units` list.
      structure.set(`${polarity},${delay}`, [polarity, delay, structure.size]);
    }
    // Verify that contralateral limbs have the same RG units, since AF & PF share those weights.
    const units_FL = [...output_structure.getitem('limbFL').keys()];
    const units_FR = [...output_structure.getitem('limbFR').keys()];
    if (units_FL.join() !== units_FR.join()) {
      throw new Error(`ValueError: RG units for FL and FR must match, but ${units_FL} != ${units_FR}`);
    }
    const units_HL = [...output_structure.getitem('limbHL').keys()];
    const units_HR = [...output_structure.getitem('limbHR').keys()];
    if (units_HL.join() !== units_HR.join()) {
      throw new Error(`ValueError: RG units for HL and HR must match, but ${units_HL} != ${units_HR}`);
    }
    // Sort by [flx, ext], then delay, and format labels.
    this.output_mapping = new collections.Dict(output_structure.items().map(([k, struct]) => [
      k,
      [...struct.values()].map(([polarity, delay, index]) => [`${polarity}${delay || ''}`, index] as [string, number]),
    ]));  // LimbName: [(label, index), ...]
    observation_space = new gymnasium.spaces.Dict(observation_space.items());
    for (const [limb, mapping] of this.output_mapping.items()) {
      observation_space.setitem(`${this.observation_prefix}_${limb}`, new cxg.Box({
        low: 0.0,
        high: 1.0,
        shape: [mapping.length],
        labels: [mapping.map(([l]) => l)],
      }));
    }
    return observation_space;
  }

  insert(
    rhythm_generation_output: collections.Mapping<torch.Tensor>,
    observation: Observation,
  ): collections.Dict<torch.Tensor> {
    const observation_ = new collections.Dict(observation.items());
    for (const [limb, mapping] of this.output_mapping.items()) {
      const limb_rg = limb.slice(-2);  // TODO: Converting from 'limbFL' to 'FL' and vice-versa is annoying.
      const indices = mapping.map(([, index]) => index);
      let out: torch.Tensor;
      if (rhythm_generation_output.has(limb_rg)) {
        out = rhythm_generation_output.getitem(limb_rg).take(indices);
      } else {
        console.assert(mapping.length === 0, `Expected no RG output for limb ${limb}, but got indices ${indices}.`);
        out = torch.zeros([0]);
      }
      observation_.setitem(`${this.observation_prefix}_${limb}`, out);
    }
    return observation_;
  }
}

// ==================================================================================================
// RhythmGenerationCircuit

export type LimbName = 'FL' | 'FR' | 'HL' | 'HR';

export interface RhythmGenerationOscKwargs {
  activation?: (...args: any[]) => torch.Tensor;
  adaptation_time?: number;
  active_time?: number;
  quiet_time?: number;
  active_scale_pos?: number;
  quiet_scale_pos?: number;
  active_scale_neg?: number;
  quiet_scale_neg?: number;
  adaptation_scale_active_pos?: number;
  adaptation_scale_quiet_pos?: number;
  adaptation_scale_active_neg?: number;
  adaptation_scale_quiet_neg?: number;
  active_stable?: number;
  quiet_stable?: number;
  active_stable_margin?: number;
  quiet_stable_margin?: number;
  active_delay?: number;
  quiet_delay?: number;
  noise?: number;
}

export interface RhythmGenerationBasicKwargs {
  activation?: (...args: any[]) => torch.Tensor;
  voltage_time?: number;
}

/** Initializes parameters and hyperparameters. */
export type RhythmGenerationCircuitInitializer = (
  p: utt.containers.ParameterManager,
  kwargs?: { grad?: boolean },
) => [RhythmGenerationOscKwargs, RhythmGenerationOscKwargs | RhythmGenerationBasicKwargs, RhythmGenerationBasicKwargs];

export function activation_locomotion4_flx(
  v: torch.Tensor,
  a: torch.Tensor,
  x: torch.Tensor,
  {
    active_bound,
    quiet_bound,
    active_start = 1.0,
    active_end = 0.5,
    amplitude_start = 0.5,
    amplitude_end = 1.0,
    quiet = 0.,
    base = 2.,
  }: cc.OscillatorActivationBounds & {
    active_start?: torch.Tensor | number,
    active_end?: torch.Tensor | number,
    amplitude_start?: torch.Tensor | number,
    amplitude_end?: torch.Tensor | number,
    quiet?: torch.Tensor | number,
    base?: number,
  },
): torch.Tensor {
  const pos = cc.clip_normalized(0., 1., x);
  const amp = cc.interpolate_linear(amplitude_start, amplitude_end, pos);
  return (
    v.ge(0).mul(amp).mul(cc.interpolate_logarithmic(
      active_end, active_start, cc.clip_normalized(active_bound, quiet_bound, a), { base: base },
    )).add(v.lt(0).mul(quiet))
  );
}

export function activation_locomotion4_ext(
  v: torch.Tensor,
  {
    amplitude_start = 0.5,
    amplitude_end = 1.0,
  }: {
    amplitude_start?: torch.Tensor | number,
    amplitude_end?: torch.Tensor | number,
  } = {},
): torch.Tensor {
  const pos = cc.clip_normalized(0., 1., v);
  const amp = cc.interpolate_linear(amplitude_start, amplitude_end, pos);
  return v.ge(0).mul(amp);
}

/**
 * RG weight initialization for rat by setting hyperparamters based on experimental data. Used for
 * Multifixed speed experiments with Rat body. Retuned using proper notebook harness to fit data.
 *
 * Assuming flx/ext are used to drive position-control signal with phase-delayed sign-flipped copies
 * enabling multiplexing signals within each limb state, only the first half of flx is used.
 *
 * Major changes compared to `init_rg_rat5`:
 * 1. Retuned 'cross' and 'sided' connections to produce stronger input signals in flx.x graphs.
 * 2. Introduce limb asymmetry to work synergistically with the `flx_delays` parameter.
 */
export function init_rg_rat6(
  p: utt.containers.ParameterManager,
  {
    grad = false,
    grad_flx = false,
    grad_ext = false,
    scale = 0.8,
    active = 200,
    quiet = 600,
    adaptation_scale = 1.5,
  }: {
    grad?: boolean,
    grad_flx?: boolean,
    grad_ext?: boolean,
    scale?: number,
    active?: number,
    quiet?: number,
    adaptation_scale?: number,
  } = {},
): [RhythmGenerationOscKwargs, RhythmGenerationBasicKwargs, RhythmGenerationBasicKwargs] {
  // Unit biases.
  p.config('bias_flx', ['bias_flx_*'], -0.05, grad_flx);  // flx quiet at baseline bc
  p.config('bias_ext', ['bias_ext_*'], -0.05, grad_ext);  // ext quiet at baseline bc
  p.config('bias_v0d', ['bias_v0d_*'], -0., grad);  // active at slow (cross async)
  p.config('bias_v3e', ['bias_v3e_*'], -0., grad);  // inactive at slow (cross sync)
  p.config('bias_v3f', ['bias_v3f_*'], -0.2, grad);  // inactive at slow (cross sync)
  p.config('bias_v0v', ['bias_v0v_*'], -0., grad);  // active at slow (diag async)
  p.config('bias_v3a', ['bias_v3a_*'], -0.5, grad);  // inactive at slow (diag sync)
  p.config('bias_in2', ['bias_in2_*'], -0.5, grad);  // inactive at slow (diag sync)
  // Oscillator connections (osc).
  p.config('osc_flxext_i', ['osc_flxext_i_*'], -2.0, grad);  // flx dominates, osc async
  p.config('osc_extflx_i', ['osc_extflx_i_*'], -0.1, grad);  // ext has minor influence
  // Cross-side connections (cross).
  p.config('cross_flxflx_i_R', ['cross_flxflx_i_*R'], -1.7, grad);  // cross async at slow, bc inhibit
  p.config('cross_flxflx_i_L', ['cross_flxflx_i_*L'], -2.5, grad);  // cross async at slow, bc inhibit
  p.config('cross_flxflx_e', ['cross_flxflx_e_*'], 0.2, grad);  // cross sync at fast, bc excite
  p.config('cross_extext_e', ['cross_extext_e_*'], 0.2, grad);  // cross sync at fast, bc excite
  p.config('cross_extflx_i', ['cross_extflx_i_*'], -0.01, grad);  // cross walk, left-right phase 0.5
  // Same-side, descending connections (sided).
  p.config('sided_flxflx_i', ['sided_flxflx_i_*'], -1.2, grad);  // side async
  p.config('sided_extflx_e', ['sided_extflx_e_*'], 0.05, grad);  // side async
  // Same-side, ascending connections (sidea).
  p.config('sidea_extflx_e', ['sidea_extflx_e_*'], 0.05, grad);  // side async
  // Diagonal, descending connections (diagd).
  p.config('diagd_flxflx_i', ['diagd_flxflx_i_*'], -1.2, grad);  // diag async at slow
  p.config('diagd_flxflx_e', ['diagd_flxflx_e_*'], 0.4, grad);  // diag sync at fast
  p.config('diagd_in2v0d_i', ['diagd_in2v0d_i_*'], -0.7, grad);  // diag async at slow
  // Diagonal, ascending connections (diaga).
  p.config('diaga_flxflx_e', ['diaga_flxflx_e_*'], 0.4, grad);  // diag sync at fast
  p.config('diaga_v3ain2_e', ['diaga_v3ain2_e_*'], 0.1, grad);  // diag sync at fast
  // Afferent connections (aff).
  p.config('aff_flx', ['aff_flx_*'], 1., false);  // identity
  p.config('aff_ext', ['aff_ext_*'], 1., false);  // identity
  // Command connections (freq, sync).
  // p.config('freq_flx_e', ['freq_flx_e*'], 0.7, grad);  // flx rises (1)
  p.config('freq_flx_e_F', ['freq_flx_e_F*'], 0.82, grad);  // flx rises (2)
  p.config('freq_flx_e_H', ['freq_flx_e_H*'], 0.85, grad);  // flx rises
  // p.config('freq_flx_e_FL', ['freq_flx_e_FL'], 0.83, grad);  // flx rises (4)
  // p.config('freq_flx_e_FR', ['freq_flx_e_FR'], 0.82, grad);  // flx rises
  // p.config('freq_flx_e_HL', ['freq_flx_e_HL'], 0.86, grad);  // flx rises
  // p.config('freq_flx_e_HR', ['freq_flx_e_HR'], 0.85, grad);  // flx rises
  p.config('freq_ext_e', ['freq_ext_e_*'], 0.9, grad);  // ext constant
  p.config('freq_cross_e', ['freq_cross_e_*'], 0.2, grad);  // cross sync at bound (v3f)
  p.config('freq_diaga_e', ['freq_diaga_e_*'], 0.3, grad);  // diag sync at trot (v3a)
  p.config('sync_cross_i', ['sync_cross_i_*'], -0.8, grad);  // cross sync at bound (v0d)
  p.config('sync_diagdi_i', ['sync_diagdi_i_*'], -0.9, grad);  // diag async walk -> sync trot (v0d)
  p.config('sync_diagde_i', ['sync_diagde_i_*'], -0.6, grad);  // diag sync trot -> async bound (v0v)

  // Unit hyperparameters.
  const osc: RhythmGenerationOscKwargs = {
    // New hyperparameters based on rat data.
    'adaptation_time': Math.max(active, quiet) * scale * adaptation_scale,
    'active_time': active * scale,
    'quiet_time': quiet * scale,
    'active_scale_pos': 0.5,
    'quiet_scale_pos': 0.1,
    // Same hyperparameters as `init_rg_mouse`.
    'active_scale_neg': 0.4,
    'quiet_scale_neg': 1.1,
    'adaptation_scale_active_pos': 1.,
    'adaptation_scale_quiet_pos': 1.2,
    'adaptation_scale_active_neg': 1.2,
    'adaptation_scale_quiet_neg': 0.8,
    'quiet_delay': 0.1,
    'quiet_stable_margin': 50,
    'noise': 0.02,
  };
  const flx: RhythmGenerationOscKwargs = {
    ...osc,
    'activation': functools.partial(activation_locomotion4_flx, { active_start: 1.3, active_end: 0.4, amplitude_start: 0.2, amplitude_end: 1.0 }),
    'active_stable': 3,  // Never allow flx to remain in tonic (locked flexors).
  };
  const ext: RhythmGenerationBasicKwargs = {
    'activation': functools.partial(activation_locomotion4_ext, { amplitude_start: 0.2, amplitude_end: 1.0 }),
    'voltage_time': 30,
  };
  const basic: RhythmGenerationBasicKwargs = {
    'voltage_time': 10,
  };

  return [flx, ext, basic];
}


/**
 * A helper module that constrains `torch.nn.Parameter`/`torch.Tensor` values if they have defined
 * constraint functions. After every parameter update, calling `constrain()` modifies values in-place
 * to respect constraints. For example, this is useful to enforce sign constraints (excitatory vs.
 * inhibitory) on synaptic weights.
 *
 * NOTE: At inference, constraints are already satisfied by the checkpoint's parameters, and
 * `models.constrain` (which attaches `constrain_min`/`constrain_max` to parameters) is a no-op, so
 * `initialize` finds nothing to constrain. Its checkpoint entries (`params.N`, which alias other
 * parameters, and `mins.N`/`maxes.N`) are consumed and ignored when loading a state dict.
 */
export class Constrainer extends torch.nn.Module {
  // Must use lists since parameter names cannot contain '.' in `torch.nn.ParameterDict`.
  names: string[] = [];
  params = new torch.nn.ParameterList();
  mins = new torch.nn.ParameterList();
  maxes = new torch.nn.ParameterList();

  initialize(params: Iterable<[string, torch.nn.Parameter]>) {
    // Clamp only works if at least one of min/max is not None.
    for (const [name, param] of params) {
      if ('constrain_min' in param && 'constrain_max' in param) {
        const [min, max] = [param.constrain_min as torch.Tensor, param.constrain_max as torch.Tensor];
        console.assert(min.shape.join() === param.shape.join() && max.shape.join() === param.shape.join());
        this.names.push(name);
        this.params.append(param);
        this.mins.append(new torch.nn.Parameter(min, { requires_grad: false }));
        this.maxes.append(new torch.nn.Parameter(max, { requires_grad: false }));
      }
    }
  }

  constrain() {
    for (const [param, min, max] of zip([...this.params], [...this.mins], [...this.maxes])) {
      param.set_(torch.clamp(param, min, max));
    }
  }

  override _load_from_state_dict(
    state_dict: torch.nn.StateDict,
    prefix: string,
    missing_keys: string[],
    consumed: Set<string>,
    error_msgs: string[],
  ) {
    for (const key of state_dict.keys()) {
      if (key.startsWith(prefix)) consumed.add(key);
    }
  }
}


export class DictModule extends torch.nn.Module {
  module: torch.nn.Module;
  input_keys: string[];

  constructor(module: () => torch.nn.Module, input_keys: string[]) {
    super();
    this.module = module();
    this.input_keys = input_keys;
  }

  override forward(input: collections.Mapping<torch.Tensor>): collections.Dict<torch.Tensor> {
    return new collections.Dict(this.input_keys.map(k => [k, this.module.forward(input.getitem(k))]));
  }
}


export function init_zeros(module: torch.nn.Module) {
  if (module instanceof torch.nn.Linear) {
    module.weight.fill_(0);
    if (module.bias !== null) {
      module.bias.fill_(0);
    }
  }
}
