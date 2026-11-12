/** Port of `libs/utils/torch/containers.py` (`ParameterManager` subset). */
import * as torch from '../../torch';
import * as uts from '../string';

export type ParameterFactory = () => torch.nn.Parameter;
export type TensorLike = number | number[] | torch.Tensor;

/** Parameter factory that constructs paramters by copying the provided tensor data. */
export function tensorlike_parameter_factory(data: TensorLike, requires_grad: boolean = true): ParameterFactory {
  function factory() {
    return new torch.nn.Parameter(torch.tensor(data), { requires_grad });
  }

  return factory;
}

/** Manages parameter storage, parameter sharing, and construction of specific parameter types. */
export class ParameterManager extends torch.nn.ParameterDict {
  // Maps original -> [alias1, alias2, ...].
  _shared = new Map<string, string[]>();
  _factories = new Map<string, ParameterFactory>();

  /** Convenience method to simultaneously call `share()` and `factory()`. */
  config(
    original: string,
    share: string | Iterable<string> | null = null,
    factory: TensorLike | ParameterFactory | null = null,
    requires_grad: boolean = true,
  ) {
    if (share !== null) {
      this.share(original, share);
    }
    if (factory !== null) {
      if (typeof factory !== 'function') {
        factory = tensorlike_parameter_factory(factory, requires_grad);
      }
      this.factory(original, factory);
      if (share !== null) {
        this.factory(share, factory);
      }
    }
  }

  /** Register names matching any patterns in `aliases` to point to the `original` name. */
  share(original: string, aliases: string | Iterable<string>) {
    // Emulates `collections.defaultdict(list)`.
    if (!this._shared.has(original)) this._shared.set(original, []);
    const shared = this._shared.get(original)!;
    if (typeof aliases === 'string') {
      shared.push(aliases);
    } else {
      shared.push(...aliases);
    }
    return this;
  }

  /** Registers factory function to names matching any patterns. */
  factory(patterns: string | Iterable<string>, factory: TensorLike | ParameterFactory) {
    if (typeof factory !== 'function') {
      factory = tensorlike_parameter_factory(factory);
    }
    if (typeof patterns === 'string') {
      this._factories.set(patterns, factory);
    } else {
      for (const pattern of patterns) {
        this._factories.set(pattern, factory);
      }
    }
    return this;
  }

  /** Returns the original name corresponding to `alias`, the same name if it was original, or None if not registered. */
  original(alias: string): string | null {
    // Check if the provided alias is actually the original.
    if (this._shared.has(alias)) return alias;
    // Search for the last-registered original with a compatible alias.
    for (const [original, aliases] of [...this._shared.entries()].reverse()) {
      for (const pattern of aliases) {
        if (uts.in_glob_range(pattern, alias)) {
          return original;
        }
      }
    }
    return null;
  }

  /** Returns the aliases corresponding the `original`, or empty tuple if none registered. */
  aliases(original: string): string[] {
    return [...(this._shared.get(original) ?? [])];
  }

  /** Python `self[name]` / `self[name, factory]`. */
  override getitem(name: string, factory: ParameterFactory | null = null): torch.nn.Parameter {
    const original = this.original(name);
    if (original !== null) {
      // Name is an alias for `original`.
      name = original;
    }
    if (this.has(name)) {
      // Already constructed parameter.
      return super.getitem(name);
    }
    if (factory === null) {
      // No factory supplied. Search for the last-registered factory.
      for (const [pattern, fac] of [...this._factories.entries()].reverse()) {
        if (uts.in_glob_range(pattern, name)) {
          factory = fac;
          break;
        }
      }
    }
    if (factory === null) {
      // No factory supplied or registered.
      throw new Error(`LookupError: No factory supplied or registered for parameter: ${name}`);
    }
    const param = factory();
    this.setitem(name, param);
    return param;
  }

  override get(name: string, factory: ParameterFactory | null = null): torch.nn.Parameter {
    return this.getitem(name, factory);
  }

  set(name: string, param: torch.nn.Parameter): torch.nn.Parameter {
    this.setitem(name, param);
    return param;
  }
}
