// Ring (internal) gears and the pinion inside them. An internal gear's tooth space has the shape of
// an external gear's tooth, so the ring is generated as the complement of an external gear with the
// same teeth: its "addendum" is the ring's dedendum (reaching outward), its "dedendum" the ring's
// addendum (reaching inward), and its teeth thicker by the backlash, since they are the ring's
// spaces. Units are millimeters.
import { DEFAULT_GEAR, gearCircles, spurProfile } from './profile';
import type { SpurGear, SpurProfile, Vec2 } from './profile';

export type RingPair = {
  module: number;
  pressureAngle: number; // degrees
  addendum: number; // ring teeth reach inward this far past the pitch circle, in modules
  dedendum: number;
  rootFillet: number; // the pinion's root fillet
  backlash: number;
  ringTeeth: number;
  rim: number; // ring material outside its root circle, mm
  pinionTeeth: number;
  pinionBore: number;
};

export const DEFAULT_RING: RingPair = {
  module: 2, pressureAngle: 20, addendum: 1, dedendum: 1.25, rootFillet: 0.38, backlash: 0.05, ringTeeth: 48, rim: 6, pinionTeeth: 18, pinionBore: 6,
};

export type RingGear = {
  teeth: number;
  pitch: number; // radius
  base: number;
  tip: number; // inner radius, where the ring's teeth end
  root: number; // outer radius of the tooth spaces
  outer: number; // outside radius of the rim
  // The toothed inner boundary, counterclockwise, with a space centered on +x.
  outline: Vec2[];
  pointedSpaces: boolean;
};

export function ringGear(pair: RingPair): RingGear {
  const complement: SpurGear = {
    ...DEFAULT_GEAR,
    teeth: pair.ringTeeth, module: pair.module, pressureAngle: pair.pressureAngle, profileShift: 0,
    addendum: pair.dedendum, dedendum: pair.addendum, rootFillet: 0, backlash: -pair.backlash, bore: 0,
  };
  const spaces = spurProfile(complement);
  const c = gearCircles(complement);
  return {
    teeth: pair.ringTeeth,
    pitch: c.pitch,
    base: c.base,
    tip: c.root,
    root: spaces.circles.tip,
    outer: spaces.circles.tip + pair.rim,
    outline: spaces.outline,
    pointedSpaces: spaces.pointed,
  };
}

export function pinionOf(pair: RingPair): SpurGear {
  return {
    ...DEFAULT_GEAR,
    teeth: pair.pinionTeeth, module: pair.module, pressureAngle: pair.pressureAngle, profileShift: 0,
    addendum: pair.addendum, dedendum: pair.dedendum, rootFillet: pair.rootFillet, backlash: pair.backlash, bore: pair.pinionBore,
  };
}

export type RingMesh = {
  ring: RingGear;
  pinion: SpurProfile;
  centerDistance: number; // between the ring's and the pinion's axes
  ratio: number; // pinion turns per ring turn, same direction
};

export function ringMesh(pair: RingPair): RingMesh {
  return {
    ring: ringGear(pair),
    pinion: spurProfile(pinionOf(pair)),
    centerDistance: (pair.module * (pair.ringTeeth - pair.pinionTeeth)) / 2,
    ratio: pair.ringTeeth / pair.pinionTeeth,
  };
}

// The teeth difference below which standard 20° teeth start to foul at the tips.
export const MIN_TEETH_DIFFERENCE = 12;

export function ringSvg(ring: RingGear): string {
  const f = (v: number) => Number(v.toFixed(4));
  const size = Math.ceil(ring.outer * 2 + 2);
  const half = size / 2;
  const d = ring.outline.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(-p.y)}`).join('') + 'Z';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="${-half} ${-half} ${size} ${size}">`,
    `  <circle fill="none" stroke="#000" stroke-width="0.1" r="${f(ring.outer)}"/>`,
    `  <path fill="none" stroke="#000" stroke-width="0.1" d="${d}"/>`,
    `</svg>`,
    '',
  ].join('\n');
}
