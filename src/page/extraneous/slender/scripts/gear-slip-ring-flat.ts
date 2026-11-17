// Builds gear-slip-ring-flat.slender: the gear slip ring of gearSlipRing.ts drawn with flat shapes,
// for places where the solid version (gear-slip-ring.ts) is too heavy.
//
//   npx tsx src/page/extraneous/slender/scripts/gear-slip-ring-flat.ts
//
// Each pinion is one face, its outline. Each ring is a polygon of flat vertical panels, one per
// tooth, each the ring's tooth profile standing on a chord of its pitch circle; the carrier is a
// polygon of plain panels. The panels have no outline and mark every edge but the cuts between
// them, so a ring reads as one band. Each frame is three flat pieces facing away from the mechanism:
// two posts running on from the ring's sides and a bar between them. Axles are lines.
import type { Edge, Rgb, Vec3 } from '../../../../lib/vrender/model';
import {
  add, BACK, BASE_BOTTOM, BASE_RING_ROOT, BLUE, doubleProfile, emptyMesh, GRAY, INNER_TEETH, lighter, OUTER_OFFSET,
  OUTER_TEETH, PINION_TEETH, pinionTooth, PURPLE, R_INNER, R_OUTER, RED, singleProfile, TOP, TOP_RING_ROOT, track, turn,
  writeProject, Z_A_HIGH, Z_A_LOW, Z_B_HIGH, Z_B_LOW, Z_INPUT, Z_OUTPUT, Z_PINIONS,
} from './gearSlipRing';
import type { Mesh, Placement } from './gearSlipRing';

// One face through the given points, in order.
const face = (vertices: Vec3[]): Mesh => ({ ...emptyMesh(), vertices, faces: [vertices.map((_, i) => i)] });

// A line from a to b.
const line = (a: Vec3, b: Vec3): Mesh => ({ ...emptyMesh(), vertices: [a, b], edges: [[0, 1]] });

// One panel of a ring of `sides` panels at radius r, centered on angle 0: the profile (u along the
// pitch circle, z) laid on the chord between the panel's corners, which sit on the circle so
// neighboring panels meet. Every side but the cuts to the neighbors is marked.
function panel({ profile, cuts }: { profile: [number, number][]; cuts: number[] }, r: number, sides: number, height: (z: number) => number): Mesh {
  const apothem = r * Math.cos(Math.PI / sides);
  const mesh = face(profile.map(([u, z]) => ({ x: apothem, y: r * Math.sin(u / r), z: height(z) })));
  const n = profile.length;
  mesh.marked = [...Array(n).keys()].filter(i => !cuts.includes(i)).map((i): Edge => [i, (i + 1) % n]);
  return mesh;
}

// A ring of panels, one per tooth, each centered on its tooth, under an empty that carries the motion.
function ring(name: string, fill: Rgb, sides: number, section: Mesh, offset: number, options: Placement = {}) {
  const parent = add(name, emptyMesh(), fill, options);
  for (let k = 0; k < sides; k++) {
    add(`${name} panel ${k + 1}`, section, fill, { parent, rotation: turn(offset + ((k + 0.5) * 2 * Math.PI) / sides), outline: false });
  }
  return parent;
}

// A pinion's outline as one face in its local y–z plane, axle along local x, tooth 1 pointing up.
function pinionFace(): Mesh {
  const vertices: Vec3[] = [];
  for (let k = 0; k < PINION_TEETH; k++) {
    const turned = (k * 2 * Math.PI) / PINION_TEETH;
    for (const [r, angle] of pinionTooth()) vertices.push({ x: 0, y: r * Math.sin(angle + turned), z: r * Math.cos(angle + turned) });
  }
  return face(vertices);
}
const pinion = (name: string, fill: Rgb, options: Placement) => add(name, pinionFace(), fill, options);

// A frame: two posts facing outward at the ring's radius, running from the ring's edge at `ringEdge`
// to the bar at `bar`, and the bar between them facing away from the mechanism. The posts sit where
// the ring's panels meet, so each runs on from the ring. The pinion's axle goes out to the post on
// its side. Each piece is its own object, so the near post can draw in front of the mechanism and
// the far one behind it.
const BEAM = 10; // half a beam's width
function frame(name: string, fill: Rgb, ringEdge: number, bar: number, axle: Vec3, options: Placement = {}) {
  const parent = add(name, emptyMesh(), fill, options);
  for (const side of [1, -1]) {
    const x = side * R_OUTER;
    const post = face([{ x, y: -BEAM, z: ringEdge }, { x, y: BEAM, z: ringEdge }, { x, y: BEAM, z: bar }, { x, y: -BEAM, z: bar }]);
    const shaft = side === 1 ? line(axle, { x, y: 0, z: axle.z }) : null;
    const mesh = shaft ? { ...post, vertices: [...post.vertices, ...shaft.vertices], edges: [[4, 5] as Edge] } : post;
    add(`${name} post ${side === 1 ? 1 : 2}`, mesh, fill, { parent });
  }
  add(`${name} bar`, face([
    { x: -R_OUTER, y: -BEAM, z: bar }, { x: R_OUTER, y: -BEAM, z: bar }, { x: R_OUTER, y: BEAM, z: bar }, { x: -R_OUTER, y: BEAM, z: bar },
  ]), fill, { parent });
  return parent;
}

frame('Base', lighter(RED), BASE_RING_ROOT - BACK, BASE_BOTTOM, { x: R_INNER, y: 0, z: Z_INPUT });
ring('Base ring', lighter(RED), OUTER_TEETH, panel(singleProfile(), R_OUTER, OUTER_TEETH, z => BASE_RING_ROOT + z), OUTER_OFFSET);
pinion('Input pinion', RED, { position: { x: R_INNER, y: 0, z: Z_INPUT }, rotation: { x: track(g => g.input), y: 0, z: 0 } });
const middleA = (Z_A_LOW + Z_A_HIGH) / 2;
ring('Ring A', PURPLE, INNER_TEETH, panel(doubleProfile(), R_INNER, INNER_TEETH, z => middleA + z), 0, { rotation: { x: 0, y: 0, z: track(g => g.a) } });

// The carrier: a polygon of plain panels between the two pinion circles, and an axle out to each
// pinion: signal pinions at 0° and 180°, reference pinions at 90° and 270°. Each axle is its own
// object, so it sorts by its own depth.
const CARRIER_SIDES = 16;
const R_CARRIER = (R_INNER + R_OUTER) / 2;
const half = (Math.PI * R_CARRIER) / CARRIER_SIDES;
const carrierPanel = panel({ profile: [[-half, -7], [half, -7], [half, 7], [-half, 7]], cuts: [1, 3] }, R_CARRIER, CARRIER_SIDES, z => Z_PINIONS + z);
const carrier = ring('Carrier', lighter(PURPLE), CARRIER_SIDES, carrierPanel, -Math.PI / CARRIER_SIDES, { rotation: { x: 0, y: 0, z: track(g => g.c) } });
const bandInside = R_CARRIER * Math.cos(Math.PI / CARRIER_SIDES);
for (const [i, angle] of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].entries()) {
  const [from, to] = i % 2 === 0 ? [R_INNER, bandInside] : [bandInside, R_OUTER];
  add(`Carrier axle ${i + 1}`, line({ x: from, y: 0, z: Z_PINIONS }, { x: to, y: 0, z: Z_PINIONS }), lighter(PURPLE), { parent: carrier, rotation: turn(angle) });
}
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
ring('Ring B', PURPLE, INNER_TEETH, panel(doubleProfile(), R_INNER, INNER_TEETH, z => middleB + z), 0, { rotation: { x: 0, y: 0, z: track(g => g.b) } });

// The top segment turns at φ.
const top = frame('Top segment', lighter(BLUE), TOP_RING_ROOT + BACK, TOP + 14, { x: R_INNER, y: 0, z: Z_OUTPUT }, { rotation: { x: 0, y: 0, z: track(g => g.phi) } });
ring('Top ring', lighter(BLUE), OUTER_TEETH, panel(singleProfile(), R_OUTER, OUTER_TEETH, z => TOP_RING_ROOT - z), OUTER_OFFSET, { parent: top });
pinion('Output pinion', BLUE, { parent: top, position: { x: R_INNER, y: 0, z: Z_OUTPUT }, rotation: { x: track(g => g.output), y: 0, z: 0 } });

writeProject('gear-slip-ring-flat.slender');
