/**
 * A minimal replacement for `hydra.utils.instantiate`, for configs exported to JSON (with
 * interpolations already resolved) by `python/export.py`.
 *
 * Supported: `_target_` (looked up in a registry by its Python path) and `_partial_`. Nested
 * configs are instantiated depth-first, like Hydra's default `_recursive_=True`. Any other special
 * key raises an error rather than being silently ignored.
 */
import * as collections from './utils/collections';
import * as functools from './utils/functools';

/** A registered target, called with the config's keyword arguments as a trailing object. */
export type Target = (...args: any[]) => unknown;
export type Registry = ReadonlyMap<string, Target>;

/** Registers a class as a target: `_target_: x.Foo` -> `new Foo(kwargs)`. */
export function cls<C extends new (kwargs: any) => unknown>(constructor: C): Target {
  const target = (kwargs: ConstructorParameters<C>[0]) => new constructor(kwargs);
  Object.defineProperty(target, 'name', { value: constructor.name });
  return target;
}

const SUPPORTED_KEYS = new Set(['_target_', '_partial_']);

export class InstantiationError extends Error {}

export function instantiate(config: unknown, registry: Registry, path: string = ''): any {
  if (Array.isArray(config)) {
    return config.map((item, i) => instantiate(item, registry, `${path}[${i}]`));
  }
  if (config === null || typeof config !== 'object') {
    return config;
  }
  const entries = Object.entries(config as Record<string, unknown>);
  for (const [key] of entries) {
    if (key.startsWith('_') && key.endsWith('_') && !SUPPORTED_KEYS.has(key)) {
      throw new InstantiationError(`Unsupported Hydra key '${key}' at '${path || '<root>'}'.`);
    }
  }
  const kwargs: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (SUPPORTED_KEYS.has(key)) continue;
    kwargs[key] = instantiate(value, registry, path ? `${path}.${key}` : key);
  }
  const { _target_, _partial_ = false } = config as { _target_?: string, _partial_?: boolean };
  if (_target_ === undefined) {
    if (_partial_) throw new InstantiationError(`'_partial_' without '_target_' at '${path}'.`);
    // An untargeted mapping is a Python `dict` (Hydra passes a `DictConfig`).
    return new collections.Dict(Object.entries(kwargs));
  }
  const target = registry.get(_target_);
  if (target === undefined) {
    throw new InstantiationError(
      `No TypeScript implementation registered for _target_ '${_target_}' at '${path || '<root>'}'.`,
    );
  }
  return _partial_ ? functools.partial(target, kwargs) : target(kwargs);
}
