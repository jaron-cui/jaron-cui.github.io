/**
 * A stand-in for `mujoco.mjx` (as `mjx`), backed by the MuJoCo WASM bindings.
 *
 * Differences from MJX:
 * - Physics is MuJoCo's C engine (float64), not MJX (JAX, float32). Bound reads are rounded to
 *   float32, as MJX values would be.
 * - `Data` wraps a single mutable `MjData`: `mjx.step`/`mjx.forward` and `Binding.set` modify it in
 *   place and return the same `Data`, whereas MJX returns new immutable data. Ported code keeps the
 *   functional style (`state.replace(mjx_data=mjx.step(...))`), which is equivalent as long as no
 *   code reads the pre-update data after an update.
 * - No vectorization: one `Data` per environment.
 */
import * as torch from '../torch';
import * as mj from './index';
import type { MjModel as WasmMjModel, MjData as WasmMjData } from '@mujoco/mujoco';

type Arrays = ArrayLike<number> & { [i: number]: number };

/**
 * The `MjData` fields that bindings read and write. Satisfied by a WASM `MjData`, or by plain arrays
 * (e.g. recorded data in tests).
 */
export interface DataArrays {
  time: number;
  qpos: Arrays;
  qvel: Arrays;
  ctrl: Arrays;
  actuator_force: Arrays;
  ten_length: Arrays;
  ten_velocity: Arrays;
  sensordata: Arrays;
  xpos: Arrays;
  xquat: Arrays;
  xfrc_applied: Arrays;
}

/** Model arrays that bindings index into, copied once from WASM memory. */
interface ModelArrays {
  jnt_qposadr: number[];
  jnt_dofadr: number[];
  jnt_type: number[];
  sensor_adr: number[];
  sensor_dim: number[];
  actuator_ctrlrange: number[];
}

/** Python `mjx.Model`. */
export class Model {
  raw: WasmMjModel;
  arrays: ModelArrays;
  /** Caches of element ids by `objtype:name`, and of binding ranges by `objtype:field:ids`. */
  ids = new Map<string, number>();
  ranges = new Map<string, BindingRanges>();

  constructor(raw: WasmMjModel) {
    this.raw = raw;
    const copy = (name: keyof ModelArrays) => Array.from((raw as unknown as Record<string, ArrayLike<number>>)[name]);
    this.arrays = {
      jnt_qposadr: copy('jnt_qposadr'),
      jnt_dofadr: copy('jnt_dofadr'),
      jnt_type: copy('jnt_type'),
      sensor_adr: copy('sensor_adr'),
      sensor_dim: copy('sensor_dim'),
      actuator_ctrlrange: copy('actuator_ctrlrange'),
    };
  }

  /** `mj.mj_name2id`, cached. */
  name2id(objtype: number, name: string): number {
    const key = `${objtype}:${name}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = mj.mj_name2id(this.raw, objtype, name);
      this.ids.set(key, id);
    }
    return id;
  }

  get opt(): { timestep: number } { return this.raw.opt; }

  /** `mjx_model.bind(objs)`. */
  bind(objs: mj.MjsElement | mj.MjsElement[]): Binding {
    return new Binding(this, null, objs);
  }
}

/** Python `mjx.Data` (see the module docstring for mutability). */
export class Data {
  raw: DataArrays;

  constructor(raw: DataArrays) {
    this.raw = raw;
  }

  get time(): torch.Tensor { return torch.tensor(this.raw.time); }

  /** `mjx_data.bind(mjx_model, objs)`. */
  bind(model: Model, objs: mj.MjsElement | mj.MjsElement[]): Binding {
    return new Binding(model, this, objs);
  }
}

/** Index ranges of each element's entries in a bound field. */
type Ranges = [number, number][];
type BindingRanges = { source: 'model' | 'data', array: string, ranges: Ranges };

const JOINT_QPOS_SIZE = [7, 4, 1, 1];  // By `mjtJoint`: free, ball, slide, hinge.
const JOINT_QVEL_SIZE = [6, 3, 1, 1];

/**
 * Python `mjx` named-access binding of model/data fields to spec elements. Reading a field returns
 * a float32 tensor: the element's entries for a single element, or all elements' entries
 * concatenated for a list.
 */
export class Binding {
  model: Model;
  data: Data | null;
  elements: mj.MjsElement[];
  single: boolean;
  ids: number[];

  constructor(model: Model, data: Data | null, objs: mj.MjsElement | mj.MjsElement[]) {
    this.model = model;
    this.data = data;
    this.single = !Array.isArray(objs);
    this.elements = Array.isArray(objs) ? objs : [objs];
    this.ids = this.elements.map(e => {
      const id = model.name2id(e.objtype, e.name);
      if (id < 0) throw new Error(`No ${e.constructor.name} named '${e.name}' in the compiled model.`);
      return id;
    });
  }

  private ranges(field: string): BindingRanges {
    const objtype = this.elements[0].objtype;
    const key = `${objtype}:${field}:${this.ids.join(',')}`;
    let ranges = this.model.ranges.get(key);
    if (ranges === undefined) {
      ranges = this.compute_ranges(field);
      this.model.ranges.set(key, ranges);
    }
    return ranges;
  }

  private compute_ranges(field: string): BindingRanges {
    const m = this.model.arrays;
    const objtype = this.elements[0].objtype;
    if (!this.elements.every(e => e.objtype === objtype)) throw new Error('Cannot bind mixed element types.');
    const fixed = (size: number) => this.ids.map(id => [id * size, id * size + size] as [number, number]);
    switch (`${objtype}:${field}`) {
      case `${mj.mjtObj.mjOBJ_JOINT}:qpos`:
        return { source: 'data', array: 'qpos', ranges: this.ids.map(id => [m.jnt_qposadr[id], m.jnt_qposadr[id] + JOINT_QPOS_SIZE[m.jnt_type[id]]]) };
      case `${mj.mjtObj.mjOBJ_JOINT}:qvel`:
        return { source: 'data', array: 'qvel', ranges: this.ids.map(id => [m.jnt_dofadr[id], m.jnt_dofadr[id] + JOINT_QVEL_SIZE[m.jnt_type[id]]]) };
      case `${mj.mjtObj.mjOBJ_TENDON}:length`:
        return { source: 'data', array: 'ten_length', ranges: fixed(1) };
      case `${mj.mjtObj.mjOBJ_TENDON}:velocity`:
        return { source: 'data', array: 'ten_velocity', ranges: fixed(1) };
      case `${mj.mjtObj.mjOBJ_ACTUATOR}:force`:
        return { source: 'data', array: 'actuator_force', ranges: fixed(1) };
      case `${mj.mjtObj.mjOBJ_ACTUATOR}:ctrl`:
        return { source: 'data', array: 'ctrl', ranges: fixed(1) };
      case `${mj.mjtObj.mjOBJ_ACTUATOR}:ctrlrange`:
        return { source: 'model', array: 'actuator_ctrlrange', ranges: fixed(2) };
      case `${mj.mjtObj.mjOBJ_SENSOR}:sensordata`:
        return { source: 'data', array: 'sensordata', ranges: this.ids.map(id => [m.sensor_adr[id], m.sensor_adr[id] + m.sensor_dim[id]]) };
      case `${mj.mjtObj.mjOBJ_BODY}:xpos`:
        return { source: 'data', array: 'xpos', ranges: fixed(3) };
      case `${mj.mjtObj.mjOBJ_BODY}:xquat`:
        return { source: 'data', array: 'xquat', ranges: fixed(4) };
      case `${mj.mjtObj.mjOBJ_BODY}:xfrc_applied`:
        return { source: 'data', array: 'xfrc_applied', ranges: fixed(6) };
      default:
        throw new Error(`Binding field '${field}' is not supported for ${this.elements[0].constructor.name}.`);
    }
  }

  private array(source: 'model' | 'data', name: string): Arrays {
    const owner = source === 'model' ? this.model.arrays : this.data?.raw;
    if (owner === undefined) throw new Error(`Cannot bind data field '${name}' on a model binding.`);
    return (owner as unknown as Record<string, Arrays>)[name];
  }

  /** Reads a bound field as a float32 tensor. */
  get(field: string): torch.Tensor {
    const { source, array, ranges } = this.ranges(field);
    const values = this.array(source, array);
    const out: number[] = [];
    for (const [start, end] of ranges) for (let i = start; i < end; i++) out.push(values[i]);
    const scalar = this.single && ranges[0][1] - ranges[0][0] === 1 && field !== 'qpos' && field !== 'qvel' && field !== 'sensordata';
    return scalar ? torch.tensor(out[0]) : torch.tensor(out);
  }

  /** `binding.set(field, value)`: writes into the bound data in place and returns it. */
  set(field: string, value: torch.Tensor): Data {
    const { source, array, ranges } = this.ranges(field);
    if (source !== 'data' || this.data === null) throw new Error(`Cannot set model field '${field}'.`);
    const values = this.array(source, array);
    const flat = value.tolist();
    const total = ranges.reduce((n, [start, end]) => n + end - start, 0);
    if (flat.length !== total) throw new Error(`Cannot set '${field}': expected ${total} values, got ${flat.length}.`);
    let k = 0;
    for (const [start, end] of ranges) for (let i = start; i < end; i++) values[i] = flat[k++];
    return this.data;
  }

  get qpos() { return this.get('qpos'); }
  get qvel() { return this.get('qvel'); }
  get length() { return this.get('length'); }
  get velocity() { return this.get('velocity'); }
  get force() { return this.get('force'); }
  get ctrl() { return this.get('ctrl'); }
  get ctrlrange() { return this.get('ctrlrange'); }
  get sensordata() { return this.get('sensordata'); }
  get xpos() { return this.get('xpos'); }
  get xquat() { return this.get('xquat'); }
  get xfrc_applied() { return this.get('xfrc_applied'); }
}

/** `mjx.put_model(mj_model)`. */
export function put_model(mj_model: WasmMjModel): Model {
  return new Model(mj_model);
}

/** `mjx.make_data(mj_model)`: zero-initialized data. */
export function make_data(mj_model: WasmMjModel): Data {
  return new Data(new (mj.mujoco().MjData)(mj_model) as unknown as DataArrays);
}

/** `mjx.step(model, data)`, in place (see the module docstring). */
export function step(model: Model, data: Data): Data {
  mj.mujoco().mj_step(model.raw, data.raw as unknown as WasmMjData);
  return data;
}

/** `mjx.forward(model, data)`, in place (see the module docstring). */
export function forward(model: Model, data: Data): Data {
  mj.mujoco().mj_forward(model.raw, data.raw as unknown as WasmMjData);
  return data;
}
