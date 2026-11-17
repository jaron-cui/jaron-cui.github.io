// Builds gear-slip-ring.slender, the solid version of the gear slip ring; see gearSlipRing.ts for the
// mechanism and its motion, and gear-slip-ring-flat.ts for a lighter, flat version.
//
//   npx tsx src/page/extraneous/slender/scripts/gear-slip-ring.ts
//
// Every toothed part is split into one object per tooth under an empty on its axis, which carries
// the motion. The painter's algorithm then sorts each tooth on its own, so a ring's near side covers
// a pinion and its far side doesn't. The pieces have their outlines turned off, so the cuts between
// them don't show, and mark the lines that should.
import type { Edge, Face, Rgb, Vec3 } from '../../../../lib/vrender/model';
import {
  add, BACK, BASE_BOTTOM, BASE_RING_ROOT, BLUE, doubleProfile, emptyMesh, GRAY, HF, INNER_TEETH, lighter, merge, OUTER_OFFSET,
  OUTER_TEETH, PINION_TEETH, PINION_WIDTH, pinionTooth, PURPLE, R_INNER, R_OUTER, R_PINION, RED, singleProfile, TOP,
  TOP_RING_ROOT, track, turn, writeProject, Z_A_HIGH, Z_A_LOW, Z_B_HIGH, Z_B_LOW, Z_INPUT, Z_OUTPUT, Z_PINIONS,
} from './gearSlipRing';
import type { Mesh, Placement, Rotation } from './gearSlipRing';

const FACE_WIDTH = 28; // ring teeth, radially

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
function ringSection({ profile, cuts }: { profile: [number, number][]; cuts: number[] }, r: number, height: (z: number) => number): Mesh {
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

// One tooth of a pinion with its slice of the hub, axle along local x, the tooth pointing up local z.
// The outline runs from the axle out to the middle of the root land before the tooth, round the
// tooth (root arc, flank, tip arc, flank, root arc) and back to the axle from the middle of the land
// after it, swept across the face width. The two cuts to the axle are closed but unmarked, so the
// slices read as one disc. Each slice sorts by its own depth, as a ring's sections do; a whole hub
// sorting at its center draws over whatever passes in front of its edge.
function pinionSection(): Mesh {
  const root = R_PINION - HF;
  const land = Math.PI / PINION_TEETH;
  const outline: [number, number][] = [[0, 0], [root, -land], ...pinionTooth(), [root, land]];
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

// A part made of pieces: an empty on its axis with the motion, and each piece a child turned to its
// place, with no outline of its own.
function pieces(name: string, fill: Rgb, places: { name: string; mesh: Mesh; rotation: Rotation }[], options: Placement = {}) {
  const parent = add(name, emptyMesh(), fill, options);
  for (const place of places) {
    add(`${name} ${place.name}`, place.mesh, fill, { parent, rotation: place.rotation, outline: false });
  }
  return parent;
}

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

add('Base', merge(
  box(-R_OUTER - 30, R_OUTER + 30, -20, 20, BASE_BOTTOM, BASE_BOTTOM + 14),
  box(R_OUTER - 10, R_OUTER + 10, -10, 10, BASE_BOTTOM + 14, BASE_RING_ROOT - BACK),
  box(-R_OUTER - 10, -R_OUTER + 10, -10, 10, BASE_BOTTOM + 14, BASE_RING_ROOT - BACK),
  box(R_INNER + PINION_WIDTH / 2, R_OUTER - 10, -3, 3, Z_INPUT - 3, Z_INPUT + 3),
), lighter(RED));
ring('Base ring', lighter(RED), OUTER_TEETH, ringSection(singleProfile(), R_OUTER, z => BASE_RING_ROOT + z), OUTER_OFFSET);
pinion('Input pinion', RED, { position: { x: R_INNER, y: 0, z: Z_INPUT }, rotation: { x: track(g => g.input), y: 0, z: 0 } });
const middleA = (Z_A_LOW + Z_A_HIGH) / 2;
ring('Ring A', PURPLE, INNER_TEETH, ringSection(doubleProfile(), R_INNER, z => middleA + z), 0, { rotation: { x: 0, y: 0, z: track(g => g.a) } });

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

const middleB = (Z_B_LOW + Z_B_HIGH) / 2;
ring('Ring B', PURPLE, INNER_TEETH, ringSection(doubleProfile(), R_INNER, z => middleB + z), 0, { rotation: { x: 0, y: 0, z: track(g => g.b) } });

// The top segment turns at φ.
const top = add('Top segment', merge(
  box(-R_OUTER - 30, R_OUTER + 30, -20, 20, TOP, TOP + 14),
  box(R_OUTER - 10, R_OUTER + 10, -10, 10, TOP_RING_ROOT + BACK, TOP),
  box(-R_OUTER - 10, -R_OUTER + 10, -10, 10, TOP_RING_ROOT + BACK, TOP),
  box(R_INNER + PINION_WIDTH / 2, R_OUTER - 10, -3, 3, Z_OUTPUT - 3, Z_OUTPUT + 3),
), lighter(BLUE), { rotation: { x: 0, y: 0, z: track(g => g.phi) } });
ring('Top ring', lighter(BLUE), OUTER_TEETH, ringSection(singleProfile(), R_OUTER, z => TOP_RING_ROOT - z), OUTER_OFFSET, { parent: top });
pinion('Output pinion', BLUE, { parent: top, position: { x: R_INNER, y: 0, z: Z_OUTPUT }, rotation: { x: track(g => g.output), y: 0, z: 0 } });

writeProject('gear-slip-ring.slender');
