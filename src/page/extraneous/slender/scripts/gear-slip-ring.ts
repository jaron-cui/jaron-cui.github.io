// Builds gear-slip-ring.slender: a drive passed through a continuously rotating joint with gears, the
// way a slip ring passes power. The top segment can spin forever while a pinion in the base drives a
// pinion in the top, and turning the joint doesn't turn the output.
//
//   npx tsx src/page/extraneous/slender/scripts/gear-slip-ring.ts
//
// Everything turns about the joint's vertical axis (z) except the pinions, whose axles point outward
// from it. Two rings with face teeth on both sides carry the drive: the input pinion on the base turns
// ring A, a signal pinion between A and B turns B, and B turns the output pinion on the top segment.
// Alone, that leaks the joint's rotation into the output (the output turns with b − φ). The fix is
// the signal pinion's carrier, which a reference pinion rolling between a ring fixed to the base and
// a ring fixed to the top holds at exactly half the joint angle, c = φ / 2. A pinion between two
// rings keeps its carrier at their average, so then b = 2c − a = φ − a, and the output turns with
// b − φ = −a: the input alone.
//
// The loop: the top segment turns a full turn with the input still (the output doesn't turn), then
// the input turns one way, stops, and turns back, and the output follows it each time. Every part
// ends where an identical-looking part started, so the loop is seamless.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Edge, Face, Rgb, Vec3 } from '../../../../lib/vrender/model';
import type { EdgeCurve } from '../curves';
import { emptyDocument } from '../document';
import type { EditorDocument, SceneObject } from '../document';
import { serializeProject } from '../projectFile';
import type { ProjectState } from '../projectFile';

// Kept light enough to embed in a busy page: a neat picture of the mechanism, not machinable gears.
// Every toothed part is split into one object per tooth under an empty on its axis, which carries
// the motion. The painter's algorithm then sorts each tooth on its own, so a ring's near side covers
// a pinion and its far side doesn't. The pieces have their outlines turned off, so the cuts between
// them don't show, and mark the lines that should.
//
// Teeth have straight flanks at 20°, are 0.4 of the pitch thick on the pitch line (the gaps 0.6), and
// stand HA above it and HF below. The tooth counts are what the motion and the seamless loop depend on.
const M = 15; // module
const HA = 0.7 * M; // tip, above the pitch line
const HF = M; // root, below it
const PITCH = Math.PI * M;
const THICK = 0.4 * PITCH;
const FLANK = Math.tan((20 * Math.PI) / 180);
const PINION_TEETH = 8;
const PINION_WIDTH = 22;
const INNER_TEETH = 16; // rings A and B
const OUTER_TEETH = 24; // the reference rings
const R_INNER = (M * INNER_TEETH) / 2; // 120
const R_OUTER = (M * OUTER_TEETH) / 2; // 180
const R_PINION = (M * PINION_TEETH) / 2; // 60
const FACE_WIDTH = 28; // ring teeth, radially
const BODY = 10; // a double-sided ring's body between its roots
const BACK = 12; // a one-sided ring's body behind its roots

// A tooth's half width at a height above the pitch line (negative below it).
const halfWidth = (height: number) => THICK / 2 - height * FLANK;

// Heights. A pinion's axle sits its pitch radius from each ring's pitch plane.
const CENTER = R_PINION;
const Z_INPUT = 0;
const Z_A_LOW = Z_INPUT + CENTER; // ring A's lower pitch plane, where the input pinion meshes
const Z_A_HIGH = Z_A_LOW + 2 * HF + BODY; // its upper one, for the signal pinion
const Z_PINIONS = Z_A_HIGH + CENTER; // signal and reference pinions, on the carrier
const Z_B_LOW = Z_PINIONS + CENTER;
const Z_B_HIGH = Z_B_LOW + 2 * HF + BODY;
const Z_OUTPUT = Z_B_HIGH + CENTER;

type Mesh = { vertices: Vec3[]; faces: Face[]; marked: Edge[]; curves: EdgeCurve[] };
const emptyMesh = (): Mesh => ({ vertices: [], faces: [], marked: [], curves: [] });

function merge(...meshes: Mesh[]): Mesh {
  const out = emptyMesh();
  for (const mesh of meshes) {
    const o = out.vertices.length;
    out.vertices.push(...mesh.vertices);
    out.faces.push(...mesh.faces.map(face => face.map(i => i + o)));
    out.marked.push(...mesh.marked.map(([a, b]): Edge => [a + o, b + o]));
    out.curves.push(...mesh.curves.map(({ a, b, shape }) => ({ a: a + o, b: b + o, shape })));
  }
  return out;
}

const sub = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const dot = (p: Vec3, q: Vec3) => p.x * q.x + p.y * q.y + p.z * q.z;
const cross = (p: Vec3, q: Vec3): Vec3 => ({ x: p.y * q.z - p.z * q.y, y: p.z * q.x - p.x * q.z, z: p.x * q.y - p.y * q.x });
const Z_AXIS = { x: 0, y: 0, z: 1 };
const X_AXIS = { x: 1, y: 0, z: 0 };

// How far an arc must bow from its chord to be drawn as one. Shallower ones stay straight: they'd
// look the same, and every arc adds pieces to draw and marked lines to test each frame.
const MIN_BOW = 1;

// Bends the line a → b into the shorter arc of the circle about `center` in the plane square to
// `normal`, a unit axis, if it bows enough to show.
function arc(mesh: Mesh, a: number, b: number, center: Vec3, normal: Vec3) {
  const [pa, pb] = [sub(mesh.vertices[a], center), sub(mesh.vertices[b], center)];
  const radius = Math.sqrt(Math.max(0, dot(pa, pa) - dot(pa, normal) ** 2));
  const chord = sub(pa, pb);
  const halfChord = Math.sqrt(Math.max(0, dot(chord, chord) - dot(chord, normal) ** 2)) / 2;
  if (radius - Math.sqrt(Math.max(0, radius ** 2 - halfChord ** 2)) < MIN_BOW) {
    return;
  }
  const axis = Math.abs(normal.x) < 0.9 ? X_AXIS : { x: 0, y: 1, z: 0 };
  mesh.curves.push({
    a, b, shape: { kind: 'arc', radii: { x: radius, y: radius }, axis, normal, large: false, sweep: dot(cross(pa, pb), normal) > 0 },
  });
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Mesh {
  const vertices: Vec3[] = [];
  for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) vertices.push({ x, y, z });
  // Index = x + 2y + 4z over the corners.
  const faces: Face[] = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
  const marked: Edge[] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  return { vertices, faces, marked, curves: [] };
}

// One section of a ring with face teeth, centered on angle 0: a profile in (u along the pitch
// circle, z) swept radially across the face width. The edges listed in `cuts` meet the next section,
// so the lines touching them stay unmarked. Their faces are still there, unmarked: an open end would
// let the section's own hidden lines show through it. Level edges are arcs about the joint axis.
function ringSection(profile: [number, number][], cuts: number[], r: number, height: (z: number) => number): Mesh {
  const n = profile.length;
  const mesh = emptyMesh();
  for (const radius of [r - FACE_WIDTH / 2, r + FACE_WIDTH / 2]) {
    for (const [u, z] of profile) mesh.vertices.push({ x: radius * Math.cos(u / r), y: radius * Math.sin(u / r), z: height(z) });
  }
  mesh.faces.push([...Array(n).keys()], [...Array(n).keys()].map(i => n + i));
  const cutVertices = new Set(cuts.flatMap(i => [i, (i + 1) % n]));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!cutVertices.has(i)) {
      mesh.marked.push([i, n + i]);
    }
    mesh.faces.push([i, j, n + j, n + i]);
    if (cuts.includes(i)) {
      continue;
    }
    mesh.marked.push([i, j], [n + i, n + j]);
    if (profile[i][1] === profile[j][1]) {
      const center = { x: 0, y: 0, z: height(profile[i][1]) };
      arc(mesh, i, j, center, Z_AXIS);
      arc(mesh, n + i, n + j, center, Z_AXIS);
    }
  }
  return mesh;
}

// A tooth in a ring's profile, root at 0 and tip at HF + HA, from the cut before it to the one after.
function toothProfile(): [number, number][] {
  const [root, tip] = [halfWidth(-HF), halfWidth(HA)];
  return [[-PITCH / 2, 0], [-root, 0], [-tip, HF + HA], [tip, HF + HA], [root, 0], [PITCH / 2, 0]];
}

// Rings A and B: a tooth up and a tooth down, 12 sides.
function doubleSection(r: number, zCenter: number): Mesh {
  const up = toothProfile().map(([u, z]): [number, number] => [u, z + BODY / 2]);
  const down = toothProfile().map(([u, z]): [number, number] => [-u, -z - BODY / 2]);
  return ringSection([...up, ...down], [5, 11], r, z => zCenter + z);
}

// The reference rings: a tooth on one side and a flat back, 8 sides. `dir` is which way the tooth
// points from its root plane.
function singleSection(r: number, rootPlane: number, dir: 1 | -1): Mesh {
  const profile: [number, number][] = [...toothProfile(), [PITCH / 2, -BACK], [-PITCH / 2, -BACK]];
  return ringSection(profile, [5, 7], r, z => rootPlane + dir * z);
}

// One tooth of a pinion with its slice of the hub, axle along local x, the tooth pointing up local z.
// The outline runs from the axle out to the middle of the root land before the tooth, round the
// tooth (root arc, flank, tip arc, flank, root arc) and back to the axle from the middle of the land
// after it, swept across the face width. The two cuts to the axle are closed but unmarked, so the
// slices read as one disc. Each slice sorts by its own depth, as a ring's sections do; a whole hub
// sorting at its center draws over whatever passes in front of its edge.
function pinionSection(): Mesh {
  const [root, tip] = [R_PINION - HF, R_PINION + HA];
  const [rootAngle, tipAngle] = [halfWidth(-HF) / root, halfWidth(HA) / tip];
  const land = Math.PI / PINION_TEETH;
  const outline: [number, number][] = [[0, 0], [root, -land], [root, -rootAngle], [tip, -tipAngle], [tip, tipAngle], [root, rootAngle], [root, land]];
  const n = outline.length;
  const mesh = emptyMesh();
  for (const x of [PINION_WIDTH / 2, -PINION_WIDTH / 2]) {
    for (const [r, angle] of outline) mesh.vertices.push({ x, y: r * Math.sin(angle), z: r * Math.cos(angle) });
  }
  mesh.faces.push([...Array(n).keys()], [...Array(n).keys()].map(i => n + i));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mesh.faces.push([i, j, n + j, n + i]);
    // The cuts: the axle to each land's middle.
    if (i === 0 || j === 0) {
      continue;
    }
    mesh.marked.push([i, j], [n + i, n + j]);
    if (i !== 1 && i !== n - 1) {
      mesh.marked.push([i, n + i]);
    }
    if (outline[i][0] === outline[j][0]) {
      arc(mesh, i, j, { x: PINION_WIDTH / 2, y: 0, z: 0 }, X_AXIS);
      arc(mesh, n + i, n + j, { x: -PINION_WIDTH / 2, y: 0, z: 0 }, X_AXIS);
    }
  }
  return mesh;
}

// A section of the carrier's band, centered on angle 0 and `span` wide, with its rims marked. Its
// ends are closed but unmarked.
function carrierSection(span: number): Mesh {
  const mesh = emptyMesh();
  // Index = side + 2 · level + 4 · ring.
  for (const r of [R_INNER + 20, R_OUTER - 20]) for (const z of [Z_PINIONS - 7, Z_PINIONS + 7]) for (const angle of [-span / 2, span / 2]) {
    mesh.vertices.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), z });
  }
  mesh.faces.push([2, 3, 7, 6], [0, 1, 5, 4], [0, 1, 3, 2], [4, 5, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]);
  for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7]]) {
    mesh.marked.push([a, b]);
    arc(mesh, a, b, { x: 0, y: 0, z: mesh.vertices[a].z }, Z_AXIS);
  }
  return mesh;
}

// The motion. φ is the top segment's angle and ψ the input pinion's spin, both piecewise linear.
const LOOP = 10; // seconds
const KEYS: { time: number; phi: number; input: number }[] = [
  { time: 0, phi: 0, input: 0 },
  { time: 4, phi: 2 * Math.PI, input: 0 }, // the joint turns a full turn; the output stays still
  { time: 4.5, phi: 2 * Math.PI, input: 0 },
  { time: 6.5, phi: 2 * Math.PI, input: 2 * Math.PI }, // the input turns; the output follows
  { time: 7.5, phi: 2 * Math.PI, input: 2 * Math.PI }, // both stop
  { time: 9.5, phi: 2 * Math.PI, input: 0 }, // the input turns back; so does the output
  { time: LOOP, phi: 2 * Math.PI, input: 0 },
];

// Every angle, from the joint angle and the input's spin.
function angles(phi: number, input: number) {
  const a = -input * R_PINION / R_INNER; // ring A, driven from below by the input pinion's top
  const c = phi / 2; // the carrier, held at the average of the base (0) and the top (φ)
  const b = 2 * c - a; // ring B, from the signal pinion between A and B
  return {
    phi, a, b, c,
    signal: ((a - c) * R_INNER) / R_PINION, // spin on the carrier, rolling on A below
    reference: ((0 - c) * R_OUTER) / R_PINION, // rolling on the base's ring below
    input,
    output: ((b - phi) * R_INNER) / R_PINION, // rolling on B below, on the top segment
  };
}

type Angles = ReturnType<typeof angles>;
const track = (pick: (angles: Angles) => number) => ({
  kind: 'track' as const,
  keys: KEYS.map(({ time, phi, input }) => ({ time, value: pick(angles(phi, input)), ease: 'linear' as const })),
});

type Rotation = Record<'x' | 'y' | 'z', number | ReturnType<typeof track>>;
type Placement = { parent?: SceneObject; position?: Vec3; rotation?: Rotation; outline?: boolean };

let nextId = 1;
const objects: SceneObject[] = [];
function add(name: string, mesh: Mesh, fill: Rgb, options: Placement = {}): SceneObject {
  const object = {
    id: `object-${nextId++}`,
    name,
    transform: {
      position: options.position ?? { x: 0, y: 0, z: 0 },
      rotation: options.rotation ?? { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    parent: options.parent?.id ?? null,
    constraints: [],
    folder: null,
    visible: true,
    vertices: mesh.vertices,
    faces: mesh.faces,
    edges: [],
    markedEdges: mesh.marked,
    ...(mesh.curves.length ? { curves: mesh.curves } : {}),
    fill,
    border: { color: { r: 0.12, g: 0.12, b: 0.15 }, width: 1.6 },
    ...(options.outline === false ? { outline: false } : {}),
    selectedVertices: new Set<number>(),
    camera: null,
    bones: null,
    deformer: null,
    vertexGroups: [],
    activeGroup: null,
    modifiers: [],
  } as unknown as SceneObject;
  objects.push(object);
  return object;
}

// A part made of pieces: an empty on its axis with the motion, and each piece a child turned to its
// place, with no outline of its own.
function pieces(name: string, fill: Rgb, places: { name: string; mesh: Mesh; rotation: Rotation }[], options: Placement = {}) {
  const parent = add(name, emptyMesh(), fill, options);
  for (const place of places) {
    add(`${name} ${place.name}`, place.mesh, fill, { parent, rotation: place.rotation, outline: false });
  }
  return parent;
}

const turn = (z: number): Rotation => ({ x: 0, y: 0, z });

// A ring of sections, one per tooth, each centered on its tooth.
function ring(name: string, fill: Rgb, teeth: number, section: Mesh, offset: number, options: Placement = {}) {
  const places = Array.from({ length: teeth }, (_, k) => ({
    name: `section ${k + 1}`, mesh: section, rotation: turn(offset + ((k + 0.5) * 2 * Math.PI) / teeth),
  }));
  return pieces(name, fill, places, options);
}

// A pinion: a child per tooth, tooth 1 pointing up local z.
function pinion(name: string, fill: Rgb, options: Placement) {
  const section = pinionSection();
  return pieces(name, fill, Array.from({ length: PINION_TEETH }, (_, k) => ({
    name: `tooth ${k + 1}`, mesh: section, rotation: { x: (k * 2 * Math.PI) / PINION_TEETH, y: 0, z: 0 },
  })), options);
}

// Full colors for the parts that carry the drive from input to output; lighter ones for the frames
// and for the parts that only cancel the joint's rotation.
const lighter = ({ r, g, b }: Rgb, amount = 0.5): Rgb => ({ r: r + (1 - r) * amount, g: g + (1 - g) * amount, b: b + (1 - b) * amount });
const RED = { r: 0.86, g: 0.26, b: 0.24 };
const BLUE = { r: 0.22, g: 0.45, b: 0.86 };
const PURPLE = { r: 0.56, g: 0.32, b: 0.8 };
const GRAY = { r: 0.55, g: 0.57, b: 0.6 };

// The base: a bar, posts up to its ring, and the input pinion's axle out to the post beside it.
// The bar clears the input pinion's teeth.
const BASE_BOTTOM = Z_INPUT - (R_PINION + HA) - 10 - 14;
const outerLow = Z_A_HIGH - HF; // the base ring's root plane
const outerBody = outerLow - BACK;
add('Base', merge(
  box(-R_OUTER - 30, R_OUTER + 30, -20, 20, BASE_BOTTOM, BASE_BOTTOM + 14),
  box(R_OUTER - 10, R_OUTER + 10, -10, 10, BASE_BOTTOM + 14, outerBody),
  box(-R_OUTER - 10, -R_OUTER + 10, -10, 10, BASE_BOTTOM + 14, outerBody),
  box(R_INNER + PINION_WIDTH / 2, R_OUTER - 10, -3, 3, Z_INPUT - 3, Z_INPUT + 3),
), lighter(RED));
// A quarter turn isn't a whole number of the outer rings' teeth, so their spaces are turned to sit
// under the reference pinions there.
const OUTER_OFFSET = Math.PI / 2 - Math.round(OUTER_TEETH / 4) * ((2 * Math.PI) / OUTER_TEETH);
ring('Base ring', lighter(RED), OUTER_TEETH, singleSection(R_OUTER, outerLow, 1), OUTER_OFFSET);
pinion('Input pinion', RED, { position: { x: R_INNER, y: 0, z: Z_INPUT }, rotation: { x: track(g => g.input), y: 0, z: 0 } });
ring('Ring A', PURPLE, INNER_TEETH, doubleSection(R_INNER, (Z_A_LOW + Z_A_HIGH) / 2), 0, { rotation: { x: 0, y: 0, z: track(g => g.a) } });

// The carrier: a band between the two pinion circles in sections, with an axle out to each pinion
// from the section it sits in: signal pinions at 0° and 180°, reference pinions at 90° and 270°.
const CARRIER_SECTIONS = 16;
const carrierSpan = (2 * Math.PI) / CARRIER_SECTIONS;
const axles = [
  box(R_INNER + PINION_WIDTH / 2, R_INNER + 21, -3, 3, Z_PINIONS - 3, Z_PINIONS + 3),
  box(R_OUTER - 21, R_OUTER - PINION_WIDTH / 2, -3, 3, Z_PINIONS - 3, Z_PINIONS + 3),
];
const carrier = pieces('Carrier', lighter(PURPLE), Array.from({ length: CARRIER_SECTIONS }, (_, k) => {
  const quarter = (k * 4) / CARRIER_SECTIONS;
  const band = carrierSection(carrierSpan);
  return {
    name: `section ${k + 1}`,
    mesh: Number.isInteger(quarter) ? merge(band, axles[quarter % 2]) : band,
    rotation: turn(k * carrierSpan),
  };
}), { rotation: { x: 0, y: 0, z: track(g => g.c) } });
for (const [i, angle] of [0, Math.PI].entries()) {
  pinion(`Signal pinion ${i + 1}`, PURPLE, {
    parent: carrier,
    position: { x: R_INNER * Math.cos(angle), y: R_INNER * Math.sin(angle), z: Z_PINIONS },
    rotation: { x: track(g => g.signal), y: 0, z: angle },
  });
}
for (const [i, angle] of [Math.PI / 2, (3 * Math.PI) / 2].entries()) {
  pinion(`Reference pinion ${i + 1}`, lighter(GRAY), {
    parent: carrier,
    position: { x: R_OUTER * Math.cos(angle), y: R_OUTER * Math.sin(angle), z: Z_PINIONS },
    rotation: { x: track(g => g.reference), y: 0, z: angle },
  });
}

ring('Ring B', PURPLE, INNER_TEETH, doubleSection(R_INNER, (Z_B_LOW + Z_B_HIGH) / 2), 0, { rotation: { x: 0, y: 0, z: track(g => g.b) } });

// The top segment: its ring, posts up to a bar, and the output pinion's axle out to the post beside
// it. It turns at φ.
const outerHigh = Z_B_LOW + HF; // the top ring's root plane
const TOP = Z_OUTPUT + R_PINION + HA + 10; // clear of the output pinion's teeth
const top = add('Top segment', merge(
  box(-R_OUTER - 30, R_OUTER + 30, -20, 20, TOP, TOP + 14),
  box(R_OUTER - 10, R_OUTER + 10, -10, 10, outerHigh + BACK, TOP),
  box(-R_OUTER - 10, -R_OUTER + 10, -10, 10, outerHigh + BACK, TOP),
  box(R_INNER + PINION_WIDTH / 2, R_OUTER - 10, -3, 3, Z_OUTPUT - 3, Z_OUTPUT + 3),
), lighter(BLUE), { rotation: { x: 0, y: 0, z: track(g => g.phi) } });
ring('Top ring', lighter(BLUE), OUTER_TEETH, singleSection(R_OUTER, outerHigh, -1), OUTER_OFFSET, { parent: top });
pinion('Output pinion', BLUE, { parent: top, position: { x: R_INNER, y: 0, z: Z_OUTPUT }, rotation: { x: track(g => g.output), y: 0, z: 0 } });

const FRAME_RATE = 24;
const document: EditorDocument = {
  ...emptyDocument(),
  objects,
  skyColor: { r: 0.93, g: 0.94, b: 0.95 },
  frameRate: FRAME_RATE,
  frameStart: 0,
  frameEnd: LOOP * FRAME_RATE,
  nextId,
  selectedObjects: [],
  activeObject: null,
};

const state: ProjectState = {
  document,
  view: {
    orbit: { target: { x: 0, y: 0, z: (BASE_BOTTOM + TOP) / 2 }, yaw: 0.5, pitch: -0.3, distance: 820, focalLength: 800 },
    viewedCamera: null,
    time: 0,
    cursor: { x: 0, y: 0, z: 0 },
  },
  layout: { outlinerWidth: 200, timelineHeight: 180, objectPaneHeight: 340, transformPanelOpen: false, propertiesTab: 'object' },
  settings: {
    selectMode: 'line', showOverlays: true, xRay: false, proportional: false, proportionalRadius: 200, proportionalConnected: false,
    pivot: 'median', brush: { weight: 1, radius: 50, strength: 0.5 },
  },
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'gear-slip-ring.slender');
writeFileSync(out, serializeProject(state));
const faces = objects.reduce((sum, o) => sum + o.faces.length, 0);
console.log(`Wrote ${out}: ${objects.length} objects, ${faces} faces.`);
