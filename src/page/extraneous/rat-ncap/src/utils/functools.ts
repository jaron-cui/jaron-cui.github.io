/**
 * Python `functools` subset.
 *
 * Ported functions take Python keyword arguments as a trailing plain object, e.g.
 * `f(x, *, base=2)` -> `f(x, {base = 2} = {})`. `partial` binds such keyword arguments.
 */

export type Kwargs = Record<string, unknown>;

/** A trailing argument is treated as keyword arguments iff it is a plain object literal. */
export function is_kwargs(value: unknown): value is Kwargs {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Python `functools.partial(fn, **kwargs)`: binds keyword arguments, merged under any keyword
 * arguments given at call time, e.g. `partial(f, {base: 2})(x)` -> `f(x, {base: 2})`.
 */
export function partial<F extends (...args: any[]) => any>(fn: F, kwargs: Kwargs): F {
  const bound = (...args: unknown[]) => {
    const last = args.at(-1);
    if (is_kwargs(last)) return fn(...args.slice(0, -1), { ...kwargs, ...last });
    return fn(...args, kwargs);
  };
  return bound as F;
}
