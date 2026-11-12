/**
 * A stand-in for the `mujoco` Python module (`import mujoco as mj`), backed by the official MuJoCo
 * WASM bindings (`@mujoco/mujoco`), which must match the MuJoCo version used to export the model.
 *
 * Specs: TypeScript never builds or edits MuJoCo specs. `python/export_env.py` exports the compiled
 * model (with every build-time spec edit baked in) and read-only mirrors of the spec elements that
 * run-time code looks up. `MjSpec` here is such a mirror: element lookups (`spec.joint(name)`,
 * `spec.actuators`, ...) return `Mjs*` mirrors, and `MjSpec.compile()` returns the exported compiled
 * model. Call `load_assets()` once before constructing entities.
 */
import type { MainModule, MjModel as WasmMjModel } from '@mujoco/mujoco';

export type MjModel = WasmMjModel;

// ==================================================================================================
// Enums (string names, as exported by `export_env.py`).

export const mjtObj = {
  mjOBJ_BODY: 1,
  mjOBJ_JOINT: 3,
  mjOBJ_GEOM: 5,
  mjOBJ_TENDON: 18,
  mjOBJ_ACTUATOR: 19,
  mjOBJ_SENSOR: 20,
} as const;

export type mjtTrn = 'mjTRN_JOINT' | 'mjTRN_JOINTINPARENT' | 'mjTRN_SLIDERCRANK' | 'mjTRN_TENDON' | 'mjTRN_SITE' | 'mjTRN_BODY';
export type mjtJoint = 'mjJNT_FREE' | 'mjJNT_BALL' | 'mjJNT_SLIDE' | 'mjJNT_HINGE';

// ==================================================================================================
// Spec element mirrors.

export abstract class MjsElement {
  abstract readonly objtype: number;
  name: string;
  constructor(name: string) { this.name = name; }
}

export class MjsBody extends MjsElement {
  readonly objtype = mjtObj.mjOBJ_BODY;
}

export class MjsJoint extends MjsElement {
  readonly objtype = mjtObj.mjOBJ_JOINT;
  type: mjtJoint;
  range: [number, number];
  constructor({ name, type, range }: { name: string, type: mjtJoint, range: [number, number] }) {
    super(name);
    this.type = type;
    this.range = range;
  }
}

export class MjsTendon extends MjsElement {
  readonly objtype = mjtObj.mjOBJ_TENDON;
  range: [number, number];
  constructor({ name, range }: { name: string, range: [number, number] }) {
    super(name);
    this.range = range;
  }
}

export class MjsActuator extends MjsElement {
  readonly objtype = mjtObj.mjOBJ_ACTUATOR;
  trntype: mjtTrn;
  target: string;
  forcerange: [number, number];
  constructor({ name, trntype, target, forcerange }: { name: string, trntype: mjtTrn, target: string, forcerange: [number, number] }) {
    super(name);
    this.trntype = trntype;
    this.target = target;
    this.forcerange = forcerange;
  }
}

export class MjsSensor extends MjsElement {
  readonly objtype = mjtObj.mjOBJ_SENSOR;
}

export class MjsGeom extends MjsElement {
  readonly objtype = mjtObj.mjOBJ_GEOM;
  classname: { name: string };
  constructor({ name, classname }: { name: string, classname: string }) {
    super(name);
    this.classname = { name: classname };
  }
}

export interface SpecJson {
  degree: boolean;
  actuators: { name: string, trntype: mjtTrn, target: string, forcerange: [number, number] }[];
  joints: { name: string, type: mjtJoint, range: [number, number] }[];
  tendons: { name: string, range: [number, number] }[];
  sensors: { name: string }[];
  bodies: { name: string }[];
  geoms: { name: string, classname: string }[];
}

/** A read-only mirror of an `mj.MjSpec` (see the module docstring). */
export class MjSpec {
  compiler: { degree: boolean };
  option: { timestep: number, iterations?: number, ls_iterations?: number };
  actuators: MjsActuator[];
  joints: MjsJoint[];
  tendons: MjsTendon[];
  sensors: MjsSensor[];
  bodies: MjsBody[];
  geoms: MjsGeom[];

  constructor(json: SpecJson | null = null) {
    this.compiler = { degree: json?.degree ?? true };
    this.option = { timestep: 0.002 };
    this.actuators = (json?.actuators ?? []).map(a => new MjsActuator(a));
    this.joints = (json?.joints ?? []).map(j => new MjsJoint(j));
    this.tendons = (json?.tendons ?? []).map(t => new MjsTendon(t));
    this.sensors = (json?.sensors ?? []).map(s => new MjsSensor(s.name));
    this.bodies = (json?.bodies ?? []).map(b => new MjsBody(b.name));
    this.geoms = (json?.geoms ?? []).map(g => new MjsGeom(g));
  }

  /** `mj.MjSpec.from_file(path)`: the exported mirror of the spec loaded from `path`. */
  static from_file(path: string): MjSpec {
    const name = path.split('/').at(-1)!;
    const json = assets().specs[name];
    if (json === undefined) throw new Error(`No exported spec for '${name}'. Exported: ${Object.keys(assets().specs)}`);
    return new MjSpec(json);
  }

  private find<E extends MjsElement>(elements: E[], kind: string, name: string): E {
    const element = elements.find(e => e.name === name);
    if (element === undefined) throw new Error(`No ${kind} named '${name}' in spec.`);
    return element;
  }

  joint(name: string): MjsJoint { return this.find(this.joints, 'joint', name); }
  tendon(name: string): MjsTendon { return this.find(this.tendons, 'tendon', name); }
  sensor(name: string): MjsSensor { return this.find(this.sensors, 'sensor', name); }
  body(name: string): MjsBody { return this.find(this.bodies, 'body', name); }

  /** Returns the exported compiled model: the only spec compiled at run time is the task's. */
  compile(): MjModel {
    return assets().model;
  }
}

// ==================================================================================================
// Assets.

export interface Assets {
  mujoco: MainModule;
  model: MjModel;
  specs: Record<string, SpecJson>;
}

let _assets: Assets | null = null;

export function assets(): Assets {
  if (_assets === null) throw new Error('MuJoCo assets are not loaded; call `mj.load_assets()` first.');
  return _assets;
}

/** The loaded MuJoCo WASM module (for direct calls like `mujoco().mj_step(m, d)`). */
export function mujoco(): MainModule {
  return assets().mujoco;
}

/**
 * Loads the compiled model (`model.mjb`) and spec mirrors (`specs.json`) exported by
 * `python/export_env.py`, checking that the WASM MuJoCo version matches the exporting version.
 */
export function load_assets({
  mujoco,
  model_mjb,
  specs_json,
}: {
  mujoco: MainModule,
  model_mjb: Uint8Array,
  specs_json: { mujoco_version: string, specs: Record<string, SpecJson> },
}): Assets {
  const version = mujoco.mj_versionString();
  if (version !== specs_json.mujoco_version) {
    throw new Error(`MuJoCo version mismatch: WASM ${version}, exported with ${specs_json.mujoco_version}.`);
  }
  // Write the model into Emscripten's in-memory filesystem; `MjVFS.addBuffer` converts typed arrays
  // element by element, which takes seconds for a ~10 MB model.
  mujoco.FS.writeFile('/model.mjb', model_mjb);
  const vfs = new mujoco.MjVFS();
  const model = mujoco.MjModel.from_binary_path('/model.mjb', vfs);
  vfs.delete();
  mujoco.FS.unlink('/model.mjb');
  _assets = { mujoco, model, specs: specs_json.specs };
  return _assets;
}

/** `mj.mj_name2id(model, objtype, name)`. */
export function mj_name2id(model: MjModel, objtype: number, name: string): number {
  return mujoco().mj_name2id(model, objtype, name);
}
