// Straight bevel gear pairs. The cone geometry is exact; the tooth form at the large end uses
// Tredgold's approximation: the back cone, unrolled, is a spur gear of N / cos δ teeth, so the tooth is
// that virtual gear's involute tooth, wrapped back onto the cone. Teeth taper toward the apex, so the
// small end is the large end scaled by (R − b) / R. Units are millimeters.
import { gearCircles, halfThicknessAt, rad, spurProfile } from './profile';
import type { SpurGear, ToothFlank, Vec2 } from './profile';

export type BevelPair = {
  teeth: [number, number];
  module: number; // at the large end
  pressureAngle: number; // degrees
  shaftAngle: number; // degrees between the axes, 90 for a right-angle drive
  faceWidth: number; // along the pitch cone
  addendum: number;
  dedendum: number;
  rootFillet: number;
  backlash: number;
  bores: [number, number];
};

export const DEFAULT_BEVEL: BevelPair = {
  teeth: [16, 24], module: 2, pressureAngle: 20, shaftAngle: 90, faceWidth: 8, addendum: 1, dedendum: 1.25, rootFillet: 0.3, backlash: 0.05, bores: [6, 8],
};

export type BevelGear = {
  teeth: number;
  pitchAngle: number; // δ, radians, between the axis and the pitch cone
  addendumAngle: number;
  dedendumAngle: number;
  pitchDiameter: number; // at the large end
  tipDiameter: number; // outside diameter, at the large end
  rootDiameter: number; // at the large end
  virtualTeeth: number;
  // The large end's tooth, from the virtual spur gear on the back cone.
  virtual: { flank: ToothFlank; pitch: number; tip: number; root: number; pointed: boolean };
  // Axial half-section of the blank (axial distance from the apex, radius), for one side of the axis.
  section: { tooth: AxialPoint[]; blank: AxialPoint[] };
  // Looking along the axis: the large and small ends' tooth outlines, tooth 0 on +x.
  front: { outer: Vec2[]; inner: Vec2[] };
};

export type AxialPoint = { axial: number; radius: number };

export type BevelGeometry = {
  pair: BevelPair;
  coneDistance: number; // R, apex to the large end along the pitch cone
  gears: [BevelGear, BevelGear];
};

// Pitch cone angles from the tooth counts: each cone's pitch radius is in proportion to its teeth,
// and the two cones share a generator line.
export function pitchAngles(n1: number, n2: number, shaftAngle: number): [number, number] {
  const s = rad(shaftAngle);
  const d1 = Math.atan2(Math.sin(s), n2 / n1 + Math.cos(s));
  return [d1, s - d1];
}

export function bevelGeometry(pair: BevelPair): BevelGeometry {
  const m = pair.module;
  const [d1, d2] = pitchAngles(pair.teeth[0], pair.teeth[1], pair.shaftAngle);
  const coneDistance = (m * pair.teeth[0]) / 2 / Math.sin(d1);
  const make = (i: 0 | 1, delta: number) => bevelGear(pair, pair.teeth[i], delta, coneDistance, pair.bores[i]);
  return { pair, coneDistance, gears: [make(0, d1), make(1, d2)] };
}

function bevelGear(pair: BevelPair, teeth: number, delta: number, R: number, bore: number): BevelGear {
  const m = pair.module;
  const b = Math.min(pair.faceWidth, R * 0.9);
  const ha = pair.addendum * m;
  const hf = pair.dedendum * m;
  const pitchRadius = (m * teeth) / 2;
  // The virtual spur gear on the back cone. Its tooth count need not be whole: only one tooth's flank
  // is used.
  const virtualTeeth = teeth / Math.cos(delta);
  const virtualGear: SpurGear = {
    teeth: virtualTeeth, module: m, pressureAngle: pair.pressureAngle, profileShift: 0,
    addendum: pair.addendum, dedendum: pair.dedendum, rootFillet: pair.rootFillet, backlash: pair.backlash, bore: 0,
  };
  const spur = spurProfile(virtualGear, { radial: 40, cutter: 80 });
  const vc = gearCircles(virtualGear);

  // Axial section, in (axial distance from the apex, radius). The large end's back cone is square to
  // the pitch cone there; tip and root lines run to the apex, so the small end scales by (R − b) / R.
  const along = { axial: Math.cos(delta), radius: Math.sin(delta) }; // along the pitch cone
  const out = { axial: -Math.sin(delta), radius: Math.cos(delta) }; // square to it, away from the axis
  const point = (s: number, h: number): AxialPoint => ({ axial: s * along.axial + h * out.axial, radius: s * along.radius + h * out.radius });
  const backTip = point(R, ha);
  const backRoot = point(R, -hf);
  const k = (R - b) / R;
  const innerTip = { axial: backTip.axial * k, radius: backTip.radius * k };
  const innerRoot = { axial: backRoot.axial * k, radius: backRoot.radius * k };
  const tooth = [innerTip, backTip, backRoot, innerRoot];
  // The blank behind the teeth: a back face a quarter face width behind the large end, down to the
  // bore, and forward along the bore to the small end.
  const back = Math.max(backRoot.axial, backTip.axial) + 0.25 * b;
  const boreR = Math.min(bore / 2, innerRoot.radius * 0.9);
  const blank = [innerTip, backTip, backRoot, { axial: back, radius: backRoot.radius }, { axial: back, radius: boreR }, { axial: innerRoot.axial, radius: boreR }, innerRoot];

  // Front view: unroll the virtual tooth back onto the cone. A distance along the back cone from the
  // virtual center projects onto the axis plane by cos δ, and the virtual pitch angle wraps by
  // r_v / r = 1 / cos δ.
  const toAxial = (rv: number) => pitchRadius + (rv - vc.pitch) * Math.cos(delta);
  const flank = spur.flank;
  const outer = frontOutline(teeth, flank, toAxial, 1 / Math.cos(delta));
  const inner = outer.map(p => ({ x: p.x * k, y: p.y * k }));

  return {
    teeth,
    pitchAngle: delta,
    addendumAngle: Math.atan(ha / R),
    dedendumAngle: Math.atan(hf / R),
    pitchDiameter: 2 * pitchRadius,
    tipDiameter: 2 * backTip.radius,
    rootDiameter: 2 * backRoot.radius,
    virtualTeeth,
    virtual: { flank, pitch: vc.pitch, tip: spur.circles.tip, root: vc.root, pointed: spur.pointed },
    section: { tooth, blank },
    front: { outer, inner },
  };
}

// A whole gear's outline from one tooth's flank, mapping each flank radius and half angle through
// `toRadius` and scaling angles by `angleScale`. Counterclockwise, tooth 0 centered on +x.
function frontOutline(teeth: number, flank: ToothFlank, toRadius: (r: number) => number, angleScale: number): Vec2[] {
  const out: Vec2[] = [];
  const at = (r: number, angle: number) => out.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  const { radii, halfAngle } = flank;
  const last = radii.length - 1;
  const step = (2 * Math.PI) / teeth;
  const arc = 6;
  for (let k = 0; k < teeth; k++) {
    const c = k * step;
    for (let i = 0; i <= last; i++) at(toRadius(radii[i]), c - halfAngle[i] * angleScale);
    for (let j = 1; j < arc && halfAngle[last] > 0; j++) at(toRadius(radii[last]), c + halfAngle[last] * angleScale * ((2 * j) / arc - 1));
    for (let i = last; i >= 0; i--) at(toRadius(radii[i]), c + halfAngle[i] * angleScale);
    const from = c + halfAngle[0] * angleScale;
    const to = c + step - halfAngle[0] * angleScale;
    for (let j = 1; j < arc; j++) at(toRadius(radii[0]), from + ((to - from) * j) / arc);
  }
  return out;
}

// The large end's tooth thickness on the pitch circle, as an arc length.
export function largeEndThickness(gear: BevelGear): number {
  return 2 * gear.virtual.pitch * halfThicknessAt(gear.virtual.flank, gear.virtual.pitch);
}

// An SVG of one gear seen along its axis: the large end's outline, the small end's, and the bore.
export function bevelFrontSvg(gear: BevelGear, bore: number): string {
  const f = (v: number) => Number(v.toFixed(4));
  const loop = (points: Vec2[]) => points.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(-p.y)}`).join('') + 'Z';
  const size = Math.ceil(gear.tipDiameter + 2);
  const half = size / 2;
  const r = bore / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="${-half} ${-half} ${size} ${size}">`,
    `  <path fill="none" stroke="#000" stroke-width="0.1" d="${loop(gear.front.outer)}"/>`,
    `  <path fill="none" stroke="#000" stroke-width="0.05" d="${loop(gear.front.inner)}"/>`,
    r > 0 ? `  <circle fill="none" stroke="#000" stroke-width="0.1" r="${f(r)}"/>` : '',
    `</svg>`,
    '',
  ].filter(Boolean).join('\n');
}
