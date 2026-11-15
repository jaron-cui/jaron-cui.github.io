// Racks and their pinions. A rack is the basic rack itself: straight flanks at the pressure angle,
// teeth a circular pitch apart, a fillet at each root. The pinion is a spur gear (see spur.ts) whose
// pitch circle rolls on the rack's pitch line. Units are millimeters; the rack's pitch line is y = 0
// and its teeth point up.
import { DEFAULT_GEAR, gearCircles, rad, spurProfile } from './spur';
import type { SpurGear, SpurProfile, Vec2 } from './spur';

export type RackPair = {
  module: number;
  pressureAngle: number; // degrees
  addendum: number;
  dedendum: number;
  rootFillet: number; // in modules, for the rack's roots and the pinion's
  backlash: number; // thins each part's teeth by this much on the pitch line or circle
  rackTeeth: number;
  backHeight: number; // rack material below the root line
  pinionTeeth: number;
  pinionShift: number;
  pinionBore: number;
};

export const DEFAULT_RACK: RackPair = {
  module: 2, pressureAngle: 20, addendum: 1, dedendum: 1.25, rootFillet: 0.38, backlash: 0.05, rackTeeth: 12, backHeight: 6, pinionTeeth: 16, pinionShift: 0, pinionBore: 6,
};

export type Rack = {
  outline: Vec2[]; // closed, counterclockwise
  pitch: number;
  tip: number; // y of the tips
  root: number; // y of the root line
  back: number; // y of the back
  length: number;
  fillet: number; // root fillet radius used, mm
  // Tooth thickness at the tip; 0 or less means the flanks meet first.
  tipLand: number;
  // x of each tooth's center.
  teeth: number[];
};

// The largest root fillet that fits the space's flat bottom, in modules.
export function maxRackFillet(pair: RackPair): number {
  const a = rad(pair.pressureAngle);
  const m = pair.module;
  const halfFloor = (Math.PI * m) / 4 + pair.backlash / 2 - pair.dedendum * m * Math.tan(a);
  return Math.max(0, (halfFloor * Math.cos(a)) / (1 - Math.sin(a)) / m);
}

export function rackProfile(pair: RackPair, arcSteps = 10): Rack {
  const m = pair.module;
  const a = rad(pair.pressureAngle);
  const p = Math.PI * m;
  const top = pair.addendum * m;
  const root = -pair.dedendum * m;
  const fillet = Math.min(pair.rootFillet, maxRackFillet(pair)) * m;
  // A tooth space is the basic rack's tooth upside down: half width p/4 + j/2 on the pitch line,
  // widening by tan α per unit of height.
  const halfSpace = (y: number) => p / 4 + pair.backlash / 2 + y * Math.tan(a);
  const flankY = root + fillet * (1 - Math.sin(a));
  const cx = halfSpace(flankY) - fillet * Math.cos(a);
  const cy = root + fillet;
  // The right half of a space centered at x = 0, from its floor's middle up to the tooth tip.
  const half: Vec2[] = [{ x: 0, y: root }];
  if (cx > 0) half.push({ x: cx, y: root });
  for (let i = 1; i <= arcSteps; i++) {
    const t = -Math.PI / 2 + ((Math.PI / 2 - a) * i) / arcSteps;
    half.push({ x: cx + fillet * Math.cos(t), y: cy + fillet * Math.sin(t) });
  }
  half.push({ x: halfSpace(top), y: top });

  // Spaces sit at whole multiples of the pitch, with one at x = 0 under the pinion; the rack ends at
  // space centers, half a space past its first and last teeth.
  const n = Math.max(1, Math.round(pair.rackTeeth));
  const first = -Math.floor(n / 2);
  const left = first * p;
  const right = (first + n) * p;
  const outline: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const s = left + k * p;
    if (k > 0) for (let i = half.length - 1; i >= 0; i--) outline.push({ x: s - half[i].x, y: half[i].y });
    if (k < n) for (let i = k > 0 ? 1 : 0; i < half.length; i++) outline.push({ x: s + half[i].x, y: half[i].y });
  }
  const back = root - pair.backHeight;
  outline.push({ x: right, y: back }, { x: left, y: back });
  // Counterclockwise: the teeth above were laid left to right, so reverse.
  outline.reverse();
  const teeth = Array.from({ length: n }, (_, k) => left + (k + 0.5) * p);
  return { outline, pitch: p, tip: top, root, back, length: right - left, fillet, tipLand: p - 2 * halfSpace(top), teeth };
}

export function pinionOf(pair: RackPair): SpurGear {
  return {
    ...DEFAULT_GEAR,
    teeth: pair.pinionTeeth, module: pair.module, pressureAngle: pair.pressureAngle, profileShift: pair.pinionShift,
    addendum: pair.addendum, dedendum: pair.dedendum, rootFillet: pair.rootFillet, backlash: pair.backlash, bore: pair.pinionBore,
  };
}

export type RackMesh = {
  rack: Rack;
  pinion: SpurProfile;
  // The pinion's axis above the rack's pitch line: its pitch radius, plus any profile shift.
  axisHeight: number;
  travelPerTurn: number;
};

export function rackMesh(pair: RackPair): RackMesh {
  const pinion = pinionOf(pair);
  return {
    rack: rackProfile(pair),
    pinion: spurProfile(pinion),
    axisHeight: gearCircles(pinion).pitch + pair.pinionShift * pair.module,
    travelPerTurn: Math.PI * pair.module * pair.pinionTeeth,
  };
}

export function rackSvg(rack: Rack): string {
  const f = (v: number) => Number(v.toFixed(4));
  const left = Math.min(...rack.outline.map(p => p.x));
  const w = Math.ceil(rack.length + 2);
  const h = Math.ceil(rack.tip - rack.back + 2);
  const d = rack.outline.map((p, i) => `${i ? 'L' : 'M'}${f(p.x - left + 1)} ${f(rack.tip - p.y + 1)}`).join('') + 'Z';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
    `  <path fill="none" stroke="#000" stroke-width="0.1" d="${d}"/>`,
    `</svg>`,
    '',
  ].join('\n');
}
