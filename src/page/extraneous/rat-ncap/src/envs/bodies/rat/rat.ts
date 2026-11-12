/**
 * Port of `projects/rodent/envs/bodies/rat/rat.py`.
 *
 * Build-time `MjSpec` edits (actuator dynamics/gains, collision `contact_mode`, foot compliance,
 * geom deletion) are not ported: they are baked into the exported compiled model (see
 * `python/export_env.py`). Not ported: reward-only getters (`get_pose*`, foot velocity/position and
 * contact forces), foot counters (used by `MoveAtFixedVelocity_TrackSmoothGait`), vestibular
 * observations, noise transforms, and the `position-stiffness` controller.
 */
import * as jnp from '../../../jax/numpy';
import * as mj from '../../../mujoco';
import * as cx from '../../../composer/core';
import * as cxe from '../../../composer/mjx_env';
import * as cxm from '../../../composer/math';
import * as cxt from '../../../composer/transforms';
import * as collections from '../../../utils/collections';

type MjxEnvState = cxe.MjxEnvState;

// Path to MuJoCo XML file (resolved against the exported spec mirrors by file name).
// export const RAT_XML = 'rat.xml';
export const RAT_XML = 'com_rat.xml';

export type RatSegment =
  'head' | 'cervicalE' | 'cervicalBT' | 'limbFL' | 'limbFR' | 'lumbarE' | 'lumbarBT' | 'limbHL' |
  'limbHR' | 'tailE' | 'tailB';

const segments = <V>(values: Record<RatSegment, V>) => new collections.OrderedDict<V>(Object.entries(values));
const np_deg2rad = (x: number[]) => x.map(v => v * (Math.PI / 180));
const ones_like = (x: number[]) => x.map(() => 1);

export const RAT_ACTUATORS = segments<string[]>({
  head: ['mandible', 'atlas'],
  cervicalE: ['cervical_extend'],
  cervicalBT: ['cervical_bend', 'cervical_twist'],
  limbFL: [
    'scapula_L_supinate',
    'scapula_L_abduct',
    'scapula_L_extend',
    'shoulder_L_supinate',
    'shoulder_L_extend',
    'elbow_L',
    'wrist_L',
    'finger_L',
  ],
  limbFR: [
    'scapula_R_supinate',
    'scapula_R_abduct',
    'scapula_R_extend',
    'shoulder_R_supinate',
    'shoulder_R_extend',
    'elbow_R',
    'wrist_R',
    'finger_R',
  ],
  lumbarE: ['lumbar_extend'],
  lumbarBT: ['lumbar_bend', 'lumbar_twist'],
  limbHL: ['hip_L_supinate', 'hip_L_abduct', 'hip_L_extend', 'knee_L', 'ankle_L', 'toe_L'],
  limbHR: ['hip_R_supinate', 'hip_R_abduct', 'hip_R_extend', 'knee_R', 'ankle_R', 'toe_R'],
  tailE: ['tail_extend'],
  tailB: ['tail_bend'],
});
export const RAT_ACTUATOR_NAMES = RAT_ACTUATORS.values().flat();

// Observation ranges for actuator velocities and stiffness/damping coefficients.
// Control ranges for joint positions can be extracted from the XML.
export const RAT_VEL_MAX = 20.;  // (rad/s)
export const RAT_TRQ_MAX = 1.;  // (N.m)
export const RAT_FOOT_MAX = 3.;  // (N)

// Actuator position midpoints for a midpoint+delta action space.
export const RAT_ACTUATORS_POS_MID = segments<number[]>({
  head: np_deg2rad([-36, 20]),
  cervicalE: [-0.33],
  cervicalBT: [0, 0],
  limbFL: np_deg2rad([4.5, 0, 0, -16.25, 20, -2, 61.2, -65]),
  limbFR: np_deg2rad([4.5, 0, 0, -16.25, 20, -2, 61.2, -65]),
  lumbarE: [0.1],
  lumbarBT: [0, 0],
  limbHL: np_deg2rad([-1.5, 12.75, -15, -35.2, 14, 0]),
  limbHR: np_deg2rad([-1.5, 12.75, -15, -35.2, 14, 0]),
  tailE: [0],
  tailB: [0],
});
export const RAT_ACTUATORS_DELTA = segments<number[]>({
  head: np_deg2rad([30, 25]),
  cervicalE: np_deg2rad([25]),
  cervicalBT: np_deg2rad([35, 35]),
  limbFL: np_deg2rad([5.5, 15, 2, 65, 95, 73, 70, 115]),
  limbFR: np_deg2rad([5.5, 15, 2, 65, 95, 73, 70, 115]),
  lumbarE: np_deg2rad([30]),
  lumbarBT: np_deg2rad([30, 30]),
  limbHL: np_deg2rad([35, 45, 75, 88, 44, 100]),
  limbHR: np_deg2rad([35, 45, 75, 88, 44, 100]),
  tailE: np_deg2rad([15]),
  tailB: np_deg2rad([15]),
});

export const RAT_ACTUATORS_POS_MIN = new collections.OrderedDict(RAT_ACTUATORS.keys().map(k => [
  k, RAT_ACTUATORS_POS_MID.getitem(k).map((mid, i) => mid - RAT_ACTUATORS_DELTA.getitem(k)[i]),
] as [string, number[]]));
export const RAT_ACTUATORS_POS_MAX = new collections.OrderedDict(RAT_ACTUATORS.keys().map(k => [
  k, RAT_ACTUATORS_POS_MID.getitem(k).map((mid, i) => mid + RAT_ACTUATORS_DELTA.getitem(k)[i]),
] as [string, number[]]));

export const RAT_ACTUATORS_KP = segments<number[]>({
  head: [0.1, 0.05],
  cervicalE: [20],
  cervicalBT: [20, 20],
  limbFL: [0.5, 0.5, 0.5, 0.3, 0.3, 0.3, 0.1, 0.05],
  limbFR: [0.5, 0.5, 0.5, 0.3, 0.3, 0.3, 0.1, 0.05],
  lumbarE: [20],
  lumbarBT: [20, 20],
  limbHL: [0.4, 0.4, 0.6, 0.4, 0.4, 0.05],
  limbHR: [0.4, 0.4, 0.6, 0.4, 0.4, 0.05],
  tailE: [1],
  tailB: [2],
});
export const RAT_ACTUATORS_KD = segments<number[]>({
  head: [0.002, 0.002],
  cervicalE: [1.0],
  cervicalBT: [1.0, 1.0],
  limbFL: [0.005, 0.005, 0.005, 0.005, 0.005, 0.003, 0.002, 0.002],
  limbFR: [0.005, 0.005, 0.005, 0.005, 0.005, 0.003, 0.002, 0.002],
  lumbarE: [0.03],
  lumbarBT: [0.03, 0.03],
  limbHL: [0.02, 0.02, 0.02, 0.005, 0.003, 0.001],
  limbHR: [0.02, 0.02, 0.02, 0.005, 0.003, 0.001],
  tailE: [0.002],
  tailB: [0.002],
});
// TODO: Make this reasonable, perhaps based on the max torques exertable by position control.
export const RAT_ACTUATORS_TRQ = new collections.OrderedDict(RAT_ACTUATORS.keys().map(k => [
  k, ones_like(RAT_ACTUATORS_KP.getitem(k)).map(x => RAT_TRQ_MAX * x),
] as [string, number[]]));

export function rat_actuators_pos_mid({ segment }: { segment: RatSegment }): number[] {
  return RAT_ACTUATORS_POS_MID.getitem(segment);
}

// Root position (x, y, z) in world frame (m).
export const RAT_ROOT_POS_INIT = [0.01635, 0.00062, 0.05109];
// Root orientation (w, x, y, z) in world frame (quat).
export const RAT_ROOT_QUAT_INIT = [0.99818, 0.00005, -0.06028, 0.0011];
// Joints initial positions corresponding to zero/standing pose after settling time.
export const RAT_JOINTS_POS_INIT = np_deg2rad([
   16.1,   0.0,  -0.0,  -9.4,  -0.0,   0.0,  -1.5,  15.9, -16.2, -35.1,   9.8,  14.1,  -1.5,  15.9,
  -16.2, -35.1,   9.8,  14.1,  -5.1,  -0.0,   5.6,  -0.0,  10.1,  -0.0,   1.1,  -0.0,  -2.0,  -0.0,
   -0.0,   0.0, -16.8,  -0.0,  -0.0, -16.3,  -0.0,   0.0, -15.9,  13.8, -18.4,   4.3,   1.6,  -1.8,
  -16.5,  18.7,  -4.6,  64.8, -62.2,   4.3,   1.6,  -1.8, -16.5,  18.7,  -4.6,  64.8, -62.2,
]);


export class RatState extends cx.BaseLocalState {
  /** Whether each foot was in contact with the ground in the previous env timestep. */
  foot_contact = jnp.zeros(4, { dtype: 'bool' });
  /** Whether each foot went from stance to swing (liftoff) in the current env timestep. */
  foot_liftoff = jnp.zeros(4, { dtype: 'bool' });
  /** Time (s) when each foot made the most recent liftoff. */
  foot_liftoff_time = jnp.zeros(4);
  /** Position (m) in global frame of each foot at the most recent liftoff. */
  foot_liftoff_pos = jnp.zeros([4, 3]);
  /** Whether each foot went from swing to stance (touchdown) in the current env timestep. */
  foot_touchdown = jnp.zeros(4, { dtype: 'bool' });
  /** Time (s) when each foot made the most recent touchdown. */
  foot_touchdown_time = jnp.zeros(4);
  /** Duration (s) of the most recent stance phase of each foot. */
  foot_stance_duration = jnp.zeros(4);
  /** Duration (s) of the most recent swing phase of each foot. */
  foot_swing_duration = jnp.zeros(4);
  /** Length (m) of the most recent swing phase of each foot. */
  foot_swing_length = jnp.zeros(4);
  /** Peak height (m) of the most recent swing phase of each foot. */
  foot_swing_peak = jnp.zeros(4);
}

type Controller = 'position' | 'position-stiffness' | cx.Transform<MjxEnvState, any>
  | collections.Mapping<cx.Transform<MjxEnvState, any>> | null;

export interface RatKwargs {
  observable_proprio?: boolean;
  observable_tactile?: boolean;
  observable_vestibular?: boolean;
  observable_visual?: boolean;
  actionable_dofs?: collections.Mapping<string[]> | Record<string, string[]>;
  contact_mode?: 'all' | 'trunk-limbs' | 'no-self' | 'foot';
  rescale_mode?: 'setpoint_delta' | 'limits';
  rescale_observations?: boolean;
  rescale_actions?: boolean;
  controller?: Controller;
  transforms?: (cx.Transform<MjxEnvState, any> | null)[];
  passive_kp?: collections.Mapping<number[]>;
  passive_kd?: collections.Mapping<number[]>;
  root_pos_init?: number[];
  root_quat_init?: number[];
  joints_pos_init?: number[];
  xml_path?: string;
}

export class Rat extends cxe.MjxEntity<RatState> {
  // Configuration.
  _actionable_dofs: collections.Mapping<string[]>;
  _observable_proprio: boolean;
  _observable_tactile: boolean;
  _observable_vestibular: boolean;
  _observable_visual: boolean;
  _root_pos_init: jnp.Array;  // [3], float (m)
  _root_quat_init: jnp.Array;  // [4], float (quat)
  _joints_pos_init: jnp.Array;  // [55], float (rad)

  // Model elements.
  _actuators: mj.MjsActuator[];
  _actuateds: (mj.MjsJoint | mj.MjsTendon)[];

  _root_body: mj.MjsBody;
  _root_joint: mj.MjsJoint;
  _root_global_linvel: mj.MjsSensor;
  _root_global_angvel: mj.MjsSensor;
  _head_quaternion: mj.MjsSensor;

  _foot_names: [string, string, string, string];
  _foot_touch: mj.MjsSensor[];

  _actuator_names: string[];
  _termination_contact_geoms: string[];

  constructor({
    observable_proprio = true,
    observable_tactile = true,
    observable_vestibular = false,
    observable_visual = false,
    actionable_dofs = RAT_ACTUATORS,
    contact_mode = 'foot',
    rescale_mode = 'setpoint_delta',
    rescale_observations = true,
    rescale_actions = true,
    controller = 'position',
    transforms = [],
    passive_kp = RAT_ACTUATORS_KP,
    passive_kd = RAT_ACTUATORS_KD,
    root_pos_init = RAT_ROOT_POS_INIT,
    root_quat_init = RAT_ROOT_QUAT_INIT,
    joints_pos_init = RAT_JOINTS_POS_INIT,
    xml_path = RAT_XML,
  }: RatKwargs = {}) {
    // Load spec from XML file and cache model elements.
    const mj_spec = mj.MjSpec.from_file(xml_path);
    console.assert(mj_spec.compiler.degree === true);

    const actuators = mj_spec.actuators;
    console.assert(actuators.length === 38);
    console.assert(actuators.every(a => a.trntype === 'mjTRN_JOINT' || a.trntype === 'mjTRN_TENDON'));
    const actuateds = actuators.map(a =>
      a.trntype === 'mjTRN_JOINT' ? mj_spec.joint(a.target) : mj_spec.tendon(a.target));

    // Set contact mode of collision geoms. (Geom edits are baked into the exported model.)
    let termination_contact_geoms: string[];
    switch (contact_mode) {
      case 'trunk-limbs':
        termination_contact_geoms = [
          'torso_collision',
          'pelvis_gut_collision',
          'humerus_L_collision',
          'humerus_R_collision',
          'upper_leg_L_collision',
          'upper_leg_R_collision',
        ];
        break;
      case 'foot':
      case 'no-self':
      case 'all':
        termination_contact_geoms = [];
        break;
      default:
        throw new Error(`ValueError: Invalid \`contact_mode\`: ${contact_mode}`);
    }

    // Identify observation/action constraints.
    const actionable_dofs_ = collections.dict(actionable_dofs);
    console.assert(
      actionable_dofs_.keys().every(k => RAT_ACTUATORS.has(k)),
      `Invalid \`actionable_dofs\` keys: ${actionable_dofs_.keys().filter(k => !RAT_ACTUATORS.has(k))}`,
    );
    const actionable = new collections.OrderedDict<string[]>(
      RAT_ACTUATORS.keys().map(k => [k, actionable_dofs_.get(k, [] as string[])] as [string, string[]]),
    );

    // Set passive forces.
    const passive_transforms: cx.Transform<MjxEnvState, any>[] = [];
    for (const [segment] of RAT_ACTUATORS.items()) {
      passive_transforms.push(
        new cxt.ProportionalDerivativeController<MjxEnvState>({
          actionable_pos: null,
          actionable_vel: null,
          actionable_kp: null,
          actionable_kd: null,
          actionable_trq: null,
          pos_default: RAT_ACTUATORS_POS_MID.getitem(segment),
          kp: passive_kp.getitem(segment),
          kd: passive_kd.getitem(segment),
          obskey_pos: `proprio_pos_${segment}`,
          obskey_vel: `proprio_vel_${segment}`,
          actkey_trq: `actuators_trq_${segment}`,
          additive_trq: true,
        }),
      );
    }

    // Prevent uncontrolled actuators from being actuated by overriding their torques to zero.
    const override_action_transform = actionable.size ? new cxt.OverrideAction<MjxEnvState>(
      new collections.Dict(RAT_ACTUATORS.items()
        .filter(([segment]) => actionable.getitem(segment).length)
        .map(([segment, names]) => [
          `actuators_trq_${segment}`,
          names.map(name => actionable.getitem(segment).includes(name) ? null : 0.0),
        ] as [string, (number | null)[]])),
    ) : null;

    // Set controller transforms.
    const controller_transforms: cx.Transform<MjxEnvState, any>[] = [];
    let controller_actkey_prefixes: string[] = [];
    const controller_obskey_prefixes: string[] = [];
    if (controller === 'position') {
      controller_actkey_prefixes = ['actuators_pos'];
      for (const [segment] of RAT_ACTUATORS.items()) {
        if (!actionable.getitem(segment).length) continue;
        controller_transforms.push(new cxt.ProportionalDerivativeController<MjxEnvState>({
          actionable_pos: `actuators_pos_${segment}`,
          actionable_kp: null,
          kp: RAT_ACTUATORS_KP.getitem(segment),
          kd: RAT_ACTUATORS_KD.getitem(segment),
          obskey_pos: `proprio_pos_${segment}`,
          obskey_vel: `proprio_vel_${segment}`,
          actkey_trq: `actuators_trq_${segment}`,
          additive_trq: true,
        }));
      }
    } else if (controller === 'position-stiffness') {
      throw new Error("NotImplementedError: controller='position-stiffness' is not ported.");
    } else if (controller instanceof cx.Transform) {
      controller_transforms.push(controller);
    } else if (controller !== null) {
      controller_transforms.push(...collections.dict(controller).values());
    }

    // Set observation/action rescale transforms.
    const rescale_transforms: cx.Transform<MjxEnvState, any>[] = [];
    switch (rescale_mode) {
      case 'setpoint_delta': {
        const obs_min = new collections.Dict<number[]>(), obs_mid = new collections.Dict<number[]>(), obs_max = new collections.Dict<number[]>();
        const act_min = new collections.Dict<number[] | number>(), act_mid = new collections.Dict<number[] | number>(), act_max = new collections.Dict<number[] | number>();
        const act_exclude: string[] = [];
        for (const segment of RAT_ACTUATORS.keys()) {
          if (!actionable.getitem(segment).length) continue;
          obs_min.setitem(`proprio_pos_${segment}`, RAT_ACTUATORS_POS_MIN.getitem(segment));
          obs_mid.setitem(`proprio_pos_${segment}`, RAT_ACTUATORS_POS_MID.getitem(segment));
          obs_max.setitem(`proprio_pos_${segment}`, RAT_ACTUATORS_POS_MAX.getitem(segment));
          act_min.setitem(`actuators_pos_${segment}`, RAT_ACTUATORS_POS_MIN.getitem(segment));
          act_min.setitem(`actuators_kp_${segment}`, 0.);
          act_mid.setitem(`actuators_pos_${segment}`, RAT_ACTUATORS_POS_MID.getitem(segment));
          act_mid.setitem(`actuators_kp_${segment}`, 0.);
          act_max.setitem(`actuators_pos_${segment}`, RAT_ACTUATORS_POS_MAX.getitem(segment));
          act_max.setitem(`actuators_kp_${segment}`, RAT_ACTUATORS_KP.getitem(segment));
          act_exclude.push(`muscle_flx_${segment}`, `muscle_ext_${segment}`);
        }
        if (rescale_observations && obs_min.size) {
          rescale_transforms.push(new cxt.RescaleObservation({ min: obs_min, mid: obs_mid, max: obs_max, signed: true }));
        }
        if (rescale_actions && act_min.size) {
          rescale_transforms.push(new cxt.RescaleAction({ min: act_min, mid: act_mid, max: act_max, signed: true, exclude: act_exclude }));
        }
        break;
      }
      case 'limits': {
        const obs_scale = new collections.Dict<number[]>(), obs_signed = new collections.Dict<boolean>();
        const act_scale = new collections.Dict<number[]>(), act_signed = new collections.Dict<boolean>();
        const act_exclude: string[] = [];
        for (const segment of RAT_ACTUATORS.keys()) {
          if (!actionable.getitem(segment).length) continue;
          obs_scale.setitem(`proprio_pos_${segment}`, [0., 1.]);
          obs_signed.setitem(`proprio_pos_${segment}`, false);
          act_scale.setitem(`actuators_pos_${segment}`, [0., 1.]);
          act_scale.setitem(`actuators_kp_${segment}`, [0., 1.]);
          act_signed.setitem(`actuators_pos_${segment}`, false);
          act_exclude.push(`muscle_flx_${segment}`, `muscle_ext_${segment}`);
        }
        if (rescale_observations && obs_scale.size) {
          rescale_transforms.push(new cxt.RescaleObservation({ scale: obs_scale, signed: obs_signed }));
        }
        if (rescale_actions && act_scale.size) {
          rescale_transforms.push(new cxt.RescaleAction({ scale: act_scale, signed: act_signed, exclude: act_exclude }));
        }
        break;
      }
      default:
        throw new Error(`ValueError: Invalid \`rescale_mode\`: ${rescale_mode}`);
    }

    // Mask the Rat observations and actions to only include actively controlled actuators.
    const reduce_observation = new collections.Dict<number[]>();
    const reduce_action = new collections.Dict<(number | null)[]>();
    for (const [segment, names] of RAT_ACTUATORS.items()) {
      // Remove uncontrolled observations from model view.
      const indices = actionable.getitem(segment).map(name => names.indexOf(name));
      reduce_observation.setitem(`proprio_pos_${segment}`, indices);
      reduce_observation.setitem(`proprio_vel_${segment}`, indices);
      reduce_observation.setitem(`proprio_trq_${segment}`, indices);
      for (const obskey_prefix of controller_obskey_prefixes) {
        reduce_observation.setitem(`${obskey_prefix}_${segment}`, indices);
      }
      // Remove uncontrolled actions from model view. The fallback actions can be zero because
      // the controller output torques will be ignored, anyway.
      const act_mask = names.map(name => actionable.getitem(segment).includes(name) ? null : 0.0);
      if (act_mask.some(x => x !== null)) {
        for (const actkey_prefix of controller_actkey_prefixes) {
          reduce_action.setitem(`${actkey_prefix}_${segment}`, act_mask);
        }
      }
      reduce_action.setitem(`actuators_trq_${segment}`, names.map(() => 0));
    }
    const interface_transforms: cx.Transform<MjxEnvState, any>[] = [
      new cxt.ReduceObservation(reduce_observation),
      new cxt.ReduceAction(reduce_action),
    ];

    super({
      transforms: [
        // Substep transforms.
        new cxt.ClipAction(),
        ...passive_transforms,        // Passive forces.
        override_action_transform,    // Override uncontrolled actuators to zero torque.
        ...controller_transforms,     // Active controller transforms.
        ...rescale_transforms,        // Rescale observations and actions.
        ...interface_transforms,      // Mask out observations and actions for uncontrolled actuators.
        new cxt.ClipAction(),
        // Step transforms.
        ...transforms,
      ],
      mj_spec: mj_spec,
      local_state: new RatState(),
    });

    this._observable_proprio = observable_proprio;
    this._observable_tactile = observable_tactile;
    this._observable_vestibular = observable_vestibular;
    this._observable_visual = observable_visual;
    if (observable_vestibular || observable_visual) {
      throw new Error('NotImplementedError: vestibular/visual observations are not ported.');
    }

    this._actuators = actuators;
    this._actuateds = actuateds;
    this._actuator_names = actuators.map(a => a.name);

    this._root_body = mj_spec.body('torso');
    this._root_joint = mj_spec.joint('torso');
    this._root_global_linvel = mj_spec.sensor('global_linvel');
    this._root_global_angvel = mj_spec.sensor('global_angvel');
    this._head_quaternion = mj_spec.sensor('quaternion');

    this._foot_names = ['FL', 'FR', 'HL', 'HR'];
    this._foot_touch = this._foot_names.flatMap(x => ['digit', 'paw'].map(i => mj_spec.sensor(`${x}_touch_${i}`)));

    this._termination_contact_geoms = termination_contact_geoms;
    this._actionable_dofs = actionable;

    // Define initial pos for each episode.
    this._root_pos_init = jnp.asarray(root_pos_init);
    console.assert(this._root_pos_init.shape.join() === '3');
    this._root_quat_init = jnp.asarray(root_quat_init);
    console.assert(this._root_quat_init.shape.join() === '4');
    this._joints_pos_init = jnp.asarray(joints_pos_init);
    console.assert(this._joints_pos_init.shape.join() === '55');
  }

  override initialize(state: MjxEnvState, context: cx.Context): [MjxEnvState, cx.Context] {
    context['actuators'] = this._actuators;
    return [state, context];
  }

  override action_space(state: MjxEnvState): cx.Dict {
    const space = new cx.Dict();
    const low = jnp.array(this._actuators.map(a => state.mjx_model.bind(a).ctrlrange.index(0).item()));
    const high = jnp.array(this._actuators.map(a => state.mjx_model.bind(a).ctrlrange.index(1).item()));
    for (const [segment, actuators] of RAT_ACTUATORS.items()) {
      const indices = actuators.map(a => RAT_ACTUATOR_NAMES.indexOf(a));
      const labels = [indices.map(i => this._actuator_names[i])];
      space.setitem(`actuators_trq_${segment}`, new cx.Box({
        low: jnp.take(low, indices),
        high: jnp.take(high, indices),
        name: `actuators_trq_${segment}`,
        desc: `Actuator output torques (N.m) for ${segment}`,
        labels: labels,
      }));
    }
    return space;
  }

  override action(state: MjxEnvState, action: cx.ArrayDict): MjxEnvState {
    const actuators = state.mjx_data.bind(state.mjx_model, this._actuators);
    const actuators_trq = jnp.concat(RAT_ACTUATORS.keys().map(segment => action.getitem(`actuators_trq_${segment}`)));
    const mjx_data = actuators.set('ctrl', actuators_trq);
    return state.replace({ mjx_data: mjx_data });
  }

  /**
   * Actuators are ordered rostral-to-caudal, left-to-right, and proximal-to-distal (see
   * `RAT_ACTUATORS`).
   */
  override observation_space(state: MjxEnvState): cx.ObservationSpace {
    const space = new cx.Dict();
    if (this._observable_proprio) {
      const limits = this._actuateds.map(a =>
        a instanceof mj.MjsJoint ? np_deg2rad(a.range) : a.range);  // [38, 2], (rad)
      const n = this._actuators.length;
      // Ungrouped actuator spaces.
      const boxes = new collections.OrderedDict<cx.Box>([
        ['proprio_pos', new cx.Box({
          low: limits.map(l => l[0]),
          high: limits.map(l => l[1]),
          name: 'proprio_pos',
          desc: 'Proprioceptive actuator angular positions (rad)',
        })],
        ['proprio_vel', new cx.Box({
          low: jnp.ones(n).mul(-RAT_VEL_MAX),
          high: jnp.ones(n).mul(+RAT_VEL_MAX),
          name: 'proprio_vel',
          desc: 'Proprioceptive actuator angular velocities (rad/s)',
        })],
        ['proprio_trq', new cx.Box({
          low: jnp.ones(n).mul(-RAT_TRQ_MAX),
          high: jnp.ones(n).mul(+RAT_TRQ_MAX),
          name: 'proprio_trq',
          desc: 'Proprioceptive actuator output torques (N.m) and forces (N)',
        })],
      ]);
      // Split ungrouped actuator spaces into grouped segment spaces.
      for (const [key, box] of boxes.items()) {
        for (const [segment, actuators] of RAT_ACTUATORS.items()) {
          const indices = actuators.map(a => RAT_ACTUATOR_NAMES.indexOf(a));
          const labels = [indices.map(i => this._actuator_names[i])];
          const name = `${key}_${segment}`;
          space.setitem(name, new cx.Box({
            low: jnp.take(box.low, indices),
            high: jnp.take(box.high, indices),
            name: name,
            desc: box.desc + ` for ${segment}`,
            labels: labels,
          }));
        }
      }
    }
    if (this._observable_tactile) {
      for (const foot_name of this._foot_names) {
        const labels = [['digit', 'paw'].map(i => `${foot_name}_${i}`)];
        space.setitem(`tactile_limb${foot_name}`, new cx.Box({
          low: jnp.zeros(2),
          high: jnp.ones(2).mul(RAT_FOOT_MAX),
          name: `tactile_limb${foot_name}:[digit,paw]`,
          desc: `Tactile contact forces (N) for ${foot_name}`,
          labels: labels,
        }));
      }
    }
    return space;
  }

  override observation(state: MjxEnvState): [cx.ArrayDict, MjxEnvState] {
    const observation: cx.ArrayDict = new collections.OrderedDict();
    if (this._observable_proprio) {
      for (const [key, value] of [
        ['proprio_pos', this.get_proprio_pos(state)],
        ['proprio_vel', this.get_proprio_vel(state)],
        ['proprio_trq', this.get_proprio_trq(state)],
      ] as [string, jnp.Array][]) {
        for (const [segment, actuators] of RAT_ACTUATORS.items()) {
          const indices = actuators.map(a => RAT_ACTUATOR_NAMES.indexOf(a));
          observation.setitem(`${key}_${segment}`, jnp.take(value, indices));
        }
      }
    }
    if (this._observable_tactile) {
      const tactile_foot = this.get_tactile_foot(state);
      this._foot_names.forEach((foot_name, i) => {
        observation.setitem(`tactile_limb${foot_name}`, jnp.slice(tactile_foot, 2 * i, 2 * i + 2));
      });
    }
    return [observation, state];
  }

  // ------------------------------------------------------------------------------------------------
  // Getters (observable properties)

  get_actuators(): string[] {
    return this._actuator_names;
  }

  get_termination_contact_geoms(): string[] {
    return this._termination_contact_geoms;
  }

  // ------------------------------------------------------------------------------------------------
  // Getters (observable data)

  private split_actuateds(): [number[], mj.MjsJoint[], number[], mj.MjsTendon[]] {
    const jidxs: number[] = [], js: mj.MjsJoint[] = [], tidxs: number[] = [], ts: mj.MjsTendon[] = [];
    this._actuateds.forEach((x, i) => {
      if (x instanceof mj.MjsJoint) { jidxs.push(i); js.push(x); } else { tidxs.push(i); ts.push(x); }
    });
    return [jidxs, js, tidxs, ts];
  }

  get_proprio_pos(state: MjxEnvState): jnp.Array {
    const [jidxs, js, tidxs, ts] = this.split_actuateds();
    let pos = jnp.zeros(this._actuateds.length);
    pos = jnp.at(pos, jidxs).set(state.mjx_data.bind(state.mjx_model, js).qpos);  // [30]
    pos = jnp.at(pos, tidxs).set(state.mjx_data.bind(state.mjx_model, ts).length);  // [8]
    return pos;  // [38]
  }

  get_proprio_vel(state: MjxEnvState): jnp.Array {
    const [jidxs, js, tidxs, ts] = this.split_actuateds();
    let vel = jnp.zeros(this._actuateds.length);
    vel = jnp.at(vel, jidxs).set(state.mjx_data.bind(state.mjx_model, js).qvel);  // [30]
    vel = jnp.at(vel, tidxs).set(state.mjx_data.bind(state.mjx_model, ts).velocity);  // [8]
    return vel;  // [38]
  }

  get_proprio_trq(state: MjxEnvState): jnp.Array {
    return state.mjx_data.bind(state.mjx_model, this._actuators).force;  // [38]
  }

  get_tactile_foot(state: MjxEnvState): jnp.Array {
    return jnp.slice(state.mjx_data.bind(state.mjx_model, this._foot_touch).sensordata, null, 8);  // [8]
  }

  get_sensor_quat(state: MjxEnvState): jnp.Array {
    return jnp.slice(state.mjx_data.bind(state.mjx_model, this._head_quaternion).sensordata, null, 4);  // [4]
  }

  get_sensor_rpy(state: MjxEnvState): jnp.Array {
    return cxm.quat_to_rpy(this.get_sensor_quat(state));  // [3]
  }

  // ------------------------------------------------------------------------------------------------
  // Getters (privledged data)

  get_root_global_linvel(state: MjxEnvState): jnp.Array {
    return jnp.slice(state.mjx_data.bind(state.mjx_model, this._root_global_linvel).sensordata, null, 3);  // [3]
  }

  get_root_global_angvel(state: MjxEnvState): jnp.Array {
    return jnp.slice(state.mjx_data.bind(state.mjx_model, this._root_global_angvel).sensordata, null, 3);  // [3]
  }

  get_root_global_pos(state: MjxEnvState): jnp.Array {
    return jnp.slice(state.mjx_data.bind(state.mjx_model, this._root_body).xpos, null, 3);  // [3]
  }

  get_root_global_quat(state: MjxEnvState): jnp.Array {
    return jnp.slice(state.mjx_data.bind(state.mjx_model, this._root_body).xquat, null, 4);  // [4]
  }

  // ------------------------------------------------------------------------------------------------
  // Setters

  /** Set the root body position and orientation using a quaternion. */
  set_root_pos_quat(state: MjxEnvState, pos: jnp.Array, quat: jnp.Array): MjxEnvState {
    const root_joint = state.mjx_data.bind(state.mjx_model, this._root_joint);
    const mjx_data = root_joint.set('qpos', jnp.concatenate([pos, quat]));
    return state.replace({ mjx_data: mjx_data });
  }

  /** Set the root body linear velocity [vx, vy, vz] and angular velocity [wx, wy, wz]. */
  set_root_vel(state: MjxEnvState, linvel: jnp.Array, angvel: jnp.Array): MjxEnvState {
    const root_joint = state.mjx_data.bind(state.mjx_model, this._root_joint);
    const mjx_data = root_joint.set('qvel', jnp.concatenate([linvel, angvel]));
    return state.replace({ mjx_data: mjx_data });
  }

  /** Apply a perturbation force [x, y, z] and torque [x, y, z] to the root body. */
  set_root_perturbation(state: MjxEnvState, xfrc: jnp.Array, xtrq: jnp.Array): MjxEnvState {
    const root_body = state.mjx_data.bind(state.mjx_model, this._root_body);
    const mjx_data = root_body.set('xfrc_applied', jnp.concatenate([xfrc, xtrq]));
    return state.replace({ mjx_data: mjx_data });
  }

  /** Set the joint positions (excluding root). */
  set_joints_pos(state: MjxEnvState, pos: jnp.Array): MjxEnvState {
    const joints = this.mj_spec.joints.filter(j => j.name !== 'torso');  // Exclude root joint.
    const mjx_data = state.mjx_data.bind(state.mjx_model, joints).set('qpos', pos);
    return state.replace({ mjx_data: mjx_data });
  }

  /** Set the joint velocities (excluding root). */
  set_joints_vel(state: MjxEnvState, vel: jnp.Array): MjxEnvState {
    const joints = this.mj_spec.joints.filter(j => j.name !== 'torso');  // Exclude root joint.
    const mjx_data = state.mjx_data.bind(state.mjx_model, joints).set('qvel', vel);
    return state.replace({ mjx_data: mjx_data });
  }

  // ------------------------------------------------------------------------------------------------
  // Initializers

  /** Set the initial positions and velocities. */
  init_pose(state: MjxEnvState): MjxEnvState {
    state = this.set_root_pos_quat(state, this._root_pos_init, this._root_quat_init);
    state = this.set_root_vel(state, jnp.zeros(3), jnp.zeros(3));
    state = this.set_joints_pos(state, this._joints_pos_init);
    state = this.set_joints_vel(state, jnp.zeros_like(this._joints_pos_init));
    return state;
  }
}
