// Spur gear profiles, generated the way a gear is cut: a straight-sided rack cutter with rounded tips
// rolls along the gear's pitch circle. The tooth is whatever the cutter leaves behind, so the flank is a
// true involute, the root fillet is the trochoid the cutter tip traces, and undercut on small gears
// happens on its own, as it does when a gear is cut. Units are millimeters; angles are radians
// unless a field says degrees.

export type Vec2 = { x: number; y: number };

export type SpurGear = {
  teeth: number;
  // Tooth size: pitch diameter = module × teeth. Gears mesh only with equal module and pressure angle.
  module: number;
  pressureAngle: number; // degrees
  // Moves the cutter outward by this many modules. Thickens the tooth at its base and avoids undercut.
  profileShift: number;
  // Tooth height above the pitch circle, and depth below it, in modules.
  addendum: number;
  dedendum: number;
  // Cutter tip radius, in modules. It rounds the bottom of each tooth space. Clamped to what fits.
  rootFillet: number;
  // Thins each tooth on the pitch circle by this much, so a meshing pair has play.
  backlash: number;
  bore: number; // diameter; 0 for none
};

export const DEFAULT_GEAR: SpurGear = {
  teeth: 20, module: 2, pressureAngle: 20, profileShift: 0, addendum: 1, dedendum: 1.25, rootFillet: 0.38, backlash: 0.05, bore: 8,
};

export const rad = (degrees: number) => (degrees * Math.PI) / 180;
// The involute function: how far an involute's angle runs ahead of its pressure angle.
export const involute = (angle: number) => Math.tan(angle) - angle;

export type GearCircles = { pitch: number; base: number; tip: number; root: number };

export function gearCircles(gear: SpurGear): GearCircles {
  const pitch = (gear.module * gear.teeth) / 2;
  return {
    pitch,
    base: pitch * Math.cos(rad(gear.pressureAngle)),
    tip: pitch + (gear.addendum + gear.profileShift) * gear.module,
    root: pitch - (gear.dedendum - gear.profileShift) * gear.module,
  };
}

// The largest cutter tip radius that leaves the two tip fillets meeting at a point, in modules.
export function maxRootFillet(gear: SpurGear): number {
  const a = rad(gear.pressureAngle);
  const m = gear.module;
  const halfTip = (Math.PI * m) / 4 + gear.backlash / 2 - gear.dedendum * m * Math.tan(a);
  return Math.max(0, (halfTip * Math.cos(a)) / (1 - Math.sin(a)) / m);
}

// One sample of the cutter's right side: a point in the cutter's frame (x across, h up from its
// reference line) and the outward normal there, which points into the gear's material.
type CutterPoint = { x: number; h: number; nx: number; ny: number };

function cutterSide(gear: SpurGear, fillet: number, samples: number): CutterPoint[] {
  const a = rad(gear.pressureAngle);
  const m = gear.module;
  const tipH = -gear.dedendum * m;
  const halfWidth = (h: number) => (Math.PI * m) / 4 + gear.backlash / 2 + h * Math.tan(a);
  // Where the tip fillet meets the flank, and the fillet's center.
  const flankH = tipH + fillet * (1 - Math.sin(a));
  const cx = halfWidth(flankH) - fillet * Math.cos(a);
  const ch = tipH + fillet;
  const points: CutterPoint[] = [];
  const flat = Math.max(2, Math.round(samples / 8));
  for (let i = 0; i <= flat; i++) {
    points.push({ x: (cx * i) / flat, h: tipH, nx: 0, ny: -1 });
  }
  const arc = Math.max(4, Math.round(samples / 2));
  for (let i = 1; i <= arc; i++) {
    const t = -Math.PI / 2 + ((Math.PI / 2 - a) * i) / arc;
    points.push({ x: cx + fillet * Math.cos(t), h: ch + fillet * Math.sin(t), nx: Math.cos(t), ny: Math.sin(t) });
  }
  // The flank runs far enough up to cut past the tip circle; the excess is clipped later.
  const top = (gear.addendum + gear.dedendum + 1.5) * m;
  for (let i = 1; i <= samples; i++) {
    const h = flankH + ((top - flankH) * i) / samples;
    points.push({ x: halfWidth(h), h, nx: Math.cos(a), ny: -Math.sin(a) });
  }
  return points;
}

// Where a cutter point touches the gear, in the gear's frame. The cutter's reference line sits
// `shift` outside the pitch circle at y = pitch. A point cuts when its normal passes through the
// pitch point, the instant center of the rolling; the rack has then slid by s and the gear turned
// clockwise by s / pitch.
function generated(p: CutterPoint, pitch: number, shift: number): Vec2 {
  const y = pitch + shift + p.h;
  const s = ((y - pitch) * p.nx) / p.ny - p.x;
  const phi = s / pitch;
  const wx = p.x + s;
  return { x: Math.cos(phi) * wx - Math.sin(phi) * y, y: Math.sin(phi) * wx + Math.cos(phi) * y };
}

export type ToothFlank = {
  // Radii from root to tip, and the tooth's half thickness there, as an angle from its center line.
  radii: number[];
  halfAngle: number[];
};

export type SpurProfile = {
  gear: SpurGear;
  circles: GearCircles;
  fillet: number; // cutter tip radius actually used, in mm
  flank: ToothFlank;
  // The closed outline, counterclockwise, with tooth 0 centered on +x.
  outline: Vec2[];
  // The tip came to a point below the tip circle; the tip circle shown is where it did.
  pointed: boolean;
  undercut: boolean;
};

// Samples the tooth on `radial` radii, closer together near the root where the fillet curves.
export function spurProfile(gear: SpurGear, { radial = 48, cutter = 96, arc = 6 } = {}): SpurProfile {
  const circles = gearCircles(gear);
  const m = gear.module;
  const fillet = Math.min(gear.rootFillet, maxRootFillet(gear)) * m;
  const shift = gear.profileShift * m;
  const curve = cutterSide(gear, fillet, cutter).map(p => generated(p, circles.pitch, shift));
  // The space's half angle at a radius: the farthest the cutter reached, over every position.
  const spaceAt = (r: number) => {
    let best = -Infinity;
    for (let i = 1; i < curve.length; i++) {
      const p = curve[i - 1];
      const q = curve[i];
      const rp = Math.hypot(p.x, p.y);
      const rq = Math.hypot(q.x, q.y);
      if ((rp - r) * (rq - r) > 0 || rp === rq) {
        continue;
      }
      const t = (r - rp) / (rq - rp);
      const x = p.x + (q.x - p.x) * t;
      const y = p.y + (q.y - p.y) * t;
      best = Math.max(best, Math.atan2(x, y));
    }
    return best;
  };
  const half = Math.PI / gear.teeth;
  const radii: number[] = [];
  const halfAngle: number[] = [];
  let pointed = false;
  const span = circles.tip - circles.root;
  for (let i = 0; i <= radial; i++) {
    const u = i / radial;
    // Dense at the root, where the fillet bends fastest.
    const r = circles.root + span * (1 - Math.cos((u * Math.PI) / 2)) + (i === 0 ? span * 1e-9 : 0);
    const space = spaceAt(r);
    const t = half - (Number.isFinite(space) ? space : halfAngle.length ? half - halfAngle[halfAngle.length - 1] : 0);
    if (t <= 0) {
      // The flanks met: end the tooth at the point where they cross.
      const prevR = radii[radii.length - 1];
      const prevT = halfAngle[halfAngle.length - 1];
      radii.push(prevR + ((r - prevR) * prevT) / (prevT - t));
      halfAngle.push(0);
      pointed = true;
      break;
    }
    radii.push(r);
    halfAngle.push(t);
  }
  const shown = { ...circles, tip: radii[radii.length - 1] };
  // Undercut, by the textbook test: the cutter's tip line reaches below the interference point.
  const a = rad(gear.pressureAngle);
  const undercut = gear.profileShift < gear.addendum - (gear.teeth * Math.sin(a) ** 2) / 2 - 1e-9;
  return { gear, circles: shown, fillet, flank: { radii, halfAngle }, outline: outlineOf(gear.teeth, { radii, halfAngle }, arc), pointed, undercut };
}

function outlineOf(teeth: number, { radii, halfAngle }: ToothFlank, arc: number): Vec2[] {
  const out: Vec2[] = [];
  const at = (r: number, angle: number) => out.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  const last = radii.length - 1;
  const pitchAngle = (2 * Math.PI) / teeth;
  for (let k = 0; k < teeth; k++) {
    const c = k * pitchAngle;
    // Right flank (clockwise side) up from the root, the tip land, then the left flank down.
    for (let i = 0; i <= last; i++) {
      at(radii[i], c - halfAngle[i]);
    }
    for (let j = 1; j < arc && halfAngle[last] > 0; j++) {
      at(radii[last], c - halfAngle[last] + (2 * halfAngle[last] * j) / arc);
    }
    for (let i = last; i >= 0; i--) {
      at(radii[i], c + halfAngle[i]);
    }
    // The root land, across to the next tooth.
    const from = c + halfAngle[0];
    const to = c + pitchAngle - halfAngle[0];
    for (let j = 1; j < arc; j++) {
      at(radii[0], from + ((to - from) * j) / arc);
    }
  }
  return out;
}

// The tooth's half thickness (an angle) at a radius, interpolated from the sampled flank. Clamps
// outside the root-to-tip range.
export function halfThicknessAt({ radii, halfAngle }: ToothFlank, r: number): number {
  if (r <= radii[0]) {
    return halfAngle[0];
  }
  const i = radii.findIndex(v => v >= r);
  if (i < 0) {
    return halfAngle[halfAngle.length - 1];
  }
  const t = (r - radii[i - 1]) / (radii[i] - radii[i - 1]);
  return halfAngle[i - 1] + (halfAngle[i] - halfAngle[i - 1]) * t;
}

// Tooth thickness along the pitch circle, as an arc length.
export function pitchThickness(gear: SpurGear): number {
  const a = rad(gear.pressureAngle);
  return gear.module * (Math.PI / 2 + 2 * gear.profileShift * Math.tan(a)) - gear.backlash;
}

export type Mesh = {
  centerDistance: number;
  workingPressureAngle: number;
  ratio: number; // turns of the second gear per turn of the first, with sign
  contactRatio: number;
};

// How two gears sit together. With profile shift the centers move apart, and the angle the teeth
// push along changes with them; this is the backlash-free spacing.
export function meshOf(a: SpurGear, b: SpurGear): Mesh {
  const alpha = rad(a.pressureAngle);
  const target = involute(alpha) + (2 * Math.tan(alpha) * (a.profileShift + b.profileShift)) / (a.teeth + b.teeth);
  let w = alpha;
  for (let i = 0; i < 40; i++) {
    w -= (involute(w) - target) / Math.tan(w) ** 2;
    w = Math.min(Math.max(w, 1e-4), Math.PI / 2 - 1e-4);
  }
  const ca = gearCircles(a);
  const cb = gearCircles(b);
  const centerDistance = ((ca.pitch + cb.pitch) * Math.cos(alpha)) / Math.cos(w);
  const reach = (c: GearCircles) => Math.sqrt(Math.max(0, c.tip ** 2 - c.base ** 2));
  const contactRatio = (reach(ca) + reach(cb) - centerDistance * Math.sin(w)) / (Math.PI * a.module * Math.cos(alpha));
  return { centerDistance, workingPressureAngle: w, ratio: -a.teeth / b.teeth, contactRatio };
}

// The outline as SVG path data, with the bore as a second loop for even-odd filling.
export function pathData(profile: SpurProfile, digits = 4): string {
  const f = (v: number) => Number(v.toFixed(digits));
  const loop = profile.outline.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';
  const r = profile.gear.bore / 2;
  if (!(r > 0) || r >= profile.circles.root) {
    return loop;
  }
  return `${loop}M${f(r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(r)} 0Z`;
}

// A standalone SVG file, sized in millimeters so a laser cutter or CAD import keeps the scale.
// SVG's y axis points down, so the outline is flipped to keep it counterclockwise on paper.
export function svgFile(profile: SpurProfile): string {
  const size = Math.ceil(profile.circles.tip * 2 + 2);
  const half = size / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="${-half} ${-half} ${size} ${size}">`,
    `  <path transform="scale(1,-1)" fill="none" stroke="#000" stroke-width="0.1" d="${pathData(profile)}"/>`,
    `</svg>`,
    '',
  ].join('\n');
}
