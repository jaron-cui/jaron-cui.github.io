/**
 * A minimal stand-in for `gymnasium.spaces` (`Box` and `Dict`), as used to describe observation and
 * action shapes when initializing models.
 */
import * as builtins from './utils/builtins';
import * as collections from './utils/collections';

export namespace spaces {
  export type Space = Box | Dict;

  export interface BoxKwargs {
    low: number | number[];
    high: number | number[];
    shape?: number[] | null;
    dtype?: 'float32';
  }

  /** `gymnasium.spaces.Box`. `low`/`high` are broadcast to `shape` and rounded to float32. */
  export class Box {
    low: number[];
    high: number[];
    shape: number[];
    dtype: 'float32';

    constructor({ low, high, shape = null, dtype = 'float32' }: BoxKwargs) {
      shape = shape ?? (Array.isArray(low) ? [low.length] : Array.isArray(high) ? [high.length] : [1]);
      const size = shape.reduce((a, b) => a * b, 1);
      const broadcast = (x: number | number[]) => {
        const values = Array.isArray(x) ? x : new Array<number>(size).fill(x);
        if (values.length !== size) throw new Error(`Box bound of length ${values.length} does not match shape [${shape}].`);
        return values.map(Math.fround);
      };
      this.low = broadcast(low);
      this.high = broadcast(high);
      this.shape = shape;
      this.dtype = dtype;
    }
  }

  /**
   * `gymnasium.spaces.Dict`. As in gymnasium, constructing from a plain `dict` sorts its keys, while
   * an `OrderedDict` or a list of `[key, space]` pairs keeps its order.
   */
  export class Dict implements Iterable<string> {
    spaces: collections.OrderedDict<Space>;

    constructor(spaces: collections.Dict<Space> | [string, Space][]) {
      if (Array.isArray(spaces) || spaces instanceof collections.OrderedDict) {
        this.spaces = new collections.OrderedDict(Array.isArray(spaces) ? spaces : spaces.items());
      } else {
        this.spaces = new collections.OrderedDict(
          builtins.sorted(spaces.keys()).map(k => [k, spaces.getitem(k)] as [string, Space]),
        );
      }
    }

    /** Python `space[key]`. */
    getitem(key: string): Space { return this.spaces.getitem(key); }
    /** Python `space[key] = value`. */
    setitem(key: string, value: Space) { this.spaces.setitem(key, value); }
    has(key: string): boolean { return this.spaces.has(key); }
    keys(): string[] { return this.spaces.keys(); }
    items(): [string, Space][] { return this.spaces.items(); }
    get size(): number { return this.spaces.size; }
    [Symbol.iterator](): Iterator<string> { return this.spaces[Symbol.iterator](); }
  }
}
