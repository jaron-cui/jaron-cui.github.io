/**
 * Python mapping types, and a port of `libs/utils/collections.py` (subset).
 *
 * Python `dict`/`OrderedDict` are `Dict`/`OrderedDict` here, with Python semantics: `d[k]` ->
 * `d.getitem(k)` (raises `KeyError`), `d[k] = v` -> `d.setitem(k, v)`, `k in d` -> `d.has(k)`,
 * `d.get(k, default)` -> `d.get(k, default)`, and iteration yields keys. The two are only
 * distinguished where Python does: e.g. `torch.nn.ParameterDict` and `gymnasium.spaces.Dict` sort
 * the keys of a plain `dict` but keep the order of an `OrderedDict`.
 */
import * as string from './string';

/** Python `T.Mapping[str, V]`. */
export interface Mapping<V> extends Iterable<string> {
  getitem(key: string): V;
  get(key: string): V | null;
  get<D>(key: string, default_: D): V | D;
  has(key: string): boolean;
  keys(): string[];
  values(): V[];
  items(): [string, V][];
  readonly size: number;
}

export type DictInit<V> = Record<string, V> | Iterable<readonly [string, V]>;

function entries_of<V>(init: DictInit<V>): Iterable<readonly [string, V]> {
  if (init instanceof Dict) return init.items();
  return Symbol.iterator in init ? init as Iterable<readonly [string, V]> : Object.entries(init);
}

/** Python `dict`. */
export class Dict<V> implements Mapping<V> {
  protected dict: Map<string, V>;

  constructor(init: DictInit<V> = []) {
    this.dict = new Map(entries_of(init));
  }

  getitem(key: string): V {
    if (!this.dict.has(key)) throw new Error(`KeyError: '${key}'`);
    return this.dict.get(key)!;
  }

  setitem(key: string, value: V) {
    this.dict.set(key, value);
  }

  /** Python `del d[key]`. */
  delitem(key: string) {
    if (!this.dict.delete(key)) throw new Error(`KeyError: '${key}'`);
  }

  get(key: string): V | null;
  get<D>(key: string, default_: D): V | D;
  get<D>(key: string, default_: D | null = null): V | D | null {
    return this.dict.has(key) ? this.dict.get(key)! : default_;
  }

  has(key: string): boolean { return this.dict.has(key); }
  keys(): string[] { return [...this.dict.keys()]; }
  values(): V[] { return [...this.dict.values()]; }
  items(): [string, V][] { return [...this.dict.entries()]; }
  get size(): number { return this.dict.size; }
  [Symbol.iterator](): Iterator<string> { return this.dict.keys(); }

  /** Python `d.copy()`. */
  copy(): this {
    return new (this.constructor as new (init: DictInit<V>) => this)(this.items());
  }
}

/** Python `collections.OrderedDict`. */
export class OrderedDict<V> extends Dict<V> {}

/** Coerces a plain object (e.g. from hand-written TypeScript) into a `Dict`, like Python `dict(x)`. */
export function dict<V>(init: Mapping<V> | DictInit<V>): Mapping<V> {
  if (init instanceof Dict || init instanceof GlobDict) return init;
  return new Dict(init as DictInit<V>);
}

/** A dictionary that allows access to its keys as attributes: a plain object in TypeScript. */
export type AttrDict = Record<string, unknown>;

/**
 * A dictionary mapping glob patterns to values. Using specific (non-pattern) keys will match
 * glob patterns for key membership and value access.
 *
 *   ```
 *   > const d = new GlobDict({'a*': 1})
 *   > d.has('apple')
 *   true
 *   > d.getitem('apple')
 *   1
 *   > d.getitem('banana')
 *   Error: KeyError ...
 *   > d.get('banana', 2)
 *   2
 *   ```
 */
export class GlobDict<V> extends Dict<V> {
  override has(key: string): boolean {
    return super.has(key) || string.in_glob_range(this.keys(), key);
  }

  override getitem(key: string): V {
    return string.select_by_glob_range(this.dict, key);
  }

  override get(key: string): V | null;
  override get<D>(key: string, default_: D): V | D;
  override get<D>(key: string, default_: D | null = null): V | D | null {
    return string.select_by_glob_range(this.dict, key, default_);
  }
}
