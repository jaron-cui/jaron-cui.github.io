/**
 * A minimal, inference-only stand-in for `torch.nn`. As in PyTorch, assigning a `Parameter`,
 * `Buffer`, or `Module` to an attribute of a `Module` registers it, so ported code can keep
 * `self.x = ...` as `this.x = ...` and still produce PyTorch-compatible `state_dict()` keys.
 */
import { Tensor } from './tensor';
import * as F from './functional';
import * as builtins from '../utils/builtins';
import * as collections from '../utils/collections';

export class Parameter extends Tensor {
  requires_grad: boolean;

  constructor(data: Tensor, { requires_grad = true }: { requires_grad?: boolean } = {}) {
    super(data.data, data.shape, data.dtype);  // Shares storage, like `torch.nn.Parameter(data)`.
    this.requires_grad = requires_grad;
  }
}

export class Buffer extends Tensor {
  persistent: boolean;

  constructor(data: Tensor, { persistent = true }: { persistent?: boolean } = {}) {
    super(data.data, data.shape, data.dtype);  // Shares storage, like `torch.nn.Buffer(data)`.
    this.persistent = persistent;
  }
}

export type StateDict = Map<string, Tensor>;

function register(target: Module, name: string | symbol, value: unknown) {
  if (typeof name !== 'string' || !target._parameters) return;
  if (value instanceof Parameter) {
    target._parameters.set(name, value);
  } else if (value instanceof Buffer) {
    target._buffers.set(name, value);
    if (!value.persistent) target._non_persistent_buffers.add(name);
  } else if (value instanceof Module) {
    target._modules.set(name, value);
  }
}

export class Module {
  _parameters = new Map<string, Parameter>();
  _buffers = new Map<string, Tensor>();
  _non_persistent_buffers = new Set<string>();
  _modules = new Map<string, Module>();

  constructor() {
    // Mirrors `torch.nn.Module.__setattr__`. `defineProperty` covers class field initializers.
    return new Proxy(this, {
      set(target, name, value, receiver) {
        register(target, name, value);
        return Reflect.set(target, name, value, receiver);
      },
      defineProperty(target, name, descriptor) {
        register(target, name, descriptor.value);
        return Reflect.defineProperty(target, name, descriptor);
      },
    });
  }

  register_parameter(name: string, param: Parameter | null) {
    (this as Record<string, unknown>)[name] = param;
    if (param !== null) this._parameters.set(name, param);
  }

  register_buffer(name: string, tensor: Tensor, persistent: boolean = true) {
    (this as Record<string, unknown>)[name] = tensor;
    this._buffers.set(name, tensor);
    if (!persistent) this._non_persistent_buffers.add(name);
  }

  add_module(name: string, module: Module) {
    (this as Record<string, unknown>)[name] = module;
  }

  /** Python `module(...)` calls `forward(...)`; in TypeScript, call `forward` directly. */
  forward(...args: any[]): any {
    throw new Error(`Module [${this.constructor.name}] is missing the required "forward" function`);
  }

  *named_children(): Generator<[string, Module]> {
    yield* this._modules.entries();
  }

  *children(): Generator<Module> {
    yield* this._modules.values();
  }

  *named_modules(prefix: string = '', memo = new Set<Module>()): Generator<[string, Module]> {
    if (memo.has(this)) return;
    memo.add(this);
    yield [prefix, this];
    for (const [name, module] of this._modules) {
      yield* module.named_modules(prefix ? `${prefix}.${name}` : name, memo);
    }
  }

  *modules(): Generator<Module> {
    for (const [, module] of this.named_modules()) yield module;
  }

  /** Like PyTorch, shared parameters are only yielded under their first name. */
  *named_parameters(prefix: string = ''): Generator<[string, Parameter]> {
    const memo = new Set<Parameter>();
    for (const [module_prefix, module] of this.named_modules(prefix)) {
      for (const [name, param] of module._parameters) {
        if (memo.has(param)) continue;
        memo.add(param);
        yield [module_prefix ? `${module_prefix}.${name}` : name, param];
      }
    }
  }

  *parameters(): Generator<Parameter> {
    for (const [, param] of this.named_parameters()) yield param;
  }

  *named_buffers(prefix: string = ''): Generator<[string, Tensor]> {
    for (const [module_prefix, module] of this.named_modules(prefix)) {
      for (const [name, buffer] of module._buffers) {
        yield [module_prefix ? `${module_prefix}.${name}` : name, buffer];
      }
    }
  }

  /** Like PyTorch, includes shared parameters under every name and excludes non-persistent buffers. */
  state_dict(prefix: string = '', destination: StateDict = new Map()): StateDict {
    for (const [name, param] of this._parameters) destination.set(prefix + name, param);
    for (const [name, buffer] of this._buffers) {
      if (!this._non_persistent_buffers.has(name)) destination.set(prefix + name, buffer);
    }
    for (const [name, module] of this._modules) module.state_dict(`${prefix}${name}.`, destination);
    return destination;
  }

  /**
   * Like PyTorch, each module loads its own entries in `_load_from_state_dict`; keys that no module
   * consumes are unexpected, and own entries absent from `state_dict` are missing.
   */
  load_state_dict(
    state_dict: StateDict,
    { strict = true }: { strict?: boolean } = {},
  ): { missing_keys: string[], unexpected_keys: string[] } {
    const missing_keys: string[] = [];
    const consumed = new Set<string>();
    const error_msgs: string[] = [];
    for (const [prefix, module] of this.named_modules()) {
      module._load_from_state_dict(state_dict, prefix ? `${prefix}.` : '', missing_keys, consumed, error_msgs);
    }
    const unexpected_keys = [...state_dict.keys()].filter(k => !consumed.has(k));
    if (strict) {
      if (missing_keys.length) error_msgs.push(`Missing key(s): ${missing_keys.join(', ')}`);
      if (unexpected_keys.length) error_msgs.push(`Unexpected key(s): ${unexpected_keys.join(', ')}`);
    }
    if (error_msgs.length) throw new Error(`Error(s) in loading state_dict:\n  ${error_msgs.join('\n  ')}`);
    return { missing_keys, unexpected_keys };
  }

  /** Loads this module's own parameters and persistent buffers (not its children's). */
  _load_from_state_dict(
    state_dict: StateDict,
    prefix: string,
    missing_keys: string[],
    consumed: Set<string>,
    error_msgs: string[],
  ) {
    const own: [string, Tensor][] = [
      ...this._parameters.entries(),
      ...[...this._buffers.entries()].filter(([name]) => !this._non_persistent_buffers.has(name)),
    ];
    for (const [name, tensor] of own) {
      const key = prefix + name;
      const value = state_dict.get(key);
      if (value === undefined) {
        missing_keys.push(key);
        continue;
      }
      consumed.add(key);
      if (value.shape.join() !== tensor.shape.join()) {
        error_msgs.push(`size mismatch for ${key}: checkpoint [${value.shape}], model [${tensor.shape}]`);
        continue;
      }
      tensor.set_(value);
    }
  }

  /** Python `module.apply(fn)`: applies `fn` to every submodule (children first) and to itself. */
  apply(fn: (module: Module) => void): this {
    for (const module of this.children()) module.apply(fn);
    fn(this);
    return this;
  }
}

/** Python `torch.nn.ModuleDict`, with the `collections.Dict` method names. */
export class ModuleDict extends Module {
  getitem(name: string): Module {
    const module = this._modules.get(name);
    if (module === undefined) throw new Error(`KeyError: '${name}'`);
    return module;
  }

  setitem(name: string, module: Module) {
    this.add_module(name, module);
  }

  has(name: string): boolean { return this._modules.has(name); }
  keys(): string[] { return [...this._modules.keys()]; }
  values(): Module[] { return [...this._modules.values()]; }
  items(): [string, Module][] { return [...this._modules.entries()]; }
}

/** Python `torch.nn.Sequential`. Python `seq[i]` -> `seq.getitem(i)`. */
export class Sequential extends Module {
  constructor(...modules: Module[]) {
    super();
    modules.forEach((module, i) => this.add_module(String(i), module));
  }

  getitem(index: number): Module {
    const modules = [...this._modules.values()];
    const module = modules[index < 0 ? modules.length + index : index];
    if (module === undefined) throw new Error(`IndexError: index ${index} is out of range`);
    return module;
  }

  override forward(input: Tensor): Tensor {
    for (const module of this._modules.values()) input = module.forward(input);
    return input;
  }
}

/** Python `torch.nn.ParameterList`. */
export class ParameterList extends Module {
  append(value: Parameter): this {
    this.register_parameter(String(this._parameters.size), value);
    return this;
  }

  get length(): number { return this._parameters.size; }
  [Symbol.iterator](): Iterator<Parameter> { return this._parameters.values(); }
}

/**
 * Python `torch.nn.Linear`. Parameters are zero-initialized (rather than PyTorch's random
 * initialization), since they are always loaded from a checkpoint.
 */
export class Linear extends Module {
  in_features: number;
  out_features: number;
  weight: Parameter;
  bias: Parameter | null;

  constructor(in_features: number, out_features: number, { bias = true }: { bias?: boolean } = {}) {
    super();
    this.in_features = in_features;
    this.out_features = out_features;
    this.weight = new Parameter(new Tensor(new Float32Array(out_features * in_features), [out_features, in_features], 'float32'));
    if (bias) {
      this.bias = new Parameter(new Tensor(new Float32Array(out_features), [out_features], 'float32'));
    } else {
      this.bias = null;
    }
  }

  override forward(input: Tensor): Tensor {
    const output = input.matmul(this.weight.T);
    return this.bias === null ? output : output.add(this.bias);
  }
}

/**
 * Python `torch.nn.ParameterDict`, with the `collections.Dict` method names. As in PyTorch,
 * constructing from a plain `dict` sorts its keys, while an `OrderedDict` keeps its order.
 */
export class ParameterDict extends Module {
  constructor(parameters: collections.Dict<Parameter> | null = null) {
    super();
    if (parameters === null) return;
    const keys = parameters instanceof collections.OrderedDict
      ? parameters.keys()
      : builtins.sorted(parameters.keys());
    for (const key of keys) this.setitem(key, parameters.getitem(key));
  }

  getitem(name: string): Parameter {
    const param = this._parameters.get(name);
    if (param === undefined) throw new Error(`KeyError: '${name}'`);
    return param;
  }

  /** As in PyTorch, a plain tensor is wrapped in a `Parameter`. */
  setitem(name: string, param: Parameter | Tensor) {
    this.register_parameter(name, param instanceof Parameter ? param : new Parameter(param));
  }

  get(name: string, default_: any = null): Parameter | null {
    return this._parameters.get(name) ?? default_;
  }

  has(name: string): boolean {
    return this._parameters.has(name);
  }

  keys(): string[] { return [...this._parameters.keys()]; }
  values(): Parameter[] { return [...this._parameters.values()]; }
  items(): [string, Parameter][] { return [...this._parameters.entries()]; }
}

// ==================================================================================================
// Activation modules.

export class Identity extends Module {
  override forward(input: Tensor): Tensor { return input; }
}

export class ReLU extends Module {
  override forward(input: Tensor): Tensor { return F.relu(input); }
}

export class Hardtanh extends Module {
  min_val: number;
  max_val: number;

  constructor({ min_val = -1.0, max_val = 1.0 }: { min_val?: number, max_val?: number } = {}) {
    super();
    this.min_val = min_val;
    this.max_val = max_val;
  }

  override forward(input: Tensor): Tensor { return F.hardtanh(input, this.min_val, this.max_val); }
}
