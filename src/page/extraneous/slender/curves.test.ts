import { allTriangles, triangulateLoop } from '../../../lib/vrender/triangulate';
import type { Vec3 } from '../../../lib/vrender/model';
import { curveAt, curveBetween, curvesAfterDelete, curvesAfterSubdivide, mirroredCurve, splitCurve, tessellated, transformCurve } from './curves';
import type { CurveShape } from './curves';
import { fillSelection, subdivideSelection } from './editing';
import { cubeMesh } from './primitives';

const v = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });
const close = (p: Vec3, q: Vec3, digits = 9) => {
  expect(p.x).toBeCloseTo(q.x, digits);
  expect(p.y).toBeCloseTo(q.y, digits);
  expect(p.z).toBeCloseTo(q.z, digits);
};
const arc = (r: number, large: boolean, sweep: boolean): CurveShape => ({ kind: 'arc', radii: { x: r, y: r }, axis: v(1, 0), normal: v(0, 0, 1), large, sweep });
const [A, B] = [v(-1, 0), v(1, 0)];

describe('arcs, as SVG has them', () => {
  it('meets both ends and bows the way the sweep says', () => {
    // Sweep turns counterclockwise seen from the normal, so from (−1, 0) to (1, 0) it passes below.
    close(curveAt(arc(1, false, true), A, B, 0), A);
    close(curveAt(arc(1, false, true), A, B, 1), B);
    close(curveAt(arc(1, false, true), A, B, 0.5), v(0, -1));
    close(curveAt(arc(1, false, false), A, B, 0.5), v(0, 1));
  });

  it('scales radii up that are too small to reach, as SVG does', () => {
    close(curveAt(arc(0.25, false, true), A, B, 0.5), v(0, -1));
  });

  it('takes the large arc when asked', () => {
    // Radius 2 through points 2 apart: the small arc bows 2 − √3, the large one 2 + √3.
    expect(curveAt(arc(2, false, true), A, B, 0.5).y).toBeCloseTo(-(2 - Math.sqrt(3)));
    expect(curveAt(arc(2, true, true), A, B, 0.5).y).toBeCloseTo(-(2 + Math.sqrt(3)));
  });

  it('keeps ends off its plane joined, blending their offsets', () => {
    const lifted = curveAt(arc(1, false, true), v(-1, 0, 0), v(1, 0, 4), 0.5);
    expect(lifted.z).toBeCloseTo(2);
  });
});

describe('curves', () => {
  it('puts Bézier midpoints where the formulas do', () => {
    // Quadratic: halfway between the chord's middle and the control point.
    close(curveAt({ kind: 'quadratic', control: v(0, 2) }, A, B, 0.5), v(0, 1));
    // Cubic with handles straight up by 4/3: a quarter of the way it reaches 3/4 × 4/3 = 1.
    close(curveAt({ kind: 'cubic', out: v(0, 4 / 3), in: v(0, 4 / 3) }, A, B, 0.5), v(0, 1));
  });

  it('splits each kind into halves that lie on the original', () => {
    const shapes: CurveShape[] = [
      { kind: 'quadratic', control: v(0.3, 2) },
      { kind: 'cubic', out: v(0.5, 1), in: v(-0.2, 2) },
      arc(1.5, false, true),
      arc(1.5, true, false),
    ];
    for (const shape of shapes) {
      const { middle, first, second } = splitCurve(shape, A, B);
      close(middle, curveAt(shape, A, B, 0.5));
      if (shape.kind === 'arc') {
        // Same ellipse: a quarter of the way along is the first half's middle.
        close(curveAt(first, A, middle, 0.5), curveAt(shape, A, B, 0.25), 6);
        close(curveAt(second, middle, B, 0.5), curveAt(shape, A, B, 0.75), 6);
      } else {
        close(curveAt(first, A, middle, 0.5), curveAt(shape, A, B, 0.25));
        close(curveAt(second, middle, B, 0.5), curveAt(shape, A, B, 0.75));
      }
    }
  });

  it('reflects in a mirror, arcs included', () => {
    const shape = arc(1, false, true);
    const mirrored = mirroredCurve(shape, 'y');
    const p = curveAt(shape, A, B, 0.3);
    const q = curveAt(mirrored, v(-1, 0), v(1, 0), 0.3);
    close(q, v(p.x, -p.y, p.z));
  });

  it('follows a linear map', () => {
    const shape: CurveShape = { kind: 'cubic', out: v(0, 1), in: v(0, 1) };
    const double = (p: Vec3) => v(2 * p.x, 2 * p.y, 2 * p.z);
    close(curveAt(transformCurve(shape, double), double(A), double(B), 0.5), double(curveAt(shape, A, B, 0.5)));
    const round = arc(1, false, true);
    close(curveAt(transformCurve(round, double), double(A), double(B), 0.5), double(curveAt(round, A, B, 0.5)));
  });

  it('turns around for the other direction, and follows deletion and subdivision', () => {
    const curves = [{ a: 0, b: 1, shape: { kind: 'cubic', out: v(1, 0), in: v(2, 0) } as CurveShape }];
    expect(curveBetween(curves, 1, 0)).toEqual({ kind: 'cubic', out: v(2, 0), in: v(1, 0) });
    expect(curvesAfterDelete(curves, [1, 0])[0]).toMatchObject({ a: 1, b: 0 });
    const split = curvesAfterSubdivide(curves, [[1, 0]], 2, [v(0, 0), v(3, 0)]);
    expect(split.map(c => [c.a, c.b])).toEqual([[0, 2], [2, 1]]);
  });

  it('tessellates faces and lines along their curves', () => {
    // A square whose bottom side is an arc, and a curved standalone line.
    const mesh = {
      vertices: [v(-1, 0), v(1, 0), v(1, 2), v(-1, 2), v(5, 0), v(7, 0)],
      faces: [[0, 1, 2, 3]],
      edges: [[4, 5]] as [number, number][],
      curves: [{ a: 0, b: 1, shape: arc(1, false, true) }, { a: 4, b: 5, shape: { kind: 'quadratic', control: v(0, 1) } as CurveShape }],
    };
    const out = tessellated(mesh);
    // The semicircle turns 180°: 12 pieces, 11 new points, all inside the face's loop.
    expect(out.faces[0]).toHaveLength(4 + 11);
    expect(out.faces[0].slice(0, 2)).toEqual([0, 6]);
    // The quadratic line becomes a chain of 8.
    expect(out.edges).toHaveLength(8);
    expect(out.edges[0][0]).toBe(4);
    expect(out.edges[7][1]).toBe(5);
  });
});

describe('n-sided faces', () => {
  const area = (points: Vec3[], triangles: number[][]) => triangles.reduce((sum, [a, b, c]) => {
    const [p, q, r] = [points[a], points[b], points[c]];
    return sum + Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
  }, 0);

  it('triangulates a concave face exactly', () => {
    const shape = [v(0, 0), v(2, 0), v(2, 1), v(1, 1), v(1, 2), v(0, 2)];
    const triangles = triangulateLoop(shape);
    expect(triangles).toHaveLength(4);
    expect(area(shape, triangles)).toBeCloseTo(3);
  });

  it('triangulates a face with a hole bridged in', () => {
    // A 4 × 4 square with a 2 × 2 hole, joined by a cut from (0, 0) to (1, 1) and back.
    const loop = [v(0, 0), v(4, 0), v(4, 4), v(0, 4), v(0, 0), v(1, 1), v(1, 3), v(3, 3), v(3, 1), v(1, 1)];
    expect(area(loop, triangulateLoop(loop))).toBeCloseTo(16 - 4);
  });

  it('subdivides a quad by taking the new vertices into its loop', () => {
    const mesh = { vertices: [v(0, 0), v(2, 0), v(2, 2), v(0, 2)], faces: [[0, 1, 2, 3]], edges: [] };
    const result = subdivideSelection(mesh, new Set([0, 1, 2, 3]));
    expect(result.faces).toEqual([[0, 4, 1, 5, 2, 6, 3, 7]]);
  });

  it('caches triangles per face list', () => {
    const cube = cubeMesh(10);
    expect(allTriangles(cube.faces, cube.vertices)).toBe(allTriangles(cube.faces, cube.vertices));
  });

  it('fills five selected vertices with one face', () => {
    const vertices = Array.from({ length: 5 }, (_, i) => v(Math.cos((i * 2 * Math.PI) / 5) * 100, 0, Math.sin((i * 2 * Math.PI) / 5) * 100));
    const camera = { position: v(0, -500, 0), rotation: v(0, 0, 0), focalLength: 500 };
    const { mesh } = fillSelection({ vertices, faces: [], edges: [] }, new Set([3, 0, 4, 1, 2]), camera);
    expect(mesh.faces).toHaveLength(1);
    expect(mesh.faces[0]).toHaveLength(5);
  });
});
