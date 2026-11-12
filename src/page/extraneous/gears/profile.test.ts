import { DEFAULT_GEAR, gearCircles, halfThicknessAt, involute, meshOf, pitchThickness, rad, spurProfile } from './profile';
import type { SpurGear } from './profile';

const gear = (overrides: Partial<SpurGear>): SpurGear => ({ ...DEFAULT_GEAR, ...overrides });

const halfAt = halfThicknessAt;

describe('spur profile', () => {
  it('has the standard circles', () => {
    const c = gearCircles(gear({ teeth: 30, module: 2 }));
    expect(c.pitch).toBeCloseTo(30);
    expect(c.base).toBeCloseTo(30 * Math.cos(rad(20)));
    expect(c.tip).toBeCloseTo(32);
    expect(c.root).toBeCloseTo(27.5);
  });

  it('cuts the textbook tooth thickness on the pitch circle, with shift and backlash', () => {
    for (const g of [gear({ teeth: 30 }), gear({ teeth: 30, profileShift: 0.4, backlash: 0.1 }), gear({ teeth: 12, profileShift: 0.5 })]) {
      const profile = spurProfile(g, { radial: 200, cutter: 400 });
      const r = gearCircles(g).pitch;
      expect(2 * r * halfAt(profile.flank, r)).toBeCloseTo(pitchThickness(g), 2);
    }
  });

  it('makes involute flanks', () => {
    const g = gear({ teeth: 30 });
    const profile = spurProfile(g, { radial: 200, cutter: 400 });
    const { pitch, base, tip } = gearCircles(g);
    const atPitch = halfAt(profile.flank, pitch);
    for (const r of [pitch - 0.5, (pitch + tip) / 2, tip - 0.1]) {
      const expected = atPitch + involute(rad(20)) - involute(Math.acos(base / r));
      expect(halfAt(profile.flank, r)).toBeCloseTo(expected, 4);
    }
  });

  it('undercuts small gears unless shifted, and the undercut thins the tooth', () => {
    const plain = spurProfile(gear({ teeth: 8 }), { radial: 200, cutter: 400 });
    const shifted = spurProfile(gear({ teeth: 8, profileShift: 0.6 }), { radial: 200, cutter: 400 });
    expect(plain.undercut).toBe(true);
    expect(shifted.undercut).toBe(false);
    const { pitch, base } = gearCircles(gear({ teeth: 8 }));
    // An uncut involute is thinnest at the base circle; the undercut leaves a narrower waist below it.
    const atBase = halfAt(plain.flank, pitch) + involute(rad(20));
    const waist = Math.min(...plain.flank.halfAngle.filter((_, i) => plain.flank.radii[i] < base));
    expect(waist).toBeLessThan(atBase - 0.005);
    const shiftedBase = halfAt(shifted.flank, pitch) + involute(rad(20));
    const below = shifted.flank.halfAngle.filter((_, i) => shifted.flank.radii[i] < base);
    expect(Math.min(...below)).toBeGreaterThan(shiftedBase - 1e-3);
  });

  it('notices a pointed tip', () => {
    const profile = spurProfile(gear({ teeth: 8, profileShift: 1.2 }));
    expect(profile.pointed).toBe(true);
    expect(profile.circles.tip).toBeLessThan(gearCircles(gear({ teeth: 8, profileShift: 1.2 })).tip);
  });

  it('closes the outline with every tooth', () => {
    const profile = spurProfile(gear({ teeth: 17 }));
    const radii = profile.outline.map(p => Math.hypot(p.x, p.y));
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(profile.circles.root - 1e-6);
    expect(Math.max(...radii)).toBeLessThanOrEqual(profile.circles.tip + 1e-6);
    // Signed area is positive (counterclockwise) and near the area between root and tip circles.
    let area = 0;
    profile.outline.forEach((p, i) => {
      const q = profile.outline[(i + 1) % profile.outline.length];
      area += (p.x * q.y - q.x * p.y) / 2;
    });
    expect(area).toBeGreaterThan(Math.PI * profile.circles.root ** 2);
    expect(area).toBeLessThan(Math.PI * profile.circles.tip ** 2);
  });

  it('spaces meshing gears', () => {
    const a = gear({ teeth: 20 });
    const b = gear({ teeth: 40 });
    const mesh = meshOf(a, b);
    expect(mesh.centerDistance).toBeCloseTo(60);
    expect(mesh.ratio).toBeCloseTo(-0.5);
    expect(mesh.contactRatio).toBeGreaterThan(1.5);
    expect(mesh.contactRatio).toBeLessThan(1.8);
    // Positive shift pushes the centers apart and steepens the working pressure angle.
    const shifted = meshOf(gear({ teeth: 12, profileShift: 0.5 }), gear({ teeth: 20, profileShift: 0.2 }));
    expect(shifted.centerDistance).toBeGreaterThan(32);
    expect(shifted.workingPressureAngle).toBeGreaterThan(rad(20));
  });
});
