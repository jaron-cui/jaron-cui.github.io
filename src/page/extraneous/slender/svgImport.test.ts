import { triangulateLoop } from '../../../lib/vrender/triangulate';
import { curveAt, curveBetween } from './curves';
import { DEFAULT_STYLE, buildMeshes, collectShapes, parseColor, parsePathData, parseTransform, shapeSubpaths, styleOf, transformSubpaths } from './svgImport';
import type { Shape } from './svgImport';

const attrs = (values: Record<string, string>) => (name: string) => values[name] ?? null;
const shape = (d: string, style: Partial<Shape['style']> = {}): Shape => ({ name: 'p', subpaths: parsePathData(d), style: { ...DEFAULT_STYLE, ...style }, scale: 1 });
const build = (shapes: Shape[]) => buildMeshes(shapes, { scale: 1, center: { x: 0, y: 0 }, step: 1 });

describe('path data', () => {
  it('reads absolute, relative, H and V, and closes', () => {
    const [a] = parsePathData('M10 20 L30 40 H50 V60 Z');
    expect(a.start).toEqual({ x: 10, y: 20 });
    expect(a.segments.map(s => s.to)).toEqual([{ x: 30, y: 40 }, { x: 50, y: 40 }, { x: 50, y: 60 }]);
    expect(a.closed).toBe(true);
    const [b] = parsePathData('m5,5 l10,0 0,10 h-10z');
    expect(b.segments.map(s => s.to)).toEqual([{ x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }]);
  });

  it('reflects the last control point for S and T', () => {
    const [p] = parsePathData('M0 0 C10 0 20 10 20 20 S30 40 40 40');
    expect(p.segments[1]).toMatchObject({ kind: 'cubic', c1: { x: 20, y: 30 } });
    const [q] = parsePathData('M0 0 Q10 10 20 0 T40 0');
    expect(q.segments[1]).toMatchObject({ kind: 'quadratic', control: { x: 30, y: -10 } });
  });

  it('reads arc flags written without separators', () => {
    const [p] = parsePathData('M0 0a5 5 0 016 0');
    expect(p.segments[0]).toMatchObject({ kind: 'arc', rx: 5, ry: 5, large: false, sweep: true, to: { x: 6, y: 0 } });
    const [q] = parsePathData('M1.5.5l.5-1e1');
    expect(q.start).toEqual({ x: 1.5, y: 0.5 });
    expect(q.segments[0].to).toEqual({ x: 2, y: -9.5 });
  });
});

describe('transforms and styles', () => {
  it('composes a transform list', () => {
    const m = parseTransform('translate(10 20) scale(2)');
    expect(m).toEqual([2, 0, 0, 2, 10, 20]);
    const r = parseTransform('rotate(90)');
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(1);
  });

  it('maps an arc to the right ellipse under a stretch', () => {
    // A circle of radius 1, stretched 3× along x: its quarter arcs get radii 3 and 1.
    const [circle] = transformSubpaths(parseTransform('scale(3 1)'), shapeSubpaths('circle', attrs({ cx: '0', cy: '0', r: '1' })));
    for (const s of circle.segments) {
      expect(s.kind).toBe('arc');
      if (s.kind === 'arc') {
        expect(Math.max(s.rx, s.ry)).toBeCloseTo(3);
        expect(Math.min(s.rx, s.ry)).toBeCloseTo(1);
      }
    }
    // A reflection reverses the sweep.
    const [flipped] = transformSubpaths(parseTransform('scale(-1 1)'), shapeSubpaths('circle', attrs({ r: '1' })));
    expect(flipped.segments[0]).toMatchObject({ sweep: false });
  });

  it('reads colors and inherits styles, with style="" winning', () => {
    expect(parseColor('#f80')).toEqual({ r: 1, g: 0x88 / 255, b: 0 });
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseColor('none')).toBeNull();
    const group = styleOf(DEFAULT_STYLE, attrs({ fill: 'red', stroke: 'blue', 'stroke-width': '3' }));
    const child = styleOf(group, attrs({ fill: 'green', style: 'fill: navy; stroke-width: 5' }));
    expect(child.fill).toEqual(parseColor('navy'));
    expect(child.stroke).toEqual(parseColor('blue'));
    expect(child.strokeWidth).toBe(5);
  });

  it('walks groups, composing transforms and counting what it skips', () => {
    type Fake = { localName: string; getAttribute: (n: string) => string | null; children: Fake[] };
    const el = (localName: string, values: Record<string, string>, children: Fake[] = []): Fake => ({ localName, getAttribute: attrs(values), children });
    const root = el('svg', {}, [
      el('g', { transform: 'translate(100 0)', fill: 'red' }, [el('rect', { width: '10', height: '10' }), el('text', {})]),
      el('defs', {}, [el('rect', { width: '5', height: '5' })]),
    ]);
    const { shapes, skipped } = collectShapes(root as unknown as Element);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].subpaths[0].start).toEqual({ x: 100, y: 0 });
    expect(shapes[0].style.fill).toEqual({ r: 1, g: 0, b: 0 });
    expect(skipped.get('text')).toBe(1);
  });
});

describe('meshes', () => {
  it('makes a circle four arcs around one face', () => {
    const [mesh] = build([{ name: 'c', subpaths: shapeSubpaths('circle', attrs({ cx: '0', cy: '0', r: '10' })), style: DEFAULT_STYLE, scale: 1 }]);
    expect(mesh.vertices).toHaveLength(4);
    expect(mesh.faces).toHaveLength(1);
    expect(mesh.curves).toHaveLength(4);
    // Each quarter's middle is on the circle, in the x–z plane.
    const [a, b] = mesh.faces[0];
    const shapeAB = curveBetween(mesh.curves, a, b)!;
    const middle = curveAt(shapeAB, mesh.vertices[a], mesh.vertices[b], 0.5);
    expect(Math.hypot(middle.x + mesh.position.x, middle.z + mesh.position.z)).toBeCloseTo(10);
    expect(middle.y).toBeCloseTo(0);
  });

  it('bridges a hole into its face, by either fill rule', () => {
    // A 10 × 10 square with a 4 × 4 hole; the hole winds the other way for nonzero.
    const outer = 'M0 0 H10 V10 H0 Z';
    for (const [d, rule] of [[`${outer} M3 3 H7 V7 H3 Z`, 'evenodd'], [`${outer} M3 3 V7 H7 V3 Z`, 'nonzero']] as const) {
      const [mesh] = build([shape(d, { fillRule: rule })]);
      expect(mesh.faces).toHaveLength(1);
      const points = mesh.faces[0].map(i => mesh.vertices[i]).map(v => ({ x: v.x, y: v.z, z: 0 }));
      const area = triangulateLoop(points).reduce((sum, [i, j, k]) => {
        const [p, q, r] = [points[i], points[j], points[k]];
        return sum + Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
      }, 0);
      expect(area).toBeCloseTo(100 - 16);
    }
  });

  it('fills a nested shape winding the same way under nonzero, as SVG does', () => {
    const [mesh] = build([shape('M0 0 H10 V10 H0 Z M3 3 H7 V7 H3 Z')]);
    expect(mesh.faces).toHaveLength(2);
  });

  it('splits a second line between the same two vertices', () => {
    // A circle drawn as two half arcs: both join the same two points.
    const [mesh] = build([shape('M0 0 A5 5 0 0 1 10 0 A5 5 0 0 1 0 0 Z')]);
    expect(mesh.vertices).toHaveLength(3);
    expect(mesh.faces[0]).toHaveLength(3);
    expect(mesh.curves).toHaveLength(3);
  });

  it('makes strokes into lines and borders, at half the stroke width', () => {
    const [mesh] = build([{ ...shape('M0 0 L10 0 L10 10', { fill: null, stroke: { r: 0, g: 0, b: 1 }, strokeWidth: 4 }), scale: 2 }]);
    expect(mesh.faces).toHaveLength(0);
    expect(mesh.edges).toHaveLength(2);
    expect(mesh.border).toEqual({ color: { r: 0, g: 0, b: 1 }, width: 4 });
  });

  it('stacks later shapes nearer the camera and centers each on itself', () => {
    const meshes = build([shape('M0 0 H10 V10 H0 Z'), shape('M20 0 H30 V10 H20 Z')]);
    expect(meshes[1].position.y).toBeLessThan(meshes[0].position.y);
    expect(meshes[1].position.x).toBeCloseTo(25);
    expect(Math.min(...meshes[1].vertices.map(v => v.x))).toBeCloseTo(-5);
  });
});
