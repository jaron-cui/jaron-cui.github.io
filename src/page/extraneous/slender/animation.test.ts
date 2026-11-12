import { Animated, AnimatedScene, evaluateScene, sampleTrack, track } from './animation';
import { toPath } from '../../../lib/vrender/geometry';
import { Face, Fixed, fixed } from '../../../lib/vrender/model';

describe('sampleTrack', () => {
  const linear = track({ time: 1, value: 10 }, { time: 3, value: 20 });

  it('holds outside its keys', () => {
    expect(sampleTrack(linear, 0)).toBe(10);
    expect(sampleTrack(linear, 5)).toBe(20);
  });

  it('interpolates linearly by default', () => {
    expect(sampleTrack(linear, 2)).toBe(15);
  });

  it('lands exactly on an interior key', () => {
    const three = track({ time: 0, value: 0 }, { time: 1, value: 5 }, { time: 2, value: 0 });
    expect(sampleTrack(three, 1)).toBe(5);
  });

  it('holds a stepped key until the next key', () => {
    const stepped = track({ time: 0, value: 1, ease: 'hold' }, { time: 1, value: 2 });
    expect(sampleTrack(stepped, 0.99)).toBe(1);
    expect(sampleTrack(stepped, 1)).toBe(2);
  });

  it('matches known cubic easing values', () => {
    const eased = track({ time: 0, value: 0, ease: [0.42, 0, 0.58, 1] }, { time: 1, value: 1 });
    expect(sampleTrack(eased, 0.5)).toBeCloseTo(0.5, 6);
    expect(sampleTrack(eased, 0.25)).toBeLessThan(0.25);
    expect(sampleTrack(eased, 0.75)).toBeGreaterThan(0.75);
  });

  it('sorts keys given out of order', () => {
    const unsorted = track({ time: 1, value: 1 }, { time: 0, value: 0 });
    expect(sampleTrack(unsorted, 0.5)).toBe(0.5);
  });
});

describe('evaluateScene', () => {
  it('resolves tracks at every depth and leaves the document untouched', () => {
    const scene: AnimatedScene = {
      background: { r: 0, g: 0, b: 0, a: 1 },
      camera: { position: { x: 0, y: 0, z: -100 }, rotation: { x: 0, y: 0, z: 0 }, focalLength: 100 },
      nodes: [{
        kind: 'group',
        name: 'Parent',
        transform: { position: { x: track({ time: 0, value: 0 }, { time: 2, value: 8 }), y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        children: [{
          kind: 'shape',
          name: 'Child',
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          geometry: { kind: 'ellipse', radiusX: track({ time: 0, value: 1 }, { time: 2, value: 3 }), radiusY: 1 },
          style: { fill: null, stroke: null },
        }],
      }],
    };
    const snapshot = JSON.stringify(scene);

    const parent = evaluateScene(scene, 1).nodes[0];
    if (parent.kind !== 'group') {
      throw new Error('Expected a group.');
    }
    expect(parent.transform.position.x).toBe(4);
    const child = parent.children[0];
    expect(child.kind === 'shape' && child.geometry).toEqual({ kind: 'ellipse', radiusX: 2, radiusY: 1 });
    expect(child.kind === 'shape' && child.style.fill).toBeNull();
    expect(JSON.stringify(scene)).toBe(snapshot);
  });

  it('passes fixed data through by identity, and the types refuse tracks in it', () => {
    const faces: Fixed<Face[]> = fixed([[0, 1, 2]]);
    // @ts-expect-error Face indices cannot animate.
    const invalid: Animated<Fixed<Face[]>> = fixed([[track({ time: 0, value: 0 }), 1, 2]]);
    expect(invalid.kind).toBe('fixed');

    const scene: AnimatedScene = {
      background: { r: 0, g: 0, b: 0, a: 1 },
      camera: { position: { x: 0, y: 0, z: -100 }, rotation: { x: 0, y: 0, z: 0 }, focalLength: 100 },
      nodes: [{
        kind: 'mesh',
        name: 'Triangle',
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        vertices: [{ x: 0, y: 0, z: track({ time: 0, value: 0 }, { time: 2, value: 4 }) }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces,
        edges: fixed([]),
        fill: { r: 1, g: 1, b: 1 },
        border: null,
      }],
    };
    const mesh = evaluateScene(scene, 1).nodes[0];
    if (mesh.kind !== 'mesh') {
      throw new Error('Expected a mesh.');
    }
    expect(mesh.faces).toBe(faces);
    expect(mesh.vertices[0].z).toBe(2);
  });
});

describe('toPath', () => {
  it('produces four closed anchors for an ellipse, on its axes', () => {
    const { anchors, closed } = toPath({ kind: 'ellipse', radiusX: 20, radiusY: 10 });
    expect(closed).toBe(true);
    expect(anchors.map(a => a.point)).toEqual([{ x: 0, y: -10 }, { x: 20, y: 0 }, { x: 0, y: 10 }, { x: -20, y: 0 }]);
  });

  it('approximates a circle to within 0.03% of the radius', () => {
    const { anchors } = toPath({ kind: 'ellipse', radiusX: 1, radiusY: 1 });
    const [from, to] = anchors;
    const p1 = { x: from.point.x + from.out.x, y: from.point.y + from.out.y };
    const p2 = { x: to.point.x + to.in.x, y: to.point.y + to.in.y };
    for (let s = 0; s <= 1; s += 0.01) {
      const u = 1 - s;
      const x = u * u * u * from.point.x + 3 * u * u * s * p1.x + 3 * u * s * s * p2.x + s * s * s * to.point.x;
      const y = u * u * u * from.point.y + 3 * u * u * s * p1.y + 3 * u * s * s * p2.y + s * s * s * to.point.y;
      expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(0.0003);
    }
  });

  it('keeps eight anchors at any corner radius and clamps oversized radii', () => {
    expect(toPath({ kind: 'rect', width: 10, height: 10, cornerRadius: 0 }).anchors).toHaveLength(8);
    const pill = toPath({ kind: 'rect', width: 10, height: 4, cornerRadius: 99 }).anchors;
    expect(pill).toHaveLength(8);
    expect(pill[2].point).toEqual({ x: 5, y: 0 });
    expect(pill[3].point).toEqual({ x: 5, y: 0 });
  });
});

describe('bounce ease', () => {
  it('starts and ends on its keys, and overshoots the end in between', () => {
    const t = track({ time: 0, value: 0, ease: 'bounce' }, { time: 1, value: 10 });
    expect(sampleTrack(t, 0)).toBe(0);
    expect(sampleTrack(t, 1)).toBe(10);
    const samples = Array.from({ length: 99 }, (_, i) => sampleTrack(t, (i + 1) / 100));
    expect(Math.max(...samples)).toBeGreaterThan(10);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(sampleTrack(t, 0.95) - 10)).toBeLessThan(0.1);
  });
});
