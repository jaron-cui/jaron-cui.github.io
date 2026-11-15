import { DEFAULT_RACK, maxRackFillet, rackMesh, rackProfile } from './rack';

// x where the outline crosses height y going up a flank, within one tooth's left half.
function crossings(outline: { x: number; y: number }[], y: number): number[] {
  const xs: number[] = [];
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    if ((p.y - y) * (q.y - y) < 0) xs.push(p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y));
  });
  return xs.sort((a, b) => a - b);
}

describe('rack', () => {
  it('spaces teeth a circular pitch apart, with standard thickness on the pitch line', () => {
    const rack = rackProfile(DEFAULT_RACK);
    const p = Math.PI * 2;
    expect(rack.pitch).toBeCloseTo(p);
    expect(rack.teeth[1] - rack.teeth[0]).toBeCloseTo(p);
    // The rack starts and ends mid-space, so the pitch line's crossings pair up into teeth, each
    // p/2 − j thick, with spaces p/2 + j between them.
    const xs = crossings(rack.outline, 0);
    expect(xs.length).toBe(2 * DEFAULT_RACK.rackTeeth);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      expect(xs[i + 1] - xs[i]).toBeCloseTo(p / 2 - DEFAULT_RACK.backlash, 6);
    }
    expect(xs[2] - xs[1]).toBeCloseTo(p / 2 + DEFAULT_RACK.backlash, 6);
  });

  it('puts a space at x = 0 under the pinion, and the right heights', () => {
    const rack = rackProfile(DEFAULT_RACK);
    expect(rack.teeth.some(x => Math.abs(x) < 1e-9)).toBe(false);
    expect(rack.teeth.some(x => Math.abs(x - Math.PI) < 1e-9)).toBe(true);
    expect(rack.tip).toBeCloseTo(2);
    expect(rack.root).toBeCloseTo(-2.5);
    expect(Math.min(...rack.outline.map(p => p.y))).toBeCloseTo(-2.5 - DEFAULT_RACK.backHeight);
  });

  it('makes flanks at the pressure angle', () => {
    const rack = rackProfile(DEFAULT_RACK);
    const a = crossings(rack.outline, 1);
    const b = crossings(rack.outline, -1);
    // The same flank, 2 mm apart in height, moves tan α × 2 sideways.
    expect(Math.abs(a[1] - b[1])).toBeCloseTo(2 * Math.tan((20 * Math.PI) / 180), 6);
  });

  it('runs counterclockwise and clamps the fillet', () => {
    const rack = rackProfile({ ...DEFAULT_RACK, rootFillet: 2 });
    expect(rack.fillet).toBeCloseTo(maxRackFillet(DEFAULT_RACK) * 2);
    let area = 0;
    rack.outline.forEach((p, i) => {
      const q = rack.outline[(i + 1) % rack.outline.length];
      area += (p.x * q.y - q.x * p.y) / 2;
    });
    expect(area).toBeGreaterThan(0);
  });

  it('puts the pinion axis a pitch radius above the pitch line, plus shift', () => {
    expect(rackMesh(DEFAULT_RACK).axisHeight).toBeCloseTo(16);
    expect(rackMesh({ ...DEFAULT_RACK, pinionShift: 0.5 }).axisHeight).toBeCloseTo(17);
    expect(rackMesh(DEFAULT_RACK).travelPerTurn).toBeCloseTo(Math.PI * 2 * 16);
  });
});
