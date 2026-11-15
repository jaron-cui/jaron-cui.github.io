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
import { emptyDocument } from '../document';
import type { EditorDocument, SceneObject } from '../document';
import { serializeProject } from '../projectFile';
import type { ProjectState } from '../projectFile';

// Kept light enough to embed in a busy page: a neat picture of the mechanism, not machinable gears.
// Each tooth is three sides, a flank, a tip and a flank, meeting the next tooth at the root, and
// half a pitch wide on the pitch line. The tooth counts are what the motion and the seamless loop
// depend on.
const M = 15; // module
const HA = 0.7 * M; // tip, above the pitch line
const HF = M; // root, below it
const PINION_TEETH = 8;
const PINION_WIDTH = 22;
const INNER_TEETH = 16; // rings A and B
const OUTER_TEETH = 24; // the reference rings
const R_INNER = (M * INNER_TEETH) / 2; // 120
const R_OUTER = (M * OUTER_TEETH) / 2; // 180
const R_PINION = (M * PINION_TEETH) / 2; // 60
const FACE_WIDTH = 28; // ring teeth, radially
const BODY = 10; // a double-sided ring's body between its roots
const BACKLASH = 1;

// A tooth's half width at its tip, along the pitch line's direction: the flanks run from the full
// half pitch at the root to half of that on the pitch line.
const TIP_HALF = ((Math.PI * M) / 4) * (1 - HA / HF) - BACKLASH / 2;

// Heights. A pinion's axle sits its pitch radius from each ring's pitch plane.
const CENTER = R_PINION;
const Z_INPUT = 0;
const Z_A_LOW = Z_INPUT + CENTER; // ring A's lower pitch plane, where the input pinion meshes
const Z_A_HIGH = Z_A_LOW + 2 * HF + BODY; // its upper one, for the signal pinion
const Z_PINIONS = Z_A_HIGH + CENTER; // signal and reference pinions, on the carrier
const Z_B_LOW = Z_PINIONS + CENTER;
const Z_B_HIGH = Z_B_LOW + 2 * HF + BODY;
const Z_OUTPUT = Z_B_HIGH + CENTER;

type Mesh = { vertices: Vec3[]; faces: Face[]; marked: Edge[] };
const empty = (): Mesh => ({ vertices: [], faces: [], marked: [] });

function merge(...meshes: Mesh[]): Mesh {
  const out = empty();
  for (const mesh of meshes) {
    const o = out.vertices.length;
    out.vertices.push(...mesh.vertices);
    out.faces.push(...mesh.faces.map(([a, b, c]): Face => [a + o, b + o, c + o]));
    out.marked.push(...mesh.marked.map(([a, b]): Edge => [a + o, b + o]));
  }
  return out;
}

// A quad as two triangles.
const quad = (a: number, b: number, c: number, d: number): Face[] => [[a, b, c], [a, c, d]];

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Mesh {
  const vertices: Vec3[] = [];
  for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) vertices.push({ x, y, z });
  // Index = x + 2y + 4z over the corners.
  const faces = [
    ...quad(0, 1, 3, 2), ...quad(4, 5, 7, 6), ...quad(0, 1, 5, 4),
    ...quad(2, 3, 7, 6), ...quad(0, 2, 6, 4), ...quad(1, 3, 7, 5),
  ];
  const marked: Edge[] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  return { vertices, faces, marked };
}

// A flat ring (annulus) about z, from radius r0 to r1 and height z0 to z1, with its four rims marked.
function band(r0: number, r1: number, z0: number, z1: number, segments: number): Mesh {
  const vertices: Vec3[] = [];
  const at = (r: number, z: number, i: number) => ({ x: r * Math.cos((2 * Math.PI * i) / segments), y: r * Math.sin((2 * Math.PI * i) / segments), z });
  for (let i = 0; i < segments; i++) vertices.push(at(r0, z0, i), at(r0, z1, i), at(r1, z0, i), at(r1, z1, i));
  const v = (i: number, k: number) => 4 * (i % segments) + k;
  const faces: Face[] = [];
  const marked: Edge[] = [];
  for (let i = 0; i < segments; i++) {
    faces.push(...quad(v(i, 1), v(i + 1, 1), v(i + 1, 3), v(i, 3))); // top
    faces.push(...quad(v(i, 0), v(i + 1, 0), v(i + 1, 2), v(i, 2))); // bottom
    faces.push(...quad(v(i, 0), v(i + 1, 0), v(i + 1, 1), v(i, 1))); // inner wall
    faces.push(...quad(v(i, 2), v(i + 1, 2), v(i + 1, 3), v(i, 3))); // outer wall
    for (let k = 0; k < 4; k++) marked.push([v(i, k), v(i + 1, k)]);
  }
  return { vertices, faces, marked };
}

// Face teeth around a ring of `teeth` teeth at pitch radius r, on the pitch plane at height z,
// pointing up (dir 1) or down (dir −1). A space is centered on angle `offset`. Each tooth's three
// sides are swept across the face width; its outer end is marked.
function faceTeeth(teeth: number, r: number, z: number, dir: 1 | -1, offset: number): Mesh {
  const rootHalf = Math.PI / teeth;
  const tipHalf = TIP_HALF / r;
  const zRoot = z - dir * HF;
  const zTip = z + dir * HA;
  const parts: Mesh[] = [];
  for (let k = 0; k < teeth; k++) {
    const c = offset + ((k + 0.5) * 2 * Math.PI) / teeth;
    const corners: [number, number][] = [[c - rootHalf, zRoot], [c + rootHalf, zRoot], [c + tipHalf, zTip], [c - tipHalf, zTip]];
    const vertices: Vec3[] = [];
    for (const radius of [r - FACE_WIDTH / 2, r + FACE_WIDTH / 2]) {
      for (const [angle, height] of corners) vertices.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: height });
    }
    const faces = [
      ...quad(0, 1, 2, 3), ...quad(4, 5, 6, 7),
      // No root face: it sits on the ring's body.
      ...quad(1, 2, 6, 5), ...quad(2, 3, 7, 6), ...quad(3, 0, 4, 7),
    ];
    const marked: Edge[] = [[4, 5], [5, 6], [6, 7], [7, 4]];
    parts.push({ vertices, faces, marked });
  }
  return merge(...parts);
}

// A ring with face teeth: a body from z0 to z1, and teeth on its lower and/or upper pitch planes.
function faceRing(teeth: number, r: number, z0: number, z1: number, low: number | null, high: number | null, offset = 0): Mesh {
  const parts = [band(r - FACE_WIDTH / 2, r + FACE_WIDTH / 2, z0, z1, teeth)];
  if (low !== null) parts.push(faceTeeth(teeth, r, low, -1, offset));
  if (high !== null) parts.push(faceTeeth(teeth, r, high, 1, offset));
  return merge(...parts);
}

// A pinion with its axle along local x and a tooth pointing straight up and down. Each tooth is
// three sides, so the outline is three points a tooth: the root it shares with the tooth before,
// then its two tip corners. Both faces' outlines are marked, plus a spoke on each face from the
// center to the top tooth, which shows it turning.
function pinion(): Mesh {
  const tip = R_PINION + HA;
  const root = R_PINION - HF;
  const tipHalf = TIP_HALF / tip;
  const step = (2 * Math.PI) / PINION_TEETH;
  // In the face's own (u, v) plane, tooth 0 on +u; counterclockwise.
  const outline: { u: number; v: number }[] = [];
  for (let k = 0; k < PINION_TEETH; k++) {
    const c = k * step;
    for (const [r, angle] of [[root, c - step / 2], [tip, c - tipHalf], [tip, c + tipHalf]]) {
      outline.push({ u: r * Math.cos(angle), v: r * Math.sin(angle) });
    }
  }
  const n = outline.length;
  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  const marked: Edge[] = [];
  for (const x of [PINION_WIDTH / 2, -PINION_WIDTH / 2]) {
    for (const { u, v } of outline) vertices.push({ x, y: -v, z: u });
    vertices.push({ x, y: 0, z: 0 });
  }
  const front = (i: number) => i % n;
  const back = (i: number) => n + 1 + (i % n);
  for (let i = 0; i < n; i++) {
    faces.push([n, front(i), front(i + 1)], [2 * n + 1, back(i), back(i + 1)]);
    faces.push(...quad(front(i), front(i + 1), back(i + 1), back(i)));
    marked.push([front(i), front(i + 1)], [back(i), back(i + 1)]);
  }
  // Point 1 is tooth 0's first tip corner; the spoke goes there.
  marked.push([n, front(1)], [2 * n + 1, back(1)]);
  return { vertices, faces, marked };
}

// Turns a mesh about z by an angle.
function turned(mesh: Mesh, angle: number): Mesh {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { ...mesh, vertices: mesh.vertices.map(({ x, y, z }) => ({ x: c * x - s * y, y: s * x + c * y, z })) };
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

let nextId = 1;
const objects: SceneObject[] = [];
function add(name: string, mesh: Mesh, fill: Rgb, options: {
  parent?: SceneObject; position?: Vec3; rotation?: Record<'x' | 'y' | 'z', number | ReturnType<typeof track>>;
} = {}): SceneObject {
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
    fill,
    border: { color: { r: 0.12, g: 0.12, b: 0.15 }, width: 1.6 },
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

const GRAY = { r: 0.62, g: 0.64, b: 0.68 };
const STEEL = { r: 0.55, g: 0.66, b: 0.8 };
const ORANGE = { r: 0.96, g: 0.66, b: 0.32 };
const GREEN = { r: 0.5, g: 0.8, b: 0.52 };
const PURPLE = { r: 0.68, g: 0.56, b: 0.88 };
const LILAC = { r: 0.84, g: 0.78, b: 0.96 };
const YELLOW = { r: 0.98, g: 0.88, b: 0.45 };
const RED = { r: 0.92, g: 0.4, b: 0.36 };

// The base: a bar, posts up to its ring, and the input pinion's bracket.
const BASE_BOTTOM = Z_INPUT - 70;
const outerLow = Z_A_HIGH - HF; // the base ring's root plane
const outerBody = outerLow - 12;
add('Base', merge(
  box(-R_OUTER - 30, R_OUTER + 30, -20, 20, BASE_BOTTOM, BASE_BOTTOM + 14),
  box(R_OUTER - 10, R_OUTER + 10, -10, 10, BASE_BOTTOM + 14, outerBody),
  box(-R_OUTER - 10, -R_OUTER + 10, -10, 10, BASE_BOTTOM + 14, outerBody),
  box(R_INNER + PINION_WIDTH / 2 + 3, R_INNER + PINION_WIDTH / 2 + 11, -8, 8, BASE_BOTTOM + 14, Z_INPUT + 6),
  box(R_INNER + PINION_WIDTH / 2, R_INNER + PINION_WIDTH / 2 + 3, -3, 3, Z_INPUT - 3, Z_INPUT + 3),
), GRAY);
// A quarter turn isn't a whole number of the outer rings' teeth, so their spaces are turned to sit
// under the reference pinions there.
const OUTER_OFFSET = Math.PI / 2 - Math.round(OUTER_TEETH / 4) * ((2 * Math.PI) / OUTER_TEETH);
add('Base ring', faceRing(OUTER_TEETH, R_OUTER, outerBody, outerLow, null, Z_A_HIGH, OUTER_OFFSET), GRAY);
add('Input pinion', pinion(), RED, { position: { x: R_INNER, y: 0, z: Z_INPUT }, rotation: { x: track(g => g.input), y: 0, z: 0 } });
add('Ring A', faceRing(INNER_TEETH, R_INNER, Z_A_LOW + HF, Z_A_HIGH - HF, Z_A_LOW, Z_A_HIGH), ORANGE, { rotation: { x: 0, y: 0, z: track(g => g.a) } });

// The carrier: a band between the two pinion circles, with an axle out to each pinion.
const carrier = add('Carrier', merge(
  band(R_INNER + 20, R_OUTER - 20, Z_PINIONS - 7, Z_PINIONS + 7, 24),
  ...[0, Math.PI].map(angle => turned(box(R_INNER + PINION_WIDTH / 2, R_INNER + 21, -3, 3, Z_PINIONS - 3, Z_PINIONS + 3), angle)),
  ...[Math.PI / 2, (3 * Math.PI) / 2].map(angle => turned(box(R_OUTER - 21, R_OUTER - PINION_WIDTH / 2, -3, 3, Z_PINIONS - 3, Z_PINIONS + 3), angle)),
), PURPLE, { rotation: { x: 0, y: 0, z: track(g => g.c) } });
for (const [i, angle] of [0, Math.PI].entries()) {
  add(`Signal pinion ${i + 1}`, pinion(), YELLOW, {
    parent: carrier,
    position: { x: R_INNER * Math.cos(angle), y: R_INNER * Math.sin(angle), z: Z_PINIONS },
    rotation: { x: track(g => g.signal), y: 0, z: angle },
  });
}
for (const [i, angle] of [Math.PI / 2, (3 * Math.PI) / 2].entries()) {
  add(`Reference pinion ${i + 1}`, pinion(), LILAC, {
    parent: carrier,
    position: { x: R_OUTER * Math.cos(angle), y: R_OUTER * Math.sin(angle), z: Z_PINIONS },
    rotation: { x: track(g => g.reference), y: 0, z: angle },
  });
}

add('Ring B', faceRing(INNER_TEETH, R_INNER, Z_B_LOW + HF, Z_B_HIGH - HF, Z_B_LOW, Z_B_HIGH), GREEN, { rotation: { x: 0, y: 0, z: track(g => g.b) } });

// The top segment: its ring, posts up to a bar, and the output pinion's bracket. It turns at φ.
const outerHigh = Z_B_LOW + HF; // the top ring's root plane
const TOP = Z_OUTPUT + 48;
const top = add('Top segment', merge(
  box(-R_OUTER - 30, R_OUTER + 30, -20, 20, TOP, TOP + 14),
  box(R_OUTER - 10, R_OUTER + 10, -10, 10, outerHigh + 12, TOP),
  box(-R_OUTER - 10, -R_OUTER + 10, -10, 10, outerHigh + 12, TOP),
  box(R_INNER + PINION_WIDTH / 2 + 3, R_INNER + PINION_WIDTH / 2 + 11, -8, 8, Z_OUTPUT - 6, TOP),
  box(R_INNER + PINION_WIDTH / 2, R_INNER + PINION_WIDTH / 2 + 3, -3, 3, Z_OUTPUT - 3, Z_OUTPUT + 3),
), STEEL, { rotation: { x: 0, y: 0, z: track(g => g.phi) } });
add('Top ring', faceRing(OUTER_TEETH, R_OUTER, outerHigh, outerHigh + 12, Z_B_LOW, null, OUTER_OFFSET), STEEL, { parent: top });
add('Output pinion', pinion(), RED, { parent: top, position: { x: R_INNER, y: 0, z: Z_OUTPUT }, rotation: { x: track(g => g.output), y: 0, z: 0 } });

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
const triangles = objects.reduce((sum, o) => sum + o.faces.length, 0);
console.log(`Wrote ${out}: ${objects.length} objects, ${triangles} triangles.`);
