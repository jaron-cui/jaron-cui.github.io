import { DEFAULT_BEVEL, bevelGeometry, largeEndThickness, pitchAngles } from './bevel';
import { rad } from './profile';

describe('bevel gears', () => {
  it('splits a right angle by the tooth ratio', () => {
    const [d1, d2] = pitchAngles(16, 24, 90);
    expect(d1 + d2).toBeCloseTo(Math.PI / 2);
    expect(Math.tan(d1)).toBeCloseTo(16 / 24);
    // Equal gears at 90° are miters: 45° each.
    expect(pitchAngles(20, 20, 90)[0]).toBeCloseTo(Math.PI / 4);
  });

  it('handles shaft angles other than 90°', () => {
    const [d1, d2] = pitchAngles(15, 30, 60);
    expect(d1 + d2).toBeCloseTo(rad(60));
    // Pitch radii, R sin δ, stay in proportion to the teeth.
    expect(Math.sin(d2) / Math.sin(d1)).toBeCloseTo(2);
  });

  it('shares one cone distance and matches the textbook diameters', () => {
    const g = bevelGeometry(DEFAULT_BEVEL);
    const [a, b] = g.gears;
    expect(g.coneDistance).toBeCloseTo(a.pitchDiameter / 2 / Math.sin(a.pitchAngle));
    expect(g.coneDistance).toBeCloseTo(b.pitchDiameter / 2 / Math.sin(b.pitchAngle));
    // Outside diameter: d + 2 hₐ cos δ.
    for (const gear of g.gears) {
      expect(gear.tipDiameter).toBeCloseTo(gear.pitchDiameter + 2 * 2 * Math.cos(gear.pitchAngle));
      expect(gear.virtualTeeth).toBeCloseTo(gear.teeth / Math.cos(gear.pitchAngle));
    }
  });

  it('wraps the virtual tooth onto the cone at the right size', () => {
    const g = bevelGeometry(DEFAULT_BEVEL);
    for (const gear of g.gears) {
      const radii = gear.front.outer.map(p => Math.hypot(p.x, p.y));
      expect(Math.max(...radii)).toBeCloseTo(gear.tipDiameter / 2, 1);
      // The large end's tooth is the standard thickness: πm/2 less backlash.
      expect(largeEndThickness(gear)).toBeCloseTo((Math.PI * 2) / 2 - 0.05, 2);
      // The small end is the large end scaled toward the apex.
      const k = (g.coneDistance - DEFAULT_BEVEL.faceWidth) / g.coneDistance;
      expect(Math.hypot(gear.front.inner[5].x, gear.front.inner[5].y)).toBeCloseTo(radii[5] * k);
    }
  });

  it('builds a closed axial section with the teeth outside the bore', () => {
    const [gear] = bevelGeometry(DEFAULT_BEVEL).gears;
    const [innerTip, backTip, backRoot, innerRoot] = gear.section.tooth;
    expect(backTip.radius).toBeGreaterThan(backRoot.radius);
    expect(innerTip.radius).toBeLessThan(backTip.radius);
    // Tip and root lines both point at the apex.
    expect(innerTip.radius / innerTip.axial).toBeCloseTo(backTip.radius / backTip.axial);
    expect(innerRoot.radius / innerRoot.axial).toBeCloseTo(backRoot.radius / backRoot.axial);
    expect(Math.min(...gear.section.blank.map(p => p.radius))).toBeCloseTo(DEFAULT_BEVEL.bores[0] / 2);
  });
});
