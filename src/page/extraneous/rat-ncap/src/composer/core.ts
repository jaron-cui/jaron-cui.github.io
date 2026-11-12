/**
 * Port of `libs/composer/core.py`.
 *
 * Not ported: `Space.sample`/`vectorize`/`unvectorize` (environments are not vectorized here),
 * `pack_space`/`pack_value`/`unpack_value`/`tile_value`, `Wrapper`, and `State.clone`/structure
 * checks of frozen states.
 */
import * as jnp from '../jax/numpy';
import { broadcast_shapes } from '../torch/tensor';
import * as collections from '../utils/collections';

// ==================================================================================================
// Spaces

export abstract class Space<Value> {
  name: string = '';
  desc: string = '';

  abstract validate(value: Value): void;
}

export type Labels = (string | string[])[];

export class Box extends Space<jnp.Array> {
  low: jnp.Array;
  high: jnp.Array;
  shape: number[];
  labels: Labels | null;
  dtype: jnp.DType;

  constructor({
    low,
    high,
    shape = null,
    labels = null,
    dtype = 'float32',
    name = '',
    desc = '',
  }: {
    low: jnp.ArrayLike,
    high: jnp.ArrayLike,
    shape?: number[] | null,
    labels?: Labels | null,
    dtype?: jnp.DType,
    name?: string,
    desc?: string,
  }) {
    super();
    let low_ = jnp.asarray(low, { dtype });
    let high_ = jnp.asarray(high, { dtype });
    if (shape === null) {
      shape = broadcast_shapes(low_.shape, high_.shape);
    }

    if (labels !== null) {
      // Validate label shape.
      labels = labels.map(l => typeof l === 'string' ? l : [...l]);
      console.assert(
        labels.length === shape.length &&
        labels.every((l, i) => typeof l === 'string' || l.length === shape![i]),
        `Label ${JSON.stringify(labels)} does not match shape [${shape}].`,
      );
    }

    low_ = jnp.broadcast_to(low_, shape);
    high_ = jnp.broadcast_to(high_, shape);
    this.low = low_;
    this.high = high_;
    this.shape = shape;
    this.labels = labels;
    this.dtype = dtype;
    this.name = name;
    this.desc = desc;
  }

  /** `dataclasses.replace(box, **kwargs)`. */
  replace(kwargs: Partial<Pick<Box, 'low' | 'high' | 'shape' | 'labels' | 'name' | 'desc'>>): Box {
    const box = Object.create(Box.prototype) as Box;
    Object.assign(box, this, kwargs);
    return box;
  }

  override validate(value: jnp.Array) {
    if (value.shape.join() !== this.shape.join()) {
      throw new Error(`ValueError: Shape mismatch: expected [${this.shape}], got [${value.shape}]`);
    }
    const dtype = value.dtype === 'int64' ? 'int32' : value.dtype;
    if (dtype !== this.dtype) {
      throw new Error(`ValueError: Dtype mismatch: expected ${this.dtype}, got ${value.dtype}`);
    }
  }
}

export class Dict extends Space<collections.Mapping<jnp.Array>> implements Iterable<string> {
  spaces: collections.OrderedDict<Box>;

  constructor(spaces: collections.DictInit<Box> | null = null, { name = '', desc = '' } = {}) {
    super();
    this.spaces = new collections.OrderedDict(spaces ?? []);
    this.name = name;
    this.desc = desc;
  }

  override validate(value: collections.Mapping<jnp.Array>) {
    // Validate number, and names of keys.
    if (this.size !== value.size || !this.keys().every(k => value.has(k))) {
      throw new Error(`KeyError: Key mismatch: expected space keys [${this.keys()}], got value keys [${value.keys()}]`);
    }
    for (const [k, sp] of this.items()) {
      sp.validate(value.getitem(k));
    }
  }

  get size(): number { return this.spaces.size; }
  [Symbol.iterator](): Iterator<string> { return this.spaces[Symbol.iterator](); }
  getitem(key: string): Box { return this.spaces.getitem(key); }
  setitem(key: string, value: Box) { this.spaces.setitem(key, value); }
  delitem(key: string) {
    const items = this.spaces.items().filter(([k]) => k !== key);
    if (items.length === this.spaces.size) throw new Error(`KeyError: '${key}'`);
    this.spaces = new collections.OrderedDict(items);
  }
  has(key: string): boolean { return this.spaces.has(key); }
  keys(): string[] { return this.spaces.keys(); }
  values(): Box[] { return this.spaces.values(); }
  items(): [string, Box][] { return this.spaces.items(); }
  get(key: string, default_: Box | null = null): Box | null { return this.spaces.get(key, default_); }
  copy(): Dict { return new Dict(this.spaces.items(), { name: this.name, desc: this.desc }); }
  update(other: Dict | collections.Mapping<Box>) {
    for (const [k, v] of other.items()) this.spaces.setitem(k, v);
  }
}

export type ArrayDict = collections.OrderedDict<jnp.Array>;

// ==================================================================================================
// Env

export type Action = collections.Mapping<jnp.Array>;  // Order doesn't matter.
export type ActionSpace = Dict;
export type Observation = collections.OrderedDict<jnp.Array>;
export type ObservationSpace = Dict;
export type Metrics = collections.Dict<jnp.Array>;  // Order doesn't matter.

export class Step<EnvState> {
  state: EnvState;
  observation: Observation;
  terminated: jnp.Array;  // dtype=bool
  truncated: jnp.Array;  // dtype=bool
  reward: jnp.Array;  // dtype=float
  metrics: Metrics;

  constructor({ state, observation, terminated, truncated, reward, metrics }: {
    state: EnvState,
    observation: Observation,
    terminated: jnp.Array,
    truncated: jnp.Array,
    reward: jnp.Array,
    metrics: Metrics,
  }) {
    this.state = state;
    this.observation = observation;
    this.terminated = terminated;
    this.truncated = truncated;
    this.reward = reward;
    this.metrics = metrics;
  }
}

// ==================================================================================================
// State

/** Python `eqx.nn.StateIndex`: a key into `State`, given a string marker by `initialize_state_index`. */
export class StateIndex<Value> {
  init: Value;
  marker: string | null = null;

  constructor(init: Value) {
    this.init = init;
  }
}

/**
 * Stores the state of a tree of entities and transforms, keyed by `StateIndex` markers. As in
 * Python, `set` returns a new `State` and invalidates the old one, so stale states fail loudly.
 */
export class State {
  _state: Map<string, unknown> | null;
  _frozen: boolean;

  constructor(pytree: Entity<any, any> | null, frozen: boolean = true) {
    this._state = new Map();
    this._frozen = frozen;
    if (pytree !== null) {
      for (const index of state_indices(pytree)) {
        if (index.marker === null) {
          throw new Error('StateIndex.marker is not set. Use `initialize_state_index()` before constructing state.');
        }
        this._state.set(index.marker, index.init);
      }
    }
  }

  get<Value>(index: StateIndex<Value>): Value {
    if (this._state === null) throw new Error('ValueError: Attempted to get value of stale state.');
    if (!this._state.has(index.marker!)) throw new Error(`KeyError: no state for '${index.marker}'`);
    return this._state.get(index.marker!) as Value;
  }

  set<Value>(index: StateIndex<Value>, value: Value): State {
    if (this._state === null) throw new Error('ValueError: Attempted to set value of stale state.');
    const state = new Map(this._state);
    state.set(index.marker!, value);
    const new_self = Object.create(State.prototype) as State;
    new_self._state = state;
    new_self._frozen = this._frozen;
    this._state = null;  // Invalidate the old state.
    return new_self;
  }

  /** Freeze the state structure. */
  freeze(): State {
    if (this._state === null) throw new Error('ValueError: Attempted to freeze a stale state.');
    const new_self = Object.create(State.prototype) as State;
    new_self._state = new Map(this._state);
    new_self._frozen = true;
    this._state = null;  // Invalidate the old state.
    return new_self;
  }

  keys(): string[] {
    if (this._state === null) throw new Error('ValueError: Attempted to read a stale state.');
    return [...this._state.keys()];
  }
}

/** All `StateIndex` leaves of an entity tree, in traversal order. */
function state_indices(entity: Entity<any, any>): StateIndex<unknown>[] {
  return [
    ...[...entity.children.values()].flatMap(state_indices),
    ...entity.transforms.map(t => t.index),
    entity.index,
  ];
}

/**
 * Sets every `StateIndex.marker` to its path in the tree, e.g.
 * `MoveAtFixedVelocity_TrackSmooth.children['body'].transforms[13].index`, matching the markers that
 * Python derives with `jax.tree_util.keystr` (so recorded Python states can be loaded by marker).
 */
export function initialize_state_index<E extends Entity<any, any>>(pytree: E): E {
  function visit(entity: Entity<any, any>, path: string) {
    for (const [name, child] of entity.children.items()) visit(child, `${path}.children['${name}']`);
    entity.transforms.forEach((t, i) => { t.index.marker = `${path}.transforms[${i}].index`; });
    entity.index.marker = `${path}.index`;
  }
  visit(pytree, pytree.constructor.name);
  return pytree;
}

// ==================================================================================================
// Entity

export interface BaseEnvState {
  rng: unknown;
  steps: jnp.Array;
  terminated: jnp.Array;
  local: State;
  replace(kwargs: Partial<this>): this;
}

/** Python `eqx.Module` local states with `replace(**kwargs)` (`dataclasses.replace`). */
export abstract class BaseLocalState {
  replace(kwargs: Partial<Omit<this, 'replace'>>): this {
    const copy = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(copy, this, kwargs);
    return copy;
  }
}

export type Context = Record<string, unknown>;

export class Transform<EnvState extends BaseEnvState, LocalState extends BaseLocalState | null> {
  index: StateIndex<LocalState>;

  constructor(local_state: LocalState = null as LocalState) {
    this.index = new StateIndex(local_state);
  }

  /** Initialize static properties using the context passed by the parent entity tree. */
  initialize(
    state: EnvState,
    context: Context,
    observation_space: ObservationSpace,
    action_space: ActionSpace,
  ): EnvState {
    return state;
  }

  /** Reset the transform state at the beginning of each episode. */
  reset(state: EnvState): EnvState {
    return state;
  }

  /** Transform action values. Override in subclasses that modify actions. */
  action(space: ActionSpace, value: ArrayDict, state: EnvState): [ArrayDict, EnvState] {
    return [value, state];
  }

  /** Transform action space. Override in subclasses that modify action spaces. */
  action_space(space: ActionSpace, state: EnvState): ActionSpace {
    return space;
  }

  /** Transform observation values. Override in subclasses that modify observations. */
  observation(space: ObservationSpace, value: ArrayDict, state: EnvState): [ArrayDict, EnvState] {
    return [value, state];
  }

  /** Transform observation space. Override in subclasses that modify observation spaces. */
  observation_space(space: ObservationSpace, state: EnvState): ObservationSpace {
    return space;
  }
}

export class Entity<EnvState extends BaseEnvState, LocalState extends BaseLocalState | null> {
  children: collections.OrderedDict<Entity<EnvState, any>>;
  transforms: Transform<EnvState, any>[];  // Order is innermost to outermost.
  index: StateIndex<LocalState>;

  constructor({
    children = {},
    transforms = [],
    local_state = null as LocalState,
  }: {
    children?: Record<string, Entity<EnvState, any> | null>,
    transforms?: (Transform<EnvState, any> | false | null)[],
    local_state?: LocalState,
  } = {}) {
    this.children = new collections.OrderedDict(
      Object.entries(children).filter(([, v]) => v !== null) as [string, Entity<EnvState, any>][],
    );
    this.transforms = transforms.filter(t => t) as Transform<EnvState, any>[];
    this.index = new StateIndex(local_state);
  }

  /** Initialize the entity. Override in subclasses that require initialization. */
  initialize(state: EnvState, context: Context): [EnvState, Context] {
    return [state, context];
  }

  /** Apply action to the state. Override in subclasses that support actions. */
  action(state: EnvState, action: ArrayDict): EnvState {
    return state;
  }

  /** Return the action space. Override in subclasses that support actions. */
  action_space(state: EnvState): ActionSpace {
    return new Dict();
  }

  /** Get observations from the state. Override in subclasses that support observations. */
  observation(state: EnvState): [ArrayDict, EnvState] {
    return [new collections.OrderedDict(), state];
  }

  /** Return the observation space. Override in subclasses that support observations. */
  observation_space(state: EnvState): ObservationSpace {
    return new Dict();
  }
}

/**
 * Per-entity spaces before/after each transform: `[entity space, after transform 0, ...]`.
 *
 * Python recomputes these on every `entity_action`/`entity_observation` call, but under `jax.jit`
 * that happens once, at trace time. Here they are cached after `entity_initialize`, which is valid
 * because spaces only depend on state set during initialization (true for every ported entity and
 * transform).
 */
const _spaces_cache = new WeakMap<Entity<any, any>, { action: Dict[], observation: Dict[] }>();

/**
 * Entities whose actions/observations were validated since `entity_initialize`. Python validates on
 * every call, but under `jax.jit` that happens once, at trace time; shapes and dtypes are static.
 */
const _validated = { action: new WeakSet<Entity<any, any>>(), observation: new WeakSet<Entity<any, any>>() };

function entity_spaces<EnvState extends BaseEnvState>(entity: Entity<EnvState, any>, state: EnvState) {
  let spaces = _spaces_cache.get(entity);
  if (spaces === undefined) {
    const action = [entity.action_space(state)];
    const observation = [entity.observation_space(state)];
    for (const transform of entity.transforms) {  // Transform spaces in original order.
      action.push(transform.action_space(action.at(-1)!, state));
      observation.push(transform.observation_space(observation.at(-1)!, state));
    }
    spaces = { action, observation };
    _spaces_cache.set(entity, spaces);
  }
  return spaces;
}

function check_reserved(keys: Iterable<string>, message: () => string) {
  if ([...keys].some(k => k.includes('/'))) throw new Error(`KeyError: ${message()}`);
}

export function entity_initialize<EnvState extends BaseEnvState>(
  entity: Entity<EnvState, any>,
  state: EnvState,
  context: Context,
): EnvState {
  _spaces_cache.delete(entity);
  _validated.action.delete(entity);
  _validated.observation.delete(entity);
  // Shallow copying `context` is cheap and enables entity/transforms to modify it without worrying
  // about affecting the other subtrees.
  [state, context] = entity.initialize(state, { ...context });
  let observation_space = entity.observation_space(state);
  let action_space = entity.action_space(state);
  check_reserved(observation_space, () => `Reserved char '/' in original observation space: entity \`${entity.constructor.name}\`, keys [${observation_space.keys()}]`);
  check_reserved(action_space, () => `Reserved char '/' in original action space: entity \`${entity.constructor.name}\`, keys [${action_space.keys()}]`);

  for (const transform of entity.transforms) {  // Transform spaces in original order.
    state = transform.initialize(state, { ...context }, observation_space, action_space);
    observation_space = transform.observation_space(observation_space, state);
    action_space = transform.action_space(action_space, state);
    check_reserved(observation_space, () => `Reserved char '/' in transformed observation space: entity \`${entity.constructor.name}\`, transform \`${transform.constructor.name}\``);
    check_reserved(action_space, () => `Reserved char '/' in transformed action space: entity \`${entity.constructor.name}\`, transform \`${transform.constructor.name}\``);
  }

  for (const [name, child] of entity.children.items()) {
    if (name.includes('/')) throw new Error(`KeyError: Reserved char '/' in child entity name: '${name}'`);
    if (observation_space.has(name)) throw new Error(`KeyError: Duplicate observation space key and child entity name: '${name}'`);
    if (action_space.has(name)) throw new Error(`KeyError: Duplicate action space key and child entity name: '${name}'`);
    state = entity_initialize(child, state, context);
  }

  return state;
}

/** Reset the entity transform state at the beginning of each episode. */
export function entity_reset<EnvState extends BaseEnvState>(entity: Entity<EnvState, any>, state: EnvState): EnvState {
  for (const transform of entity.transforms) {
    state = transform.reset(state);
  }
  for (const [, child] of entity.children.items()) {
    state = entity_reset(child, state);
  }
  return state;
}

export function entity_action<EnvState extends BaseEnvState>(
  entity: Entity<EnvState, any>,
  state: EnvState,
  action: Action,
): EnvState {
  // Construct input action spaces for each transform. Need to do this first since spaces are
  // transformed in original order but action values are transformed in reverse order.
  const spaces = entity_spaces(entity, state).action;

  // Validate, reorder, and separate self action from children actions.
  let self_action: ArrayDict = new collections.OrderedDict();
  for (const k of spaces.at(-1)!.keys()) {
    if (!action.has(k)) {
      throw new Error(`KeyError: Key missing in entity action: entity \`${entity.constructor.name}\`, expected key '${k}', got action [${action.keys()}]`);
    }
    self_action.setitem(k, action.getitem(k));
  }
  const check = !_validated.action.has(entity);
  if (check) validate(spaces.at(-1)!, self_action, () => `Validation error in entity action: entity \`${entity.constructor.name}\``);

  // Pass transformed self action to entity. Transform values in reverse order.
  for (let i = entity.transforms.length - 1; i >= 0; i--) {
    const transform = entity.transforms[i];
    const original_space = spaces[i];
    [self_action, state] = transform.action(original_space, self_action, state);
    if (check) validate(original_space, self_action, () => `Validation error in transformed entity action: entity \`${entity.constructor.name}\`, transform \`${transform.constructor.name}\``);
  }
  _validated.action.add(entity);
  state = entity.action(state, self_action);

  // Pass children actions to children.
  for (const [name, child] of entity.children.items()) {
    const child_action = new collections.Dict(
      action.items()
        .filter(([k]) => k.startsWith(`${name}/`))
        .map(([k, v]) => [k.slice(name.length + 1), v] as [string, jnp.Array]),
    );
    state = entity_action(child, state, child_action);
  }

  return state;
}

/**
 * Args:
 *   discard: The observation will be discarded and only its effect on state matters (as for the
 *     intermediate observations of `MjxEnv.step` substeps). Transforms after the last stateful
 *     transform (one with local state) are skipped, since their output would be discarded.
 *     TypeScript-only optimization; the returned state is identical.
 */
export function entity_observation<EnvState extends BaseEnvState>(
  entity: Entity<EnvState, any>,
  state: EnvState,
  { discard = false }: { discard?: boolean } = {},
): [Observation, EnvState] {
  const observation: Observation = new collections.OrderedDict();

  // Get transformed self observation from entity.
  const spaces = entity_spaces(entity, state).observation;
  const check = !_validated.observation.has(entity);
  const last = discard
    ? entity.transforms.findLastIndex(t => t.index.init !== null)
    : entity.transforms.length - 1;
  let obs: ArrayDict;
  [obs, state] = entity.observation(state);
  if (check) validate(spaces[0], obs, () => `Validation error in original entity observation: entity \`${entity.constructor.name}\``);
  for (const [i, transform] of entity.transforms.entries()) {  // Transform values in original order.
    if (i > last) break;
    [obs, state] = transform.observation(spaces[i], obs, state);
    if (check) validate(spaces[i + 1], obs, () => `Validation error in transformed entity observation: entity \`${entity.constructor.name}\`, transform \`${transform.constructor.name}\``);
  }
  if (!discard) _validated.observation.add(entity);
  for (const [k, v] of obs.items()) observation.setitem(k, v);

  // Get children observations from children.
  for (const [name, child] of entity.children.items()) {
    let child_obs: Observation;
    [child_obs, state] = entity_observation(child, state, { discard });
    if (child_obs.size === 0) continue;
    for (const [k, v] of child_obs.items()) {
      observation.setitem(`${name}/${k}`, v);
    }
  }

  return [observation, state];
}

export function entity_action_space<EnvState extends BaseEnvState>(entity: Entity<EnvState, any>, state: EnvState): ActionSpace {
  const action_space: ActionSpace = new Dict();
  let space = entity.action_space(state);
  for (const transform of entity.transforms) {  // Transform spaces in original order.
    space = transform.action_space(space, state);
  }
  action_space.update(space);
  for (const [name, child] of entity.children.items()) {
    const aspace = entity_action_space(child, state);
    for (const [k, v] of aspace.items()) action_space.setitem(`${name}/${k}`, v);
  }
  return action_space;
}

export function entity_observation_space<EnvState extends BaseEnvState>(entity: Entity<EnvState, any>, state: EnvState): ObservationSpace {
  const observation_space: ObservationSpace = new Dict();
  let space = entity.observation_space(state);
  for (const transform of entity.transforms) {  // Transform spaces in original order.
    space = transform.observation_space(space, state);
  }
  observation_space.update(space);
  for (const [name, child] of entity.children.items()) {
    const ospace = entity_observation_space(child, state);
    for (const [k, v] of ospace.items()) observation_space.setitem(`${name}/${k}`, v);
  }
  return observation_space;
}

function validate(space: Dict, value: collections.Mapping<jnp.Array>, message: () => string) {
  try {
    space.validate(value);
  } catch (e) {
    throw new Error(`ValueError: ${message()}`, { cause: e });
  }
}
