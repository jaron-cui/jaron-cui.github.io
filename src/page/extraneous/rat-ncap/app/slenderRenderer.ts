/**
 * Draws the rat with Slender (src/page/extraneous/slender) instead of three.js: flat vector shapes
 * on a 2D canvas. The rat is an ordinary Slender document: an armature with one bone per MuJoCo
 * body, and one ellipsoid per geom, parented to its body's bone. Each frame poses the bones from the
 * simulated body poses, and Slender's own pipeline (worldMatrices, toScene, projectScene) does the
 * rest. Slender works in millimetres here, since its near plane sits 1 unit in front of the camera.
 */
import { distance, restMatrix, tailOffset } from '../../slender/armature';
import { addEllipsoid, EditorDocument, emptyDocument, SceneObject, toScene, updateObject } from '../../slender/document';
import { decompose, invertMatrix, Matrix, matrixOrigin, multiply } from '../../../../lib/vrender/matrix';
import { Camera, EllipsoidNode, Rgb, SceneNode, ShapeNode, Vec3 } from '../../../../lib/vrender/model';
import { DrawItem, EllipsoidItem, projectScene } from '../../../../lib/vrender/project';
import { drawItems, ellipsoidOutline } from '../../../../lib/vrender/render';
import { addArmature } from '../../slender/rigging';
import type { Geoms, SceneRenderer } from './protocol';

const MM = 1000;
const GEOM = { SPHERE: 2, CAPSULE: 3, ELLIPSOID: 4, CYLINDER: 5, BOX: 6 };
const VISIBLE_GROUPS = new Set([1, 2]);
const SKY = '#e9eef3';
const FLOOR_LIGHT: Rgb = { r: 0xb9 / 255, g: 0xb6 / 255, b: 0xb3 / 255 };
const FLOOR_DARK: Rgb = { r: 0xa9 / 255, g: 0xa6 / 255, b: 0xa3 / 255 };
const TILE = 1000;  // 1 m checkers, as in the trained arena.
const TILES_AROUND = 8;
// Light travels along (-1, 1.5, -3), as in the three.js version, so shadows fall along +x, -y.
const SHADOW: Matrix = [1, 0, -1 / 3, 0, 0, 1, 0.5, 0, 0, 0, 0.002, 0.3];
const DEPTH_DARKENING = 0.28;  // How much darker the far side of the rat is than the near side.
const BORDER_WIDTH = 1.2;  // (mm)
const MIN_BONE_LENGTH = 2;  // (mm)
const LEAF_BONE_LENGTH = 12;  // (mm)
const FOV_FOCAL = 1.2;
const LIFT = 0.3;  // How far a flat fill moves from MuJoCo's material colour toward white.

const lift = (channel: number) => channel + (1 - channel) * LIFT;  // Focal length per CSS pixel of height: about a 45 degree field of view.

type Quaternion = [number, number, number, number];  // w, x, y, z
const MARK_LIFETIME = 2000;  // (ms)
const SWING_PER_PIXEL = 0.008;  // (rad) How far a drag of one CSS pixel swings the side camera.
const SWING_DECAY = 0.45;  // (s) How quickly a flung swing slows.
const MARK_RADIUS = 9;  // (mm)

export type SlenderRendererOptions = {
  // Draw the checkered floor (otherwise only the shadow marks the ground).
  floor?: boolean;
  // CSS colour behind everything.
  background?: string;
  // 'orbit': the user drags and zooms about the rat. 'side': a fixed side view that turns with the
  // rat's (smoothed) heading so it always walks left to right, with no pointer or wheel handling.
  camera?: 'orbit' | 'side';
  // Camera distance from the rat (mm) and pitch (rad, negative looks down).
  distance?: number;
  pitch?: number;
  // How long the side camera takes to turn after the rat's heading (s); 0 locks it to the heading.
  headingLag?: number;
  // Draw the parts listed in MERGED as one outlined shape rather than each outlined alone.
  mergeOutlines?: boolean;
};

// Body sections by MuJoCo body name, for colouring: each part takes its section's fill.
const SECTIONS: [RegExp, (body: string) => string][] = [
  [/^(torso|pelvis|scapula_[LR]|vertebra_\d+|vertebra_cervical_\d+|vertebra_axis|vertebra_atlant)$/, () => 'core'],
  [/^(upper_leg|lower_leg)_([LR])$/, b => 'leg_' + b.slice(-1)],
  [/^(foot|toe)_([LR])$/, b => 'foot_' + b.slice(-1)],
  [/^(upper_arm|lower_arm)_([LR])$/, b => 'arm_' + b.slice(-1)],
  [/^(hand|finger)_([LR])$/, b => 'hand_' + b.slice(-1)],
  [/^(skull|jaw)$/, () => 'head'],
  [/^vertebrae_C\d+C\d+$/, () => 'tail'],
];
// Geoms on the head drawn on their own, with their own colours: the eyes and the incisors (the
// slim T1, T2 pairs).
const gray = (v: number): Rgb => ({ r: v, g: v, b: v });
const LOOSE_COLORS: Record<string, Rgb> = {
  eye_L: gray(0.08), eye_R: gray(0.08),
  skull_T1: gray(1), skull_T2: gray(1), jaw_T1: gray(1), jaw_T2: gray(1),
};
const LOOSE_PARTS = new Set(Object.keys(LOOSE_COLORS));
// Each section's fill: light grays, a little apart so neighbouring sections read separately.
const SECTION_FILL: Record<string, Rgb> = {
  core: gray(0.86), tail: gray(0.83), head: gray(0.88),
  leg_L: gray(0.79), leg_R: gray(0.79), arm_L: gray(0.79), arm_R: gray(0.79),
  foot_L: gray(0.91), foot_R: gray(0.91), hand_L: gray(0.91), hand_R: gray(0.91),
};
const OUTLINE: Rgb = gray(0.3);
// Parts drawn under one shared outline, by body name: the thoracic and lumbar vertebrae, whose
// overlapping spheres otherwise swap places in the drawing order from frame to frame.
const MERGED: [RegExp, string][] = [[/^vertebra_\d+$/, 'spine']];

export function quaternionFromRows(m: ArrayLike<number>, o = 0): Quaternion {
  const [a, b, c, d, e, f, g, h, i] = [m[o], m[o + 1], m[o + 2], m[o + 3], m[o + 4], m[o + 5], m[o + 6], m[o + 7], m[o + 8]];
  const trace = a + e + i;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    return [s / 4, (h - f) / s, (c - g) / s, (d - b) / s];
  } else if (a > e && a > i) {
    const s = 2 * Math.sqrt(1 + a - e - i);
    return [(h - f) / s, s / 4, (b + d) / s, (c + g) / s];
  } else if (e > i) {
    const s = 2 * Math.sqrt(1 + e - a - i);
    return [(c - g) / s, (b + d) / s, s / 4, (f + h) / s];
  }
  const s = 2 * Math.sqrt(1 + i - a - e);
  return [(d - b) / s, (c + g) / s, (f + h) / s, s / 4];
}

export function rowsFromQuaternion([w, x, y, z]: Quaternion): number[] {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let [wa, wb] = [1 - t, t];
  if (dot < 0.9995) {
    const angle = Math.acos(dot);
    [wa, wb] = [Math.sin((1 - t) * angle) / Math.sin(angle), Math.sin(t * angle) / Math.sin(angle)];
  }
  const q = a.map((value, k) => wa * value + wb * sign * b[k]) as Quaternion;
  const length = Math.hypot(...q);
  return q.map(value => value / length) as Quaternion;
}

/** A pose as a Slender matrix, in millimetres: rotation rows with the position as the last column. */
export function poseMatrix(position: ArrayLike<number>, p: number, rows: ArrayLike<number>, r: number): Matrix {
  return [
    rows[r], rows[r + 1], rows[r + 2], MM * position[p],
    rows[r + 3], rows[r + 4], rows[r + 5], MM * position[p + 1],
    rows[r + 6], rows[r + 7], rows[r + 8], MM * position[p + 2],
  ];
}

/** Body poses of one simulation frame, for interpolation. */
interface Frame {
  time: number;  // Arrival time (ms).
  positions: Float32Array;
  rotations: Quaternion[];
}

export interface Rig {
  document: EditorDocument;
  armature: string;
  // Rat bodies, parents first, in the order of the armature's bones.
  bodies: { body: number; parent: number | null; rest: Matrix; calibration: Matrix }[];
}

/** The ellipsoid that stands for a MuJoCo geom, or null for geoms the rat does not use. */
function geomShape(type: number, size: number[]): { radii: Vec3; length: number } | null {
  const [a, b, c] = size.map(value => value * MM);
  switch (type) {
    case GEOM.SPHERE: return { radii: { x: a, y: a, z: a }, length: 0 };
    case GEOM.CAPSULE: return { radii: { x: a, y: a, z: a }, length: b };
    case GEOM.ELLIPSOID: return { radii: { x: a, y: b, z: c }, length: 0 };
    case GEOM.CYLINDER: return { radii: { x: a, y: a, z: Math.min(a, b) }, length: Math.max(0, b - a) };
    case GEOM.BOX: return { radii: { x: a, y: b, z: c }, length: 0 };
    default: return null;
  }
}

/**
 * Builds the rat as a Slender document from its first frame. Each bone rests where its body starts,
 * pointing at its children. `calibration` takes a body's frame to its bone's rest frame, so a bone's
 * world matrix is always the body's pose times it.
 */
export function buildRig(geoms: Geoms, bodyPositions: Float32Array, bodyRows: Float32Array, geomPositions: Float32Array, geomRows: Float32Array): Rig {
  const nbody = geoms.body_parentid.length;
  const head = (b: number): Vec3 => ({ x: MM * bodyPositions[3 * b], y: MM * bodyPositions[3 * b + 1], z: MM * bodyPositions[3 * b + 2] });
  const bodies: Rig['bodies'] = [];
  const joints: Vec3[] = [];
  for (let b = 1; b < nbody; b++) {
    const parent = geoms.body_parentid[b] > 0 ? geoms.body_parentid[b] : null;
    const children = geoms.body_parentid.map((p, child) => (p === b && child !== b ? child : -1)).filter(child => child > 0);
    const from = head(b);
    let tail: Vec3 | null = null;
    if (children.length) {
      const mean = children.map(head).reduce((sum, p) => ({ x: sum.x + p.x / children.length, y: sum.y + p.y / children.length, z: sum.z + p.z / children.length }), { x: 0, y: 0, z: 0 });
      tail = distance(from, mean) > MIN_BONE_LENGTH ? mean : null;
    }
    if (tail === null) {
      // A leaf: carry on in the direction from the parent, or along the body's own x.
      const p = parent !== null ? head(parent) : null;
      const away = p && distance(p, from) > 1e-6 ? { x: from.x - p.x, y: from.y - p.y, z: from.z - p.z } : { x: bodyRows[9 * b], y: bodyRows[9 * b + 3], z: bodyRows[9 * b + 6] };
      const length = Math.hypot(away.x, away.y, away.z);
      tail = { x: from.x + (away.x / length) * LEAF_BONE_LENGTH, y: from.y + (away.y / length) * LEAF_BONE_LENGTH, z: from.z + (away.z / length) * LEAF_BONE_LENGTH };
    }
    joints.push(from, tail);
    const rest = restMatrix(from, tail);
    bodies.push({ body: b, parent, rest, calibration: multiply(invertMatrix(poseMatrix(bodyPositions, 3 * b, bodyRows, 9 * b)), rest) });
  }

  let document = addArmature(emptyDocument());
  const armature = document.activeObject!;
  const boneId = (b: number) => `bone-body-${b}`;
  document = updateObject(document, armature, object => ({
    ...object,
    name: 'Rat',
    vertices: joints,
    edges: bodies.map((_, i) => [2 * i, 2 * i + 1]),
    bones: bodies.map(({ body, parent }, i) => ({
      id: boneId(body),
      name: geoms.body_names[body] || `body ${body}`,
      parent: parent !== null ? boneId(parent) : null,
      head: 2 * i,
      tail: 2 * i + 1,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      constraints: [],
    })),
    selectedVertices: new Set(),
  }));

  // Each geom hangs from its body's bone, at the bone's tail as Slender parents to bones.
  const byBody = new Map(bodies.map((entry, i) => [entry.body, { ...entry, length: distance(joints[2 * i], joints[2 * i + 1]) }]));
  geoms.type.forEach((type, g) => {
    const shape = geomShape(type, geoms.size.slice(3 * g, 3 * g + 3));
    const bone = byBody.get(geoms.geom_bodyid[g]);
    if (!shape || !bone || !VISIBLE_GROUPS.has(geoms.group[g])) return;
    const attach = multiply(bone.rest, tailOffset(bone.length));
    const local = decompose(multiply(invertMatrix(attach), poseMatrix(geomPositions, 3 * g, geomRows, 9 * g)));
    const [r, gr, b] = geoms.rgba.slice(4 * g, 4 * g + 3);
    document = addEllipsoid(document, shape, { x: 0, y: 0, z: 0 }, `geom ${g}`);
    document = updateObject(document, document.activeObject!, (object): SceneObject => ({
      ...object,
      parent: boneId(bone.body),
      transform: { position: local.position, rotation: local.rotation, scale: { x: 1, y: 1, z: 1 } },
      // MuJoCo's colour is what three.js then lights; drawn flat it needs lifting toward white.
      fill: { r: lift(r), g: lift(gr), b: lift(b) },
      border: { color: { r: r * 0.45, g: gr * 0.45, b: b * 0.45 }, width: BORDER_WIDTH },
    }));
  });
  return { document: { ...document, selectedObjects: [], activeObject: null }, armature, bodies };
}

/**
 * The rig with each bone posed so it lands on its body. Slender puts a bone at its parent's
 * matrix, back out of the parent's rest, into its own rest, then its pose, so the pose that puts it
 * at `world` is the inverse of that base times `world`. `bodyPose` gives a body's world matrix (mm).
 */
export function poseRig(rig: Rig, bodyPose: (body: number) => Matrix): EditorDocument {
  const world = new Map<number, Matrix>();
  const rests = new Map(rig.bodies.map(({ body, rest }) => [body, rest]));
  const transforms = rig.bodies.map(({ body, parent, rest, calibration }) => {
    const bone = multiply(bodyPose(body), calibration);
    world.set(body, bone);
    const base = parent !== null ? multiply(multiply(world.get(parent)!, invertMatrix(rests.get(parent)!)), rest) : rest;
    const pose = multiply(invertMatrix(base), bone);
    const [w, x, y, z] = quaternionFromRows([pose[0], pose[1], pose[2], pose[4], pose[5], pose[6], pose[8], pose[9], pose[10]]);
    return { position: matrixOrigin(pose), rotation: { w, x, y, z }, scale: { x: 1, y: 1, z: 1 } };
  });
  return updateObject(rig.document, rig.armature, object => ({
    ...object,
    bones: object.bones!.map((bone, i) => ({ ...bone, transform: transforms[i] })),
  }));
}

function floorNodes(center: Vec3): SceneNode[] {
  const transform = (x: number, y: number) => ({ position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
  const nodes: ShapeNode[] = [{
    kind: 'shape', name: 'floor', transform: transform(center.x, center.y),
    geometry: { kind: 'rect', width: 400 * TILE, height: 400 * TILE, cornerRadius: 0 },
    style: { fill: { ...FLOOR_LIGHT, a: 1 }, stroke: null },
  }];
  const [ci, cj] = [Math.round(center.x / TILE), Math.round(center.y / TILE)];
  for (let i = ci - TILES_AROUND; i <= ci + TILES_AROUND; i++) {
    for (let j = cj - TILES_AROUND; j <= cj + TILES_AROUND; j++) {
      if ((((i + j) % 2) + 2) % 2 === 1) {
        nodes.push({
          kind: 'shape', name: 'tile', transform: transform((i + 0.5) * TILE, (j + 0.5) * TILE),
          geometry: { kind: 'rect', width: TILE, height: TILE, cornerRadius: 0 },
          style: { fill: { ...FLOOR_DARK, a: 1 }, stroke: null },
        });
      }
    }
  }
  return nodes;
}

export class SlenderRenderer implements SceneRenderer {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private geoms: Geoms | null = null;
  private rig: Rig | null = null;
  private previous: Frame | null = null;
  private current: Frame | null = null;
  // Orbit about the rat, as the three.js version starts.
  private yaw = -0.686;
  private pitch = -0.337;
  private distance = 755;
  private target: Vec3 | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: number | null = null;
  private frameRequest = 0;
  private resizeObserver: ResizeObserver;
  private size = { width: 1, height: 1, ratio: 1 };
  private heading: number | null = null;
  private lastRender = 0;
  // Marks on the ground (mm), each fading out from when it was made.
  private marks: { x: number; y: number; born: number; color: Rgb }[] = [];

  constructor(private container: HTMLElement, private options: SlenderRendererOptions = {}) {
    const orbit = (options.camera ?? 'orbit') === 'orbit';
    // The side camera swings round with a horizontal drag; vertical touch drags still scroll the page.
    this.canvas.style.cssText = `display:block;width:100%;height:100%;cursor:grab;touch-action:${orbit ? 'none' : 'pan-y'}`;
    container.appendChild(this.canvas);
    if (options.distance !== undefined) this.distance = options.distance;
    if (options.pitch !== undefined) this.pitch = options.pitch;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    if (orbit) {
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      this.canvas.addEventListener('pointermove', this.onPointerMove);
      this.canvas.addEventListener('pointerup', this.onPointerUp);
      this.canvas.addEventListener('pointercancel', this.onPointerUp);
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    } else {
      this.canvas.addEventListener('pointerdown', this.onSwingStart);
      this.canvas.addEventListener('pointermove', this.onSwingMove);
      this.canvas.addEventListener('pointerup', this.onSwingEnd);
      this.canvas.addEventListener('pointercancel', this.onSwingEnd);
    }
    const loop = () => {
      this.render();
      this.frameRequest = requestAnimationFrame(loop);
    };
    this.frameRequest = requestAnimationFrame(loop);
  }

  set_geoms(geoms: Geoms) {
    this.geoms = geoms;
    this.rig = null;
    this.parts = null;
  }

  update(xpos: Float32Array, xmat: Float32Array, _position: number[], snap = false, body?: { xpos: Float32Array, xmat: Float32Array }) {
    if (!this.geoms || !body) return;
    if (!this.rig) this.rig = buildRig(this.geoms, body.xpos, body.xmat, xpos, xmat);
    const rotations: Quaternion[] = [];
    for (let b = 0; b < body.xmat.length / 9; b++) rotations.push(quaternionFromRows(body.xmat, 9 * b));
    const frame: Frame = { time: performance.now(), positions: body.xpos, rotations };
    this.previous = snap || this.current === null ? frame : this.current;
    this.current = frame;
  }

  /**
   * Leaves a disc on the ground under a body (by MuJoCo name) at its latest simulated position,
   * which fades out over `lifetime` ms. Marks stay put in the world, so they stream past as the
   * camera follows the rat.
   */
  addMark(body: string, color: Rgb, lifetime = MARK_LIFETIME) {
    const b = this.geoms?.body_names.indexOf(body) ?? -1;
    const frame = this.current;
    if (b < 0 || !frame) return;
    const now = performance.now();
    this.marks = this.marks.filter(m => now - m.born < lifetime);
    this.marks.push({ x: MM * frame.positions[3 * b], y: MM * frame.positions[3 * b + 1], born: now, color });
  }

  /**
   * For each geom's ellipsoid (named `geom <index>`): its fill, and the shared outline it is drawn
   * under, if any.
   */
  private parts: { fill: Map<string, Rgb>; merged: Map<string, string> } | null = null;
  private partsOf() {
    if (this.parts) return this.parts;
    const fill = new Map<string, Rgb>();
    const merged = new Map<string, string>();
    const g = this.geoms;
    if (g) {
      g.geom_bodyid.forEach((body, i) => {
        const key = `geom ${i}`;
        const name = (g.geom_names?.[i] ?? '').replace(/_collision$/, '');
        const bodyName = g.body_names[body] ?? '';
        const section = SECTIONS.find(([pattern]) => pattern.test(bodyName));
        const color = LOOSE_PARTS.has(name) ? LOOSE_COLORS[name] : section && SECTION_FILL[section[1](bodyName)];
        if (color) fill.set(key, color);
        const group = MERGED.find(([pattern]) => pattern.test(bodyName));
        if (group) merged.set(key, group[1]);
      });
    }
    this.parts = { fill, merged };
    return this.parts;
  }

  /** The rat document at the current display time: bones posed from interpolated body poses. */
  private posedDocument(): { document: EditorDocument; root: Vec3; heading: number } | null {
    const [a, b, rig] = [this.previous, this.current, this.rig];
    if (!a || !b || !rig) return null;
    const interval = b.time - a.time;
    const t = interval > 0 ? Math.min(1, (performance.now() - b.time) / interval) : 1;
    const document = poseRig(rig, body => {
      const p = 3 * body;
      const position = [0, 1, 2].map(k => a.positions[p + k] + (b.positions[p + k] - a.positions[p + k]) * t);
      return poseMatrix(position, 0, rowsFromQuaternion(slerp(a.rotations[body], b.rotations[body], t)), 0);
    });
    const root = rig.bodies[0].body;
    // The direction the rat's root body faces (its local x axis), in the ground plane.
    const rows = rowsFromQuaternion(slerp(a.rotations[root], b.rotations[root], t));
    const heading = Math.atan2(rows[3], rows[0]);
    return { document, heading, root: { x: MM * (a.positions[3 * root] + (b.positions[3 * root] - a.positions[3 * root]) * t), y: MM * (a.positions[3 * root + 1] + (b.positions[3 * root + 1] - a.positions[3 * root + 1]) * t), z: 50 } };
  }

  private camera(): Camera {
    const target = this.target ?? { x: 0, y: 0, z: 50 };
    const forward = { x: -Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.cos(this.yaw) * Math.cos(this.pitch), z: Math.sin(this.pitch) };
    return {
      position: { x: target.x - forward.x * this.distance, y: target.y - forward.y * this.distance, z: target.z - forward.z * this.distance },
      rotation: { x: this.pitch, y: 0, z: this.yaw },
      focalLength: FOV_FOCAL * this.size.height,
    };
  }

  private render() {
    const { ctx } = this;
    const { width, height, ratio } = this.size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.options.background ?? SKY;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const posed = this.posedDocument();
    if (!posed) return;
    this.target = posed.root;
    if (this.options.camera === 'side') {
      // Ease toward the heading (the shortest way round), so the camera ignores the stride's sway.
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastRender) / 1000);
      this.lastRender = now;
      if (this.heading === null) this.heading = posed.heading;
      let d = posed.heading - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const lag = this.options.headingLag ?? 0.8;
      this.heading = lag > 0 ? this.heading + d * (1 - Math.exp(-dt / lag)) : posed.heading;
      // A fling keeps swinging the camera, slowing to a stop.
      if (!this.swing.dragging) {
        this.swing.offset += this.swing.velocity * dt;
        this.swing.velocity *= Math.exp(-dt / SWING_DECAY);
      }
      // With yaw equal to the heading, the camera looks at the rat's left side and its forward
      // direction is screen right; dragging swings it round the rat from there.
      this.yaw = this.heading + this.swing.offset;
    }
    const camera = this.camera();
    ctx.setTransform(ratio, 0, 0, ratio, (ratio * width) / 2, (ratio * height) / 2);
    const tolerance = 0.25;
    const background = { r: 0, g: 0, b: 0, a: 1 };

    if (this.options.floor ?? true) drawItems(ctx, projectScene({ background, camera, nodes: floorNodes(posed.root) }, tolerance));

    if (this.marks.length) {
      const now = performance.now();
      this.marks = this.marks.filter(m => now - m.born < MARK_LIFETIME);
      const nodes: ShapeNode[] = this.marks.map(m => ({
        kind: 'shape', name: 'mark',
        transform: { position: { x: m.x, y: m.y, z: 0.2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        geometry: { kind: 'ellipse', radiusX: MARK_RADIUS, radiusY: MARK_RADIUS },
        style: { fill: { ...m.color, a: 0.6 * (1 - (now - m.born) / MARK_LIFETIME) }, stroke: null },
      }));
      drawItems(ctx, projectScene({ background, camera, nodes }, tolerance));
    }

    const rat = toScene(posed.document, camera, 0, null);
    // Shadows: every part flattened onto the floor along the light, filled as one shape.
    const shadows = rat.nodes.flatMap((node): EllipsoidNode[] => (node.kind === 'ellipsoid' && node.worldMatrix
      ? [{ ...node, border: null, worldMatrix: { kind: 'fixed', value: multiply(SHADOW, node.worldMatrix.value) } }]
      : []));
    const shadowPath = new Path2D();
    for (const item of projectScene({ background, camera, nodes: shadows }, tolerance)) {
      if (item.kind === 'ellipsoid') shadowPath.addPath(ellipsoidOutline(item));
    }
    ctx.fillStyle = 'rgba(40, 30, 30, 0.22)';
    ctx.fill(shadowPath, 'nonzero');

    const items = projectScene(rat, tolerance);
    if (this.options.mergeOutlines ?? true) drawSections(ctx, items, this.partsOf());
    else drawItems(ctx, shadeByDepth(items));
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    this.size = { width, height, ratio };
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
  }

  private onPointerDown = (event: PointerEvent) => {
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.canvas.style.cursor = 'grabbing';
  };

  private onPointerMove = (event: PointerEvent) => {
    const last = this.pointers.get(event.pointerId);
    if (!last) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.yaw -= (event.clientX - last.x) * 0.008;
      this.pitch = Math.max(-1.5, Math.min(0.2, this.pitch - (event.clientY - last.y) * 0.008));
    } else if (this.pointers.size === 2) {
      const [p, q] = [...this.pointers.values()];
      const spread = Math.hypot(p.x - q.x, p.y - q.y);
      if (this.pinch !== null && spread > 0) this.zoom(this.pinch / spread);
      this.pinch = spread;
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    this.pinch = null;
    if (this.pointers.size === 0) this.canvas.style.cursor = 'grab';
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.zoom(Math.exp(event.deltaY * 0.001));
  };

  // The side camera's swing round the rat (rad, relative to the heading), and how fast it is turning.
  private swing = { offset: 0, velocity: 0, dragging: false, x: 0, time: 0 };

  private onSwingStart = (event: PointerEvent) => {
    this.canvas.setPointerCapture(event.pointerId);
    this.swing = { ...this.swing, dragging: true, velocity: 0, x: event.clientX, time: event.timeStamp };
    this.canvas.style.cursor = 'grabbing';
  };

  private onSwingMove = (event: PointerEvent) => {
    const s = this.swing;
    if (!s.dragging) return;
    const turn = -(event.clientX - s.x) * SWING_PER_PIXEL;
    const dt = Math.max(1e-3, (event.timeStamp - s.time) / 1000);
    s.offset += turn;
    // The release speed is a running average, so a pause before letting go settles it.
    s.velocity = s.velocity * 0.6 + (turn / dt) * 0.4;
    s.x = event.clientX;
    s.time = event.timeStamp;
  };

  private onSwingEnd = (event: PointerEvent) => {
    const s = this.swing;
    if (!s.dragging) return;
    s.dragging = false;
    // Held still before release: no fling.
    if (event.timeStamp - s.time > 80) s.velocity = 0;
    this.canvas.style.cursor = 'grab';
  };

  private zoom(factor: number) {
    this.distance = Math.max(150, Math.min(6000, this.distance * factor));
  }

  dispose() {
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }
}

/**
 * Draws the rat: each part in its own fill with a gray outline, except parts that share an outline
 * (see MERGED), which draw as one shape: every outline stroked at twice the border width, then one
 * fill over them all. A merged shape sorts by its parts' average depth. Fills darken with depth,
 * except the eyes and teeth.
 */
function drawSections(ctx: CanvasRenderingContext2D, items: DrawItem[], { fill, merged }: { fill: Map<string, Rgb>; merged: Map<string, string> }) {
  type Group = { key: string; depth: number; parts: EllipsoidItem[] };
  const groups = new Map<string, Group>();
  const order: (Group | DrawItem)[] = [];
  for (const item of items) {
    const key = item.kind === 'ellipsoid' && item.name ? merged.get(item.name) : undefined;
    if (!key) {
      order.push(item);
      continue;
    }
    let group = groups.get(key);
    if (!group) {
      group = { key, depth: 0, parts: [] };
      groups.set(key, group);
      order.push(group);
    }
    group.parts.push(item as EllipsoidItem);
  }
  for (const group of groups.values()) group.depth = group.parts.reduce((sum, p) => sum + p.depth, 0) / group.parts.length;
  const depths = order.map(x => x.depth);
  const [near, far] = [Math.min(...depths), Math.max(...depths)];
  const darken = (rgb: Rgb, depth: number): Rgb => {
    const k = far > near ? 1 - (DEPTH_DARKENING * (depth - near)) / (far - near) : 1;
    return { r: rgb.r * k, g: rgb.g * k, b: rgb.b * k };
  };
  const css = ({ r, g, b }: Rgb) => `rgb(${r * 255}, ${g * 255}, ${b * 255})`;
  order.sort((a, b) => b.depth - a.depth);
  ctx.lineJoin = 'round';
  for (const entry of order) {
    if (!('parts' in entry)) {
      if (entry.kind !== 'ellipsoid') {
        drawItems(ctx, [entry]);
        continue;
      }
      const own = entry.name ? fill.get(entry.name) : undefined;
      const loose = own !== undefined && Object.values(LOOSE_COLORS).includes(own);
      const color = own ? (loose ? own : darken(own, entry.depth)) : darken(entry.fill, entry.depth);
      drawItems(ctx, [{ ...entry, fill: color, border: entry.border && { ...entry.border, color: { ...OUTLINE, a: 1 } } }]);
      continue;
    }
    const outline = new Path2D();
    for (const part of entry.parts) outline.addPath(ellipsoidOutline(part));
    const first = entry.parts[0];
    if (first.border && first.border.width > 0) {
      ctx.strokeStyle = css(OUTLINE);
      ctx.lineWidth = first.border.width * 2;
      ctx.stroke(outline);
    }
    ctx.fillStyle = css(darken((first.name && fill.get(first.name)) || first.fill, entry.depth));
    ctx.fill(outline, 'nonzero');
  }
}

/** Darkens the parts farther from the camera, so near and far legs read apart in flat colour. */
function shadeByDepth(items: DrawItem[], nearest?: number, farthest?: number): DrawItem[] {
  const depths = items.map(item => item.depth);
  const [near, far] = [nearest ?? Math.min(...depths), farthest ?? Math.max(...depths)];
  if (!(far > near)) return items;
  return items.map(item => {
    if (item.kind !== 'ellipsoid') return item;
    const k = 1 - (DEPTH_DARKENING * (item.depth - near)) / (far - near);
    return { ...item, fill: { r: item.fill.r * k, g: item.fill.g * k, b: item.fill.b * k } };
  });
}
