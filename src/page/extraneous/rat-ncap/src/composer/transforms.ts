/**
 * Port of `libs/composer/transforms.py` (subset).
 *
 * Ported: `ClipAction`, `RescaleObservation`, `RescaleAction`, `ReduceAction`, `OverrideAction`,
 * `ReduceObservation`, `ProportionalDerivativeController`, `SpringMuscleController`, and helpers.
 * Not ported: `BufferObservationSubsteps`, `BufferActionSubsteps`, `MapAction`.
 */
import * as jnp from '../jax/numpy';
import * as collections from '../utils/collections';
import * as core from './core';
import * as math from './math';

type State = core.BaseEnvState;
type MappingLike<V> = collections.Mapping<V> | Record<string, V>;

export class ClipAction<EnvState extends State> extends core.Transform<EnvState, null> {
  keys: string[] | null;

  constructor({ keys = null }: { keys?: Iterable<string> | null } = {}) {
    super();
    this.keys = keys !== null ? [...keys] : null;
  }

  override action(space: core.ActionSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    const keys = this.keys !== null ? this.keys : space.keys();
    const act: core.ArrayDict = new collections.OrderedDict();
    for (let [k, v] of value.items()) {
      if (keys.includes(k)) {
        const sp = space.getitem(k);
        if (sp instanceof core.Box) {
          v = jnp.clip(v, sp.low, sp.high);
        }
      }
      act.setitem(k, v);
    }
    return [act, state];
  }

  override action_space(space: core.ActionSpace, state: EnvState): core.ActionSpace {
    // Action space remains the same.
    return space;
  }
}

// ==================================================================================================
// Rescaling

type Scale = [number, number, number];
type PerKey<V> = V | collections.Dict<V>;

function to_scale(v: number[]): Scale {
  console.assert(2 <= v.length && v.length <= 3, `Must provide (min, max) or (min, mid, max) scale: ${v}`);
  return [v[0], v.length === 3 ? v[1] : (v[0] + v.at(-1)!) / 2, v.at(-1)!];
}

function per_key<V, W>(
  x: W | MappingLike<V> | null,
  is_scalar: (x: unknown) => x is W,
  convert: (v: V) => unknown,
): unknown {
  if (x === null) return new collections.Dict();
  if (is_scalar(x)) return x;
  return new collections.Dict(
    collections.dict(x as MappingLike<V>).items().map(([k, v]) => [k, convert(v)] as [string, unknown]),
  );
}

const is_number = (x: unknown): x is number => typeof x === 'number';
const is_bool = (x: unknown): x is boolean => typeof x === 'boolean';
const is_sequence = (x: unknown): x is number[] => Array.isArray(x);

interface RescaleParams { min: jnp.Array, mid: jnp.Array, max: jnp.Array, scale: Scale }

interface RescaleKwargs {
  min?: number | MappingLike<math.ArrayLike> | null;
  mid?: number | MappingLike<math.ArrayLike> | null;
  max?: number | MappingLike<math.ArrayLike> | null;
  scale?: number[] | MappingLike<number[]>;
  signed?: boolean | MappingLike<boolean>;
  exclude?: Iterable<string>;
}

/** Shared constructor and per-key parameter resolution of `RescaleObservation`/`RescaleAction`. */
class Rescale<EnvState extends State> extends core.Transform<EnvState, null> {
  min: PerKey<number[]> | number;
  mid: PerKey<number[]> | number;
  max: PerKey<number[]> | number;
  scale: Scale | collections.Dict<Scale>;
  signed: boolean | collections.Dict<boolean>;
  exclude: string[];

  constructor({
    min = null,
    mid = null,
    max = null,
    scale = [-1., 0., +1.],
    signed = true,
    exclude = [],
  }: RescaleKwargs = {}) {
    super();
    // Python truthiness: `None`, `0`, and empty mappings are falsy.
    const given = (x: number | MappingLike<math.ArrayLike> | null) =>
      x !== null && (typeof x === 'number' ? x !== 0 : collections.dict(x).size > 0);
    console.assert((given(min) && given(max)) || (!given(min) && !given(max)), 'Must provide neither or both min and max');

    this.min = per_key(min, is_number, math.float_tuple) as PerKey<number[]> | number;
    this.mid = per_key(mid, is_number, math.float_tuple) as PerKey<number[]> | number;
    this.max = per_key(max, is_number, math.float_tuple) as PerKey<number[]> | number;
    this.scale = is_sequence(scale) ? to_scale(scale) : per_key(scale, (x): x is never => false, to_scale) as collections.Dict<Scale>;
    this.signed = is_bool(signed) ? signed : per_key(signed, (x): x is never => false, Boolean) as collections.Dict<boolean>;
    this.exclude = [...exclude];
  }

  private _params_cache = new Map<string, WeakMap<core.Box, RescaleParams>>();

  /**
   * Resolves (min, mid, max) and the target scale for key `k` with space `sp`. Cached per space,
   * since the result only depends on this transform's configuration and the space.
   */
  protected params(k: string, sp: core.Box): RescaleParams {
    if (!this._params_cache.has(k)) this._params_cache.set(k, new WeakMap());
    const cache = this._params_cache.get(k)!;
    let params = cache.get(sp);
    if (params === undefined) {
      params = this.compute_params(k, sp);
      cache.set(sp, params);
    }
    return params;
  }

  private compute_params(k: string, sp: core.Box): RescaleParams {
    const signed = this.signed instanceof collections.Dict ? this.signed.get(k, true) : this.signed;
    const scale = this.scale instanceof collections.Dict ? this.scale.get(k, [-1., 0., +1.] as Scale) : this.scale;
    const lookup = (x: PerKey<number[]> | number, default_: jnp.Array) =>
      x instanceof collections.Dict ? x.get(k, default_) : x;
    const min = jnp.asarray(lookup(this.min, sp.low));
    const max = jnp.asarray(lookup(this.max, sp.high));
    let mid = jnp.asarray(
      this.mid instanceof collections.Dict
        ? this.mid.get(k, signed ? 0. : min.add(max).div(2))
        : this.mid,
    );
    mid = jnp.clip(mid, min, max);  // Ensure mid is within [min, max] for when 0 is outside range.
    return { min, mid, max, scale };
  }

  protected rescale_space(space: core.Dict): core.Dict {
    const out = new core.Dict();
    for (const [k, sp] of space.items()) {
      if (this.exclude.includes(k) || !(sp instanceof core.Box)) {
        // Don't transform excluded keys or non-Box spaces.
        out.setitem(k, sp);
        continue;
      }
      const { min, mid, max, scale } = this.params(k, sp);
      const low = math.rescale_linear3(min, min, mid, max, scale[0], scale[1], scale[2], { clip: true });
      const high = math.rescale_linear3(max, min, mid, max, scale[0], scale[1], scale[2], { clip: true });
      out.setitem(k, new core.Box({
        low: jnp.broadcast_to(low, sp.shape),
        high: jnp.broadcast_to(high, sp.shape),
        shape: sp.shape,
        dtype: sp.dtype,
        name: sp.name,
        desc: sp.desc,
        labels: sp.labels,
      }));
    }
    return out;
  }
}

export class RescaleObservation<EnvState extends State> extends Rescale<EnvState> {
  override observation(space: core.ObservationSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    const obs: core.ArrayDict = new collections.OrderedDict();
    for (const [k, v] of value.items()) {
      const sp = space.getitem(k);
      if (this.exclude.includes(k) || !(sp instanceof core.Box)) {
        // Don't transform excluded keys or non-Box spaces.
        obs.setitem(k, v);
        continue;
      }
      const { min, mid, max, scale } = this.params(k, sp);
      const y = math.rescale_linear3(v, min, mid, max, scale[0], scale[1], scale[2], { clip: true });
      obs.setitem(k, y);
    }
    return [obs, state];
  }

  override observation_space(space: core.ObservationSpace, state: EnvState): core.ObservationSpace {
    return this.rescale_space(space);
  }
}

export class RescaleAction<EnvState extends State> extends Rescale<EnvState> {
  override action(space: core.ActionSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    const act: core.ArrayDict = new collections.OrderedDict();
    for (const [k, v] of value.items()) {
      const sp = space.getitem(k);
      if (this.exclude.includes(k) || !(sp instanceof core.Box)) {
        // Don't transform excluded keys or non-Box spaces.
        act.setitem(k, v);
        continue;
      }
      const { min, mid, max, scale } = this.params(k, sp);
      const y = math.rescale_linear3(v, scale[0], scale[1], scale[2], min, mid, max, { clip: true });
      act.setitem(k, y);
    }
    return [act, state];
  }

  override action_space(space: core.ActionSpace, state: EnvState): core.ActionSpace {
    return this.rescale_space(space);
  }
}

// ==================================================================================================
// Reduction and overrides

/** From 'foo_bar:[a,b,c]', extract ('foo_bar', ['a', 'b', 'c']). */
export function extract_name_components(sp: core.Space<unknown>): [string, string[] | null] {
  const match = /^([^:]+):\[(.+)\]$/.exec(sp.name);
  if (match === null) {
    return [sp.name, null];
  }
  return [match[1], match[2].split(',')];
}

/** Reduce 'foo_bar:[a,b,c]' to 'foo_bar:[a,c]' given indices [0, 2]. */
export function reduce_name_components(sp: core.Space<unknown>, uidxs: number[], replace_prefix: string | null = null): string {
  const [key, names] = extract_name_components(sp);
  if (names === null || uidxs.some(i => i < 0 || i >= names.length)) {
    return sp.name;
  }
  const name = uidxs.map(i => names[i]).join(',');
  return `${replace_prefix === null ? key : replace_prefix}:[${name}]`;
}

function reduce_labels(sp: core.Box, idxs: number[]): core.Labels | null {
  if (!sp.labels) return sp.labels;
  return typeof sp.labels[0] === 'string' ? [sp.labels[0]] : [idxs.map(i => (sp.labels![0] as string[])[i])];
}

export class ReduceAction<EnvState extends State> extends core.Transform<EnvState, null> {
  cvalues: collections.Dict<number[]>;
  cidxs: collections.Dict<number[]>;
  uidxs: collections.Dict<number[]>;

  constructor(constrain: MappingLike<(number | null)[]> = {}) {
    super();
    this.cvalues = new collections.Dict();
    this.cidxs = new collections.Dict();
    this.uidxs = new collections.Dict();
    for (const [k, v] of collections.dict(constrain).items()) {
      if (v.length === 0) continue;
      this.cvalues.setitem(k, v.filter(x => x !== null) as number[]);
      this.cidxs.setitem(k, v.flatMap((x, i) => x !== null ? [i] : []));
      this.uidxs.setitem(k, v.flatMap((x, i) => x === null ? [i] : []));
    }
  }

  override action(space: core.ActionSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    const act: core.ArrayDict = new collections.OrderedDict();
    for (const [k, sp] of space.items()) {
      if (!this.cvalues.has(k)) {
        // If no constraints, keep original.
        act.setitem(k, value.getitem(k));
        continue;
      }

      // Construct an array of the original size, copying over constrained and unconstrained values.
      const cvalues = jnp.asarray(this.cvalues.getitem(k));
      const cidxs = this.cidxs.getitem(k);
      const uidxs = this.uidxs.getitem(k);
      let y = jnp.zeros(sp.shape, { dtype: sp.dtype });
      y = jnp.at(y, cidxs).set(cvalues);
      if (uidxs.length > 0) {
        // Must check since value[k] does not exist when all indices are constrained, as the key is
        // removed entirely from the action space.
        y = jnp.at(y, uidxs).set(value.getitem(k));
      }
      act.setitem(k, y);
    }
    return [act, state];
  }

  override action_space(space: core.ActionSpace, state: EnvState): core.ActionSpace {
    const act_space = new core.Dict();
    for (const [k, sp] of space.items()) {
      if (!this.cvalues.has(k)) {
        // If no constraints, keep original.
        act_space.setitem(k, sp);
        continue;
      }

      const uidxs = this.uidxs.getitem(k);
      if (uidxs.length === 0) {
        // If all indices are constrained, remove the key entirely.
        continue;
      }
      console.assert(sp.shape.length === 1, `Only 1D Box spaces are supported: ${k} has shape [${sp.shape}]`);
      act_space.setitem(k, new core.Box({
        low: jnp.take(sp.low, uidxs),
        high: jnp.take(sp.high, uidxs),
        shape: [uidxs.length],
        dtype: sp.dtype,
        name: reduce_name_components(sp, uidxs),
        desc: sp.desc,
        labels: reduce_labels(sp, uidxs),
      }));
    }
    return act_space;
  }
}

/** Override action values at specified indices to be constants without modifying the action space. */
export class OverrideAction<EnvState extends State> extends core.Transform<EnvState, null> {
  ovalues: collections.Dict<number[]>;
  oidxs: collections.Dict<number[]>;

  constructor(override: MappingLike<(number | null)[]> = {}) {
    super();
    this.ovalues = new collections.Dict();
    this.oidxs = new collections.Dict();
    for (const [k, v] of collections.dict(override).items()) {
      const oidxs = v.flatMap((x, i) => x !== null ? [i] : []);
      if (oidxs.length === 0) continue;
      this.ovalues.setitem(k, v.filter(x => x !== null) as number[]);
      this.oidxs.setitem(k, oidxs);
    }
  }

  override action(space: core.ActionSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    const act: core.ArrayDict = new collections.OrderedDict();
    for (const [k, v] of value.items()) {
      if (!this.ovalues.has(k)) {
        // If no overrides, keep original.
        act.setitem(k, v);
        continue;
      }

      // Overwrite only the specified indices; leave the rest of the value untouched.
      const ovalues = jnp.asarray(this.ovalues.getitem(k));
      act.setitem(k, jnp.at(v, this.oidxs.getitem(k)).set(ovalues));
    }
    return [act, state];
  }
}

export class ReduceObservation<EnvState extends State> extends core.Transform<EnvState, null> {
  idxs: collections.Dict<boolean | number[]>;

  constructor(filter: MappingLike<boolean | number[]> = {}) {
    super();
    this.idxs = new collections.Dict();
    for (const [k, v] of collections.dict(filter).items()) {
      if (typeof v === 'boolean') {
        this.idxs.setitem(k, v);
      } else if (v.length === 0) {
        // If no specified indices, remove the key entirely.
        this.idxs.setitem(k, false);
      } else {
        // Since specified indices are not sorted, they can both filter and reorder values.
        this.idxs.setitem(k, math.int_tuple(v));
      }
    }
  }

  override observation(space: core.ObservationSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    const obs: core.ArrayDict = new collections.OrderedDict();
    for (const [k, v] of value.items()) {
      const sp = space.getitem(k);
      if (!this.idxs.has(k)) {
        // If no filter, keep original.
        obs.setitem(k, v);
        continue;
      }

      const idxs = this.idxs.getitem(k);
      if (typeof idxs === 'boolean') {
        // If filter is bool, keep or remove the key entirely.
        if (idxs) {
          obs.setitem(k, v);
        }
      } else {
        // If filter is tuple, keep only values at the specified indices.
        console.assert(sp.shape.length === 1, `Only 1D Box spaces are supported: ${k} has shape [${sp.shape}]`);
        obs.setitem(k, jnp.take(v, idxs));
      }
    }
    return [obs, state];
  }

  override observation_space(space: core.ObservationSpace, state: EnvState): core.ObservationSpace {
    const obs_space = new core.Dict();
    for (const [k, sp] of space.items()) {
      if (!this.idxs.has(k)) {
        // If no filter, keep original.
        obs_space.setitem(k, sp);
        continue;
      }

      const idxs = this.idxs.getitem(k);
      if (typeof idxs === 'boolean') {
        // If filter is bool, keep or remove the key entirely.
        if (idxs) {
          obs_space.setitem(k, sp);
        }
      } else {
        // If filter is array, keep only values at the specified indices.
        console.assert(sp.shape.length === 1, `Only 1D Box spaces are supported: ${k} has shape [${sp.shape}]`);
        obs_space.setitem(k, new core.Box({
          low: jnp.take(sp.low, idxs),
          high: jnp.take(sp.high, idxs),
          shape: [idxs.length],
          dtype: sp.dtype,
          name: reduce_name_components(sp, idxs),
          desc: sp.desc,
          labels: reduce_labels(sp, idxs),
        }));
      }
    }
    return obs_space;
  }
}

/** Transform a Box space to with new bounds or metadata. */
function _transform_box(
  space: core.Box,
  {
    name = '',
    desc = '',
    name_prefix = '',
    desc_prefix = '',
    low = null,
    high = null,
    labels = null,
  }: {
    name?: string,
    desc?: string,
    name_prefix?: string,
    desc_prefix?: string,
    low?: jnp.Array | null,
    high?: jnp.Array | null,
    labels?: core.Labels | null,
  } = {},
): core.Box {
  if (name) {
    // Use new name.
  } else if (name_prefix) {
    // Replace name prefix "foo:..." -> "bar:...".
    name = space.name.replace(/^[^:]+:/, `${name_prefix}:`);
  } else {
    name = space.name;
  }

  if (desc) {
    // Use new description.
  } else if (desc_prefix) {
    // Prepend description prefix "World" -> "Hello world" (lowercased first).
    desc = space.desc;
    desc = desc ? desc[0].toLowerCase() + desc.slice(1) : '';
    desc = desc ? `${desc_prefix} ${desc}` : desc_prefix;
  } else {
    desc = space.desc;
  }

  return space.replace({
    low: low ?? space.low,
    high: high ?? space.high,
    name: name,
    desc: desc,
    labels: labels ?? space.labels,
  });
}

// ==================================================================================================
// Controllers

const EMPTY_BOX = () => new core.Box({ low: 0, high: 0 });

export class ProportionalDerivativeControllerState extends core.BaseLocalState {
  trq_space: core.Box = EMPTY_BOX();
  pos_space: core.Box = EMPTY_BOX();
  vel_space: core.Box = EMPTY_BOX();
  pos: jnp.Array = jnp.zeros([]);
  vel: jnp.Array = jnp.zeros([]);
}

/** A simple proportional-derivative controller for actions. */
export class ProportionalDerivativeController<EnvState extends State>
  extends core.Transform<EnvState, ProportionalDerivativeControllerState> {
  actionable_trq: string | null;
  actionable_pos: string | null;
  actionable_vel: string | null;
  actionable_kp: string | null;
  actionable_kd: string | null;
  kp: number[] | null;
  kd: number[] | null;
  kp_passive: number[] | null;
  pos_default: number[];
  vel_default: number[];
  pos_margin: number[];
  obskey_pos: string;
  obskey_vel: string;
  actkey_trq: string;
  additive_trq: boolean;

  constructor({
    actionable_trq = null,
    actionable_pos = null,
    actionable_vel = null,
    actionable_kp = null,
    actionable_kd = null,
    kp = null,
    kd = null,
    kp_passive = null,
    pos_default = 0.,
    vel_default = 0.,
    pos_margin = 0.,
    obskey_pos = 'joints_pos',
    obskey_vel = 'joints_vel',
    actkey_trq = 'joints_trq',
    additive_trq = false,
    undamped = false,
  }: {
    actionable_trq?: string | null,
    actionable_pos?: string | null,
    actionable_vel?: string | null,
    actionable_kp?: string | null,
    actionable_kd?: string | null,
    kp?: math.ArrayLike | null,
    kd?: math.ArrayLike | null,
    kp_passive?: math.ArrayLike | null,
    pos_default?: math.ArrayLike,
    vel_default?: math.ArrayLike,
    pos_margin?: math.ArrayLike,
    obskey_pos?: string,
    obskey_vel?: string,
    actkey_trq?: string,
    additive_trq?: boolean,
    undamped?: boolean,
  } = {}) {
    super(new ProportionalDerivativeControllerState());
    // Configure action space.
    this.actionable_trq = actionable_trq;
    this.actionable_pos = actionable_pos;
    this.actionable_vel = actionable_vel;
    this.actionable_kp = actionable_kp;
    this.actionable_kd = actionable_kd;
    console.assert(Boolean(actionable_kp) || kp !== null);
    console.assert(undamped || Boolean(actionable_kd) || kd !== null);
    this.kp = kp !== null ? math.float_tuple(kp) : null;
    this.kd = kd !== null ? math.float_tuple(kd) : null;
    this.kp_passive = kp_passive !== null ? math.float_tuple(kp_passive) : null;
    this.pos_default = math.float_tuple(pos_default);
    this.vel_default = math.float_tuple(vel_default);
    this.pos_margin = math.float_tuple(pos_margin);

    // Store keys for observation and action.
    this.obskey_pos = obskey_pos;
    this.obskey_vel = obskey_vel;
    this.actkey_trq = actkey_trq;
    this.additive_trq = additive_trq;
  }

  override initialize(
    state: EnvState,
    context: core.Context,
    observation_space: core.ObservationSpace,
    action_space: core.ActionSpace,
  ): EnvState {
    // Initialize arrays with correct shape to avoid jit recompilation. Cache limits for Box spaces.
    let local = state.local.get(this.index);

    const trq_sp = action_space.getitem(this.actkey_trq);
    const pos_sp = observation_space.getitem(this.obskey_pos);
    const vel_sp = observation_space.getitem(this.obskey_vel);
    console.assert(pos_sp.shape.join() === vel_sp.shape.join(), 'Must have same shape of pos and vel observations');
    console.assert(pos_sp.shape.join() === trq_sp.shape.join(), 'Must have same shape of pos observation and trq action');

    // Compute position action space margins as a fraction of the joint/tendon range.
    const pos_margin = pos_sp.high.sub(pos_sp.low).mul(jnp.array(this.pos_margin));

    local = local.replace({
      trq_space: _transform_box(trq_sp, { desc_prefix: 'Feedforward extra' }),
      pos_space: _transform_box(pos_sp, {
        desc_prefix: 'Feedback target',
        low: pos_sp.low.sub(pos_margin),
        high: pos_sp.high.add(pos_margin),
      }),
      vel_space: _transform_box(vel_sp, { desc_prefix: 'Feedback target' }),
      pos: jnp.zeros(pos_sp.shape, { dtype: pos_sp.dtype }),
      vel: jnp.zeros(vel_sp.shape, { dtype: vel_sp.dtype }),
    });
    return state.replace({ local: state.local.set(this.index, local) } as Partial<EnvState>);
  }

  override reset(state: EnvState): EnvState {
    // Reset the position and velocity to zero every episode.
    let local = state.local.get(this.index);
    local = local.replace({ pos: jnp.zeros_like(local.pos), vel: jnp.zeros_like(local.vel) });
    return state.replace({ local: state.local.set(this.index, local) } as Partial<EnvState>);
  }

  override observation(space: core.ObservationSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    // Store the last observed position and velocity.
    let local = state.local.get(this.index);
    local = local.replace({ pos: value.getitem(this.obskey_pos), vel: value.getitem(this.obskey_vel) });
    state = state.replace({ local: state.local.set(this.index, local) } as Partial<EnvState>);
    return [value, state];
  }

  override observation_space(space: core.ObservationSpace, state: EnvState): core.ObservationSpace {
    // Observation space remains the same.
    return space;
  }

  override action(space: core.ActionSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    const local = state.local.get(this.index);

    // Initialize torques and add feedforward trq from action.
    let trq = jnp.zeros(space.getitem(this.actkey_trq).shape);
    if (this.actionable_trq) {
      trq = trq.add(value.getitem(this.actionable_trq));
    }

    // Get desired target pos/vel from action or fixed values.
    const pos_d = this.actionable_pos ? value.getitem(this.actionable_pos) : jnp.asarray(this.pos_default);
    const vel_d = this.actionable_vel ? value.getitem(this.actionable_vel) : jnp.asarray(this.vel_default);
    const pos_d_passive = jnp.asarray(this.pos_default);

    // Get kp/kd from action or fixed values. Terms are excluded if not provided in either.
    if (this.actionable_kp) {
      const kp = value.getitem(this.actionable_kp);
      trq = trq.add(kp.mul(pos_d.sub(local.pos)));
    } else if (this.kp !== null) {
      const kp = jnp.asarray(this.kp);
      trq = trq.add(kp.mul(pos_d.sub(local.pos)));
    }

    if (this.actionable_kd) {
      const kd = value.getitem(this.actionable_kd);
      trq = trq.add(kd.mul(vel_d.sub(local.vel)));
    } else if (this.kd !== null) {
      const kd = jnp.asarray(this.kd);
      trq = trq.add(kd.mul(vel_d.sub(local.vel)));
    }

    if (this.kp_passive !== null) {
      const passive_kp = jnp.asarray(this.kp_passive);
      trq = trq.add(passive_kp.mul(pos_d_passive.sub(local.pos)));
    }

    // Clip torques to the action space limits.
    const trq_sp = space.getitem(this.actkey_trq);
    trq = jnp.clip(trq, trq_sp.low, trq_sp.high);

    // Transform the action to the original space, removing controller-specific keys.
    const act = value.copy();
    if (this.actionable_trq) act.delitem(this.actionable_trq);
    if (this.actionable_pos) act.delitem(this.actionable_pos);
    if (this.actionable_vel) act.delitem(this.actionable_vel);
    if (this.actionable_kp) act.delitem(this.actionable_kp);
    if (this.actionable_kd) act.delitem(this.actionable_kd);
    if (this.additive_trq) {
      act.setitem(this.actkey_trq, act.getitem(this.actkey_trq).add(trq));
    } else {
      act.setitem(this.actkey_trq, trq);
    }
    return [act, state];
  }

  override action_space(space: core.ActionSpace, state: EnvState): core.ActionSpace {
    const local = state.local.get(this.index);
    const act_space = space.copy();
    if (!this.additive_trq) {
      act_space.delitem(this.actkey_trq);
    }
    if (this.actionable_trq) {
      act_space.setitem(this.actionable_trq, local.trq_space);
    }
    if (this.actionable_pos) {
      act_space.setitem(this.actionable_pos, local.pos_space);
    }
    if (this.actionable_vel) {
      act_space.setitem(this.actionable_vel, local.vel_space);
    }
    if (this.actionable_kp || this.actionable_kd) {
      throw new Error('NotImplementedError: actionable kp/kd action spaces are not ported.');
    }
    return act_space;
  }
}

export class SpringMuscleControllerState extends core.BaseLocalState {
  // Control spaces
  flx_space: core.Box = EMPTY_BOX();
  ext_space: core.Box = EMPTY_BOX();
  roc_space: core.Box = EMPTY_BOX();
  // Filtered muscle activations
  act_flx: jnp.Array = jnp.zeros([]);
  act_ext: jnp.Array = jnp.zeros([]);
  // Observation spaces and buffers
  pos_space: core.Box = EMPTY_BOX();
  pos: jnp.Array = jnp.zeros([]);
  vel: jnp.Array = jnp.zeros([]);
  // Spring muscle model parameters
  kf: jnp.Array = jnp.zeros([]);
  ke: jnp.Array = jnp.zeros([]);
  cf: jnp.Array = jnp.zeros([]);
  ce: jnp.Array = jnp.zeros([]);
}

/** A simple spring-muscle controller for actions. */
export class SpringMuscleController<EnvState extends State> extends core.Transform<EnvState, SpringMuscleControllerState> {
  // Convenient reparameterization of the muscle model (kf, ke, cf, ce).
  poseq: number[];  // Equilibrium pose for flx=ext=1.
  keq: number[];  // Stiffness at equilibrium for flx=ext=1.
  trq_max_flx: number[];  // Max torque from flexor at flx=1, ext=0.
  trq_max_ext: number[];
  actionable_roc: boolean;
  kp_passive: number[];
  kd: number[];
  act_time: number[] | null;
  obskey_pos: string;
  obskey_vel: string;
  actkey_flx: string;
  actkey_ext: string;
  actkey_roc: string;
  actkey_trq: string;
  additive_trq: boolean;

  /**
   * Args:
   *   poseq: Equilibrium pose for flx=ext=1 and passive stiffness target.
   *   keq: Effective stiffness at equilibrium for flx=ext=1.
   *   trq_max_flx: Max possible torque from flexor at flx=1, ext=0.
   *   trq_max_ext: Max possible torque from extensor at flx=0, ext=1.
   *   kp_passive: Proportional gain for passive torque.
   *   kd: Derivative gain for passive torque.
   *   act_time: Optional low-pass filter time constant for muscle activations.
   *   obskey_pos: Observation key for joint positions.
   *   obskey_vel: Observation key for joint velocities.
   *   actkey_flx: Action key for flexor activation.
   *   actkey_ext: Action key for extensor activation.
   *   actkey_trq: Action key for joint torques.
   */
  constructor({
    poseq,
    keq,
    trq_max_flx,
    trq_max_ext,
    actionable_roc = false,
    kp_passive = null,
    kd = null,
    act_time = null,
    obskey_pos = 'joints_pos',
    obskey_vel = 'joints_vel',
    actkey_flx = 'muscle_flx',
    actkey_ext = 'muscle_ext',
    actkey_roc = 'muscle_roc',
    actkey_trq = 'joints_trq',
    additive_trq = false,
  }: {
    poseq: math.ArrayLike,
    keq: math.ArrayLike,
    trq_max_flx: math.ArrayLike,
    trq_max_ext: math.ArrayLike,
    actionable_roc?: boolean,
    kp_passive?: math.ArrayLike | null,
    kd?: math.ArrayLike | null,
    act_time?: math.ArrayLike | null,
    obskey_pos?: string,
    obskey_vel?: string,
    actkey_flx?: string,
    actkey_ext?: string,
    actkey_roc?: string,
    actkey_trq?: string,
    additive_trq?: boolean,
  }) {
    super(new SpringMuscleControllerState());
    this.poseq = math.float_tuple(poseq);
    this.keq = math.float_tuple(keq);
    this.trq_max_flx = math.float_tuple(trq_max_flx);
    this.trq_max_ext = math.float_tuple(trq_max_ext);
    this.actionable_roc = actionable_roc;
    this.kp_passive = kp_passive !== null ? math.float_tuple(kp_passive) : [0];
    this.kd = kd !== null ? math.float_tuple(kd) : [0];
    this.act_time = act_time !== null ? math.float_tuple(act_time) : null;
    this.obskey_pos = obskey_pos;
    this.obskey_vel = obskey_vel;
    this.actkey_flx = actkey_flx;
    this.actkey_ext = actkey_ext;
    this.actkey_roc = actkey_roc;
    this.actkey_trq = actkey_trq;
    this.additive_trq = additive_trq;
  }

  override initialize(
    state: EnvState,
    context: core.Context,
    observation_space: core.ObservationSpace,
    action_space: core.ActionSpace,
  ): EnvState {
    // Initialize arrays with correct shape to avoid jit recompilation. Cache limits for Box spaces.
    let local = state.local.get(this.index);

    const trq_sp = action_space.getitem(this.actkey_trq);
    const pos_sp = observation_space.getitem(this.obskey_pos);
    const vel_sp = observation_space.getitem(this.obskey_vel);
    console.assert(pos_sp.shape.join() === vel_sp.shape.join(), 'Must have same shape of pos and vel observations');
    console.assert(pos_sp.shape.join() === trq_sp.shape.join(), 'Must have same shape of pos observation and trq action');

    const poseq = jnp.asarray(this.poseq);
    const keq = jnp.asarray(this.keq);
    const trq_max_flx = jnp.asarray(this.trq_max_flx);
    const trq_max_ext = jnp.asarray(this.trq_max_ext);

    // Reparameterization of muscle model parameters.
    const range = pos_sp.high.sub(pos_sp.low);
    const kf = keq.mul(poseq.sub(pos_sp.low)).add(trq_max_flx.sub(trq_max_ext)).div(range);
    const ke = keq.mul(pos_sp.high.sub(poseq)).add(trq_max_ext.sub(trq_max_flx)).div(range);
    const cf = trq_max_flx.div(kf).sub(range);
    const ce = trq_max_ext.div(ke).sub(range);

    const unit_box = (name_prefix: string, desc_prefix: string) => _transform_box(pos_sp, {
      name_prefix,
      desc_prefix,
      low: jnp.zeros(pos_sp.shape, { dtype: pos_sp.dtype }),
      high: jnp.ones(pos_sp.shape, { dtype: pos_sp.dtype }),
    });
    local = local.replace({
      flx_space: unit_box(this.actkey_flx, 'Flexor activation'),
      ext_space: unit_box(this.actkey_ext, 'Extensor activation'),
      roc_space: unit_box(this.actkey_roc, 'Maximum rate of change'),
      act_flx: jnp.zeros(pos_sp.shape, { dtype: pos_sp.dtype }),
      act_ext: jnp.zeros(pos_sp.shape, { dtype: pos_sp.dtype }),
      pos_space: pos_sp,
      pos: jnp.zeros(pos_sp.shape, { dtype: pos_sp.dtype }),
      vel: jnp.zeros(vel_sp.shape, { dtype: vel_sp.dtype }),
      kf: kf,
      ke: ke,
      cf: cf,
      ce: ce,
    });
    return state.replace({ local: state.local.set(this.index, local) } as Partial<EnvState>);
  }

  override reset(state: EnvState): EnvState {
    // Reset the filtered activations, position, and velocity to zero every episode.
    let local = state.local.get(this.index);
    local = local.replace({
      act_flx: jnp.zeros_like(local.act_flx),
      act_ext: jnp.zeros_like(local.act_ext),
      pos: jnp.zeros_like(local.pos),
      vel: jnp.zeros_like(local.vel),
    });
    return state.replace({ local: state.local.set(this.index, local) } as Partial<EnvState>);
  }

  override observation(space: core.ObservationSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    // Store the last observed position and velocity.
    let local = state.local.get(this.index);
    local = local.replace({ pos: value.getitem(this.obskey_pos), vel: value.getitem(this.obskey_vel) });
    state = state.replace({ local: state.local.set(this.index, local) } as Partial<EnvState>);
    return [value, state];
  }

  override observation_space(space: core.ObservationSpace, state: EnvState): core.ObservationSpace {
    // Observation space remains the same.
    return space;
  }

  override action(space: core.ActionSpace, value: core.ArrayDict, state: EnvState): [core.ArrayDict, EnvState] {
    let local = state.local.get(this.index);

    const flx = jnp.clip(value.getitem(this.actkey_flx), 0.0, 1.0);
    const ext = jnp.clip(value.getitem(this.actkey_ext), 0.0, 1.0);
    let act_flx: jnp.Array;
    let act_ext: jnp.Array;
    if (this.act_time === null) {
      act_flx = flx;
      act_ext = ext;
    } else {
      throw new Error('NotImplementedError: SpringMuscleController act_time filtering is not ported.');
    }

    if (this.actionable_roc) {
      throw new Error('NotImplementedError: SpringMuscleController actionable_roc is not ported.');
    }

    local = local.replace({ act_flx: act_flx, act_ext: act_ext });
    state = state.replace({ local: state.local.set(this.index, local) } as Partial<EnvState>);

    let trq = jnp.zeros(space.getitem(this.actkey_trq).shape);

    // Spring muscle model torque calculation.
    const xf = local.pos.sub(local.pos_space.low).add(local.cf);
    const xe = local.pos_space.high.sub(local.pos).add(local.ce);
    const trqf = act_flx.mul(local.kf).mul(xf);
    const trqe = act_ext.mul(local.ke).mul(xe);

    trq = trq.add(trqe).sub(trqf);

    // Passive torque calculations.
    const poseq = jnp.asarray(this.poseq);
    const kp_passive = jnp.asarray(this.kp_passive);
    const kd = jnp.asarray(this.kd);
    trq = trq.sub(kp_passive.mul(local.pos.sub(poseq)));
    trq = trq.sub(kd.mul(local.vel));

    // Clip torques to the action space limits.
    const trq_sp = space.getitem(this.actkey_trq);
    trq = jnp.clip(trq, trq_sp.low, trq_sp.high);

    // Transform the action to the original space, removing controller-specific keys.
    const act = value.copy();
    act.delitem(this.actkey_flx);
    act.delitem(this.actkey_ext);
    if (this.additive_trq) {
      act.setitem(this.actkey_trq, act.getitem(this.actkey_trq).add(trq));
    } else {
      act.setitem(this.actkey_trq, trq);
    }
    return [act, state];
  }

  override action_space(space: core.ActionSpace, state: EnvState): core.ActionSpace {
    const local = state.local.get(this.index);
    const act_space = space.copy();
    if (!this.additive_trq) {
      act_space.delitem(this.actkey_trq);
    }
    act_space.setitem(this.actkey_flx, local.flx_space);
    act_space.setitem(this.actkey_ext, local.ext_space);
    if (this.actionable_roc) {
      act_space.setitem(this.actkey_roc, local.roc_space);
    }
    return act_space;
  }
}
