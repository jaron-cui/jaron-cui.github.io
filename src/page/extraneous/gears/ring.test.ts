import { halfThicknessAt, spurProfile, DEFAULT_GEAR } from './profile';
import { DEFAULT_RING, ringGear, ringMesh } from './ring';

describe('ring gear', () => {
  it('has its teeth inside the pitch circle and its spaces outside', () => {
    const ring = ringGear(DEFAULT_RING);
    expect(ring.pitch).toBeCloseTo(48);
    expect(ring.tip).toBeCloseTo(48 - 2); // reaches inward by the addendum
    expect(ring.root).toBeCloseTo(48 + 2.5); // spaces reach outward by the dedendum
    expect(ring.outer).toBeCloseTo(48 + 2.5 + DEFAULT_RING.rim);
    const radii = ring.outline.map(p => Math.hypot(p.x, p.y));
    expect(Math.min(...radii)).toBeCloseTo(ring.tip, 3);
    expect(Math.max(...radii)).toBeCloseTo(ring.root, 3);
  });

  it('makes each space the standard tooth thickness plus backlash, so the ring tooth is p/2 − j', () => {
    // The complement's tooth (the ring's space) is πm/2 + j wide on the pitch circle.
    const complement = spurProfile({ ...DEFAULT_GEAR, teeth: 48, module: 2, addendum: 1.25, dedendum: 1, rootFillet: 0, backlash: -0.05 });
    const space = 2 * 48 * halfThicknessAt(complement.flank, 48);
    expect(space).toBeCloseTo(Math.PI + 0.05, 2);
    expect(2 * Math.PI * 2 / 2 - space).toBeCloseTo(Math.PI - 0.05, 2);
  });

  it('spaces the pinion by half the difference in pitch diameters', () => {
    const mesh = ringMesh(DEFAULT_RING);
    expect(mesh.centerDistance).toBeCloseTo((2 * (48 - 18)) / 2);
    expect(mesh.ratio).toBeCloseTo(48 / 18);
    // The pinion's tips stay inside the ring's root circle on the far side.
    expect(mesh.centerDistance + mesh.pinion.circles.tip).toBeLessThan(mesh.ring.root);
  });
});
