// What both gear slip ring demos share: the mechanism's dimensions and tooth shapes, its motion, the
// colors, and building and writing the project. gear-slip-ring.ts makes the solid version and
// gear-slip-ring-flat.ts the flat one; each makes its own geometry from these.
//
// The mechanism passes a drive through a continuously rotating joint with gears, the way a slip ring
// passes power. The top segment can spin forever while a pinion in the base drives a pinion in the
// top, and turning the joint doesn't turn the output.
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
// Teeth have straight flanks at 20°, are 0.4 of the pitch thick on the pitch line (the gaps 0.6), and
// stand HA above it and HF below. The tooth counts are what the motion and the seamless loop depend on.
export const M = 15; // module
export const HA = 0.7 * M; // tip, above the pitch line
export const HF = M; // root, below it
export const PITCH = Math.PI * M;
const THICK = 0.4 * PITCH;
const FLANK = Math.tan((20 * Math.PI) / 180);
export const PINION_TEETH = 8;
export const PINION_WIDTH = 22;
export const INNER_TEETH = 16; // rings A and B
export const OUTER_TEETH = 24; // the reference rings
export const R_INNER = (M * INNER_TEETH) / 2; // 120
export const R_OUTER = (M * OUTER_TEETH) / 2; // 180
export const R_PINION = (M * PINION_TEETH) / 2; // 60
export const BODY = 10; // a double-sided ring's body between its roots
export const BACK = 12; // a one-sided ring's body behind its roots

// A tooth's half width at a height above the pitch line (negative below it).
export const halfWidth = (height: number) => THICK / 2 - height * FLANK;

// Heights. A pinion's axle sits its pitch radius from each ring's pitch plane.
const CENTER = R_PINION;
export const Z_INPUT = 0;
export const Z_A_LOW = Z_INPUT + CENTER; // ring A's lower pitch plane, where the input pinion meshes
export const Z_A_HIGH = Z_A_LOW + 2 * HF + BODY; // its upper one, for the signal pinion
export const Z_PINIONS = Z_A_HIGH + CENTER; // signal and reference pinions, on the carrier
export const Z_B_LOW = Z_PINIONS + CENTER;
export const Z_B_HIGH = Z_B_LOW + 2 * HF + BODY;
export const Z_OUTPUT = Z_B_HIGH + CENTER;

// The frames. The base: a bar, posts up to its ring, and the input pinion's axle out to the post
// beside it; the top segment the same upside down. The bars clear the pinions' teeth.
export const BASE_BOTTOM = Z_INPUT - (R_PINION + HA) - 10 - 14;
export const BASE_RING_ROOT = Z_A_HIGH - HF; // the base ring's root plane
export const TOP_RING_ROOT = Z_B_LOW + HF; // the top ring's
export const TOP = Z_OUTPUT + R_PINION + HA + 10;
// The carrier's band runs round between the signal and reference pinions at their axles' height,
// `share` of the way out from the signal pinions' surfaces to the reference pinions', so it keeps its
// distance from the signal pinions. It curves away from a reference pinion on both sides.
export const carrierRadius = (signalSurface: number, referenceSurface: number, share: number) =>
  signalSurface + share * (referenceSurface - signalSurface);
// A quarter turn isn't a whole number of the outer rings' teeth, so their spaces are turned to sit
// under the reference pinions there.
export const OUTER_OFFSET = Math.PI / 2 - Math.round(OUTER_TEETH / 4) * ((2 * Math.PI) / OUTER_TEETH);

// A ring's profile in (u along the pitch circle, z), one section centered on a tooth. A tooth, root
// at 0 and tip at HF + HA, from the cut before it to the one after.
function toothProfile(): [number, number][] {
  const [root, tip] = [halfWidth(-HF), halfWidth(HA)];
  return [[-PITCH / 2, 0], [-root, 0], [-tip, HF + HA], [tip, HF + HA], [root, 0], [PITCH / 2, 0]];
}

// Rings A and B: a tooth up and a tooth down about the body's middle, 12 sides. Edges 5 and 11 are
// the cuts to the next sections.
export function doubleProfile(): { profile: [number, number][]; cuts: number[] } {
  const up = toothProfile().map(([u, z]): [number, number] => [u, z + BODY / 2]);
  const down = toothProfile().map(([u, z]): [number, number] => [-u, -z - BODY / 2]);
  return { profile: [...up, ...down], cuts: [5, 11] };
}

// The reference rings: a tooth up from the root plane at 0 and a flat back, 8 sides. Edges 5 and 7
// are the cuts.
export function singleProfile(): { profile: [number, number][]; cuts: number[] } {
  return { profile: [...toothProfile(), [PITCH / 2, -BACK], [-PITCH / 2, -BACK]], cuts: [5, 7] };
}

// A pinion tooth's corners as (radius, angle from the tooth's center): root, tip, tip, root.
export function pinionTooth(): [number, number][] {
  const [root, tip] = [R_PINION - HF, R_PINION + HA];
  const [rootAngle, tipAngle] = [halfWidth(-HF) / root, halfWidth(HA) / tip];
  return [[root, -rootAngle], [tip, -tipAngle], [tip, tipAngle], [root, rootAngle]];
}

// Geometry for one object. `edges` are loose lines, drawn in the border's color.
export type Mesh = { vertices: Vec3[]; faces: Face[]; marked: Edge[]; curves: EdgeCurve[]; edges?: Edge[] };
export const emptyMesh = (): Mesh => ({ vertices: [], faces: [], marked: [], curves: [] });

export function merge(...meshes: Mesh[]): Mesh {
  const out = emptyMesh();
  for (const mesh of meshes) {
    const o = out.vertices.length;
    out.vertices.push(...mesh.vertices);
    out.faces.push(...mesh.faces.map(face => face.map(i => i + o)));
    out.marked.push(...mesh.marked.map(([a, b]): Edge => [a + o, b + o]));
    out.curves.push(...mesh.curves.map(({ a, b, shape }) => ({ a: a + o, b: b + o, shape })));
    if (mesh.edges?.length) {
      out.edges = [...(out.edges ?? []), ...mesh.edges.map(([a, b]): Edge => [a + o, b + o])];
    }
  }
  return out;
}

// The motion. φ is the top segment's angle and ψ the input pinion's spin, both piecewise linear.
export const LOOP = 10; // seconds
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
export const track = (pick: (angles: Angles) => number) => ({
  kind: 'track' as const,
  keys: KEYS.map(({ time, phi, input }) => ({ time, value: pick(angles(phi, input)), ease: 'linear' as const })),
});

export type Rotation = Record<'x' | 'y' | 'z', number | ReturnType<typeof track>>;
export type Placement = { parent?: SceneObject; position?: Vec3; rotation?: Rotation; outline?: boolean };
export const turn = (z: number): Rotation => ({ x: 0, y: 0, z });

// Full colors for the parts that carry the drive from input to output; lighter ones for the frames
// and for the parts that only cancel the joint's rotation.
export const lighter = ({ r, g, b }: Rgb, amount = 0.5): Rgb => ({ r: r + (1 - r) * amount, g: g + (1 - g) * amount, b: b + (1 - b) * amount });
export const RED = { r: 0.86, g: 0.26, b: 0.24 };
export const BLUE = { r: 0.22, g: 0.45, b: 0.86 };
export const PURPLE = { r: 0.56, g: 0.32, b: 0.8 };
export const GRAY = { r: 0.55, g: 0.57, b: 0.6 };

let nextId = 1;
const objects: SceneObject[] = [];
export function add(name: string, mesh: Mesh, fill: Rgb, options: Placement = {}): SceneObject {
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
    edges: mesh.edges ?? [],
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

// Writes everything added so far as a project next to this folder, under the given name.
export function writeProject(fileName: string) {
  const frameRate = 24;
  const document: EditorDocument = {
    ...emptyDocument(),
    objects,
    skyColor: { r: 0.93, g: 0.94, b: 0.95 },
    frameRate,
    frameStart: 0,
    frameEnd: LOOP * frameRate,
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
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', fileName);
  writeFileSync(out, serializeProject(state));
  const faces = objects.reduce((sum, o) => sum + o.faces.length, 0);
  console.log(`Wrote ${out}: ${objects.length} objects, ${faces} faces.`);
}
