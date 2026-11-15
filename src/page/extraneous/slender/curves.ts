// Curved edges: a line between two vertices can bend, in any of SVG's ways. Straight is the default
// and needs nothing stored. A curve is kept against the vertex pair it bends, a → b, so it serves a
// face's side or a standalone line alike, and follows the mesh through edits the way vertex groups
// do. Everything that draws or picks uses tessellated(), which swaps each curve for a run of short
// straight pieces.
import type { Edge, Face, Vec3 } from '../../../lib/vrender/model';
import type { MeshData } from './primitives';

export type CurveShape =
  // One control point, relative to the middle of a → b, so it moves with both ends.
  | { kind: 'quadratic'; control: Vec3 }
  // Two handles: out relative to a, in relative to b, so each moves with its end.
  | { kind: 'cubic'; out: Vec3; in: Vec3 }
  // An elliptical arc as SVG has it: radii along `axis` and across it in the plane square to `normal`,
  // and which of the four possible arcs through a and b, by the large-arc and sweep flags. Sweep
  // turns counterclockwise seen from the normal's side. Radii too small to reach are scaled up.
  | { kind: 'arc'; radii: { x: number; y: number }; axis: Vec3; normal: Vec3; large: boolean; sweep: boolean };

export type EdgeCurve = { a: number; b: number; shape: CurveShape };

const add = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x + q.x, y: p.y + q.y, z: p.z + q.z });
const sub = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const scale = (p: Vec3, k: number): Vec3 => ({ x: p.x * k, y: p.y * k, z: p.z * k });
const dot = (p: Vec3, q: Vec3) => p.x * q.x + p.y * q.y + p.z * q.z;
const cross = (p: Vec3, q: Vec3): Vec3 => ({ x: p.y * q.z - p.z * q.y, y: p.z * q.x - p.x * q.z, z: p.x * q.y - p.y * q.x });
const unit = (p: Vec3): Vec3 => {
  const length = Math.hypot(p.x, p.y, p.z);
  return length > 1e-12 ? scale(p, 1 / length) : { x: 1, y: 0, z: 0 };
};
const lerp = (p: Vec3, q: Vec3, t: number): Vec3 => add(p, scale(sub(q, p), t));

// The arc's ellipse: its center and the angles it runs between, in its plane's (u, v) axes, found
// as in SVG's appendix (F.6.5) with the ellipse's own axes as the frame. Ends off the plane keep
// their offsets from it, blended along the arc, so the arc still meets them.
function arcFrame(shape: Extract<CurveShape, { kind: 'arc' }>, a: Vec3, b: Vec3) {
  const n = unit(shape.normal);
  const u = unit(sub(shape.axis, scale(n, dot(shape.axis, n))));
  const v = cross(n, u);
  const origin = scale(add(a, b), 0.5);
  const [x1, y1] = [dot(sub(a, origin), u), dot(sub(a, origin), v)];
  const [x2, y2] = [dot(sub(b, origin), u), dot(sub(b, origin), v)];
  let rx = Math.abs(shape.radii.x);
  let ry = Math.abs(shape.radii.y);
  const hx = (x1 - x2) / 2;
  const hy = (y1 - y2) / 2;
  if (rx < 1e-12 || ry < 1e-12 || (hx === 0 && hy === 0)) {
    return null;
  }
  const lambda = (hx * hx) / (rx * rx) + (hy * hy) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * hy * hy - ry * ry * hx * hx;
  const denominator = rx * rx * hy * hy + ry * ry * hx * hx;
  const sign = shape.large === shape.sweep ? -1 : 1;
  const k = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cx = (k * rx * hy) / ry + (x1 + x2) / 2;
  const cy = (-k * ry * hx) / rx + (y1 + y2) / 2;
  const angle = (x: number, y: number) => Math.atan2((y - cy) / ry, (x - cx) / rx);
  const start = angle(x1, y1);
  let sweep = angle(x2, y2) - start;
  if (shape.sweep && sweep < 0) sweep += 2 * Math.PI;
  if (!shape.sweep && sweep > 0) sweep -= 2 * Math.PI;
  const offA = dot(sub(a, origin), n);
  const offB = dot(sub(b, origin), n);
  const at = (t: number): Vec3 => {
    const theta = start + sweep * t;
    return add(origin, add(add(scale(u, cx + rx * Math.cos(theta)), scale(v, cy + ry * Math.sin(theta))), scale(n, offA + (offB - offA) * t)));
  };
  return { at, sweep, rx, ry };
}

// The point at t (0 at a, 1 at b).
export function curveAt(shape: CurveShape, a: Vec3, b: Vec3, t: number): Vec3 {
  if (shape.kind === 'quadratic') {
    const c = add(scale(add(a, b), 0.5), shape.control);
    return lerp(lerp(a, c, t), lerp(c, b, t), t);
  }
  if (shape.kind === 'cubic') {
    const c1 = add(a, shape.out);
    const c2 = add(b, shape.in);
    const [p, q, r] = [lerp(a, c1, t), lerp(c1, c2, t), lerp(c2, b, t)];
    return lerp(lerp(p, q, t), lerp(q, r, t), t);
  }
  const frame = arcFrame(shape, a, b);
  return frame ? frame.at(t) : lerp(a, b, t);
}

// How many straight pieces draw a curve: enough to look smooth, few enough to stay light. Arcs get
// one piece per 15° they turn.
export function curvePieces(shape: CurveShape, a: Vec3, b: Vec3): number {
  if (shape.kind === 'quadratic') return 8;
  if (shape.kind === 'cubic') return 12;
  const frame = arcFrame(shape, a, b);
  return frame ? Math.max(2, Math.ceil(Math.abs(frame.sweep) / (Math.PI / 12))) : 1;
}

// The points strictly between a and b, in order from a.
export function curveInterior(shape: CurveShape, a: Vec3, b: Vec3): Vec3[] {
  const pieces = curvePieces(shape, a, b);
  return Array.from({ length: pieces - 1 }, (_, i) => curveAt(shape, a, b, (i + 1) / pieces));
}

// The same curve run from b to a.
export function reversed(shape: CurveShape): CurveShape {
  if (shape.kind === 'quadratic') return shape;
  if (shape.kind === 'cubic') return { kind: 'cubic', out: shape.in, in: shape.out };
  return { ...shape, sweep: !shape.sweep };
}

// The curve's two halves, a → middle and middle → b, and the middle point.
export function splitCurve(shape: CurveShape, a: Vec3, b: Vec3): { middle: Vec3; first: CurveShape; second: CurveShape } {
  const middle = curveAt(shape, a, b, 0.5);
  if (shape.kind === 'quadratic') {
    const c = add(scale(add(a, b), 0.5), shape.control);
    const [c1, c2] = [lerp(a, c, 0.5), lerp(c, b, 0.5)];
    return {
      middle,
      first: { kind: 'quadratic', control: sub(c1, scale(add(a, middle), 0.5)) },
      second: { kind: 'quadratic', control: sub(c2, scale(add(middle, b), 0.5)) },
    };
  }
  if (shape.kind === 'cubic') {
    const c1 = add(a, shape.out);
    const c2 = add(b, shape.in);
    const [p, q, r] = [lerp(a, c1, 0.5), lerp(c1, c2, 0.5), lerp(c2, b, 0.5)];
    const [s, w] = [lerp(p, q, 0.5), lerp(q, r, 0.5)];
    return {
      middle,
      first: { kind: 'cubic', out: sub(p, a), in: sub(s, middle) },
      second: { kind: 'cubic', out: sub(w, middle), in: sub(r, b) },
    };
  }
  // Each half is the same ellipse, at the radii the whole arc actually used, and turns at most half
  // a turn, so neither is the large arc.
  const frame = arcFrame(shape, a, b);
  const radii = frame ? { x: frame.rx, y: frame.ry } : shape.radii;
  const half = { ...shape, radii, large: false };
  return { middle, first: half, second: half };
}

// Reflected across the plane where `axis` is zero.
export function mirroredCurve(shape: CurveShape, axis: 'x' | 'y' | 'z'): CurveShape {
  const flip = (p: Vec3): Vec3 => ({ ...p, [axis]: -p[axis] });
  if (shape.kind === 'quadratic') return { kind: 'quadratic', control: flip(shape.control) };
  if (shape.kind === 'cubic') return { kind: 'cubic', out: flip(shape.out), in: flip(shape.in) };
  // A reflection turns the plane's handedness over, so the sweep runs the other way.
  return { ...shape, axis: flip(shape.axis), normal: flip(shape.normal), sweep: !shape.sweep };
}

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

// The curve on a → b, turned to run that way, if there is one.
export function curveBetween(curves: EdgeCurve[] | undefined, a: number, b: number): CurveShape | null {
  for (const curve of curves ?? []) {
    if (curve.a === a && curve.b === b) return curve.shape;
    if (curve.a === b && curve.b === a) return reversed(curve.shape);
  }
  return null;
}

export function setCurve(curves: EdgeCurve[], a: number, b: number, shape: CurveShape | null): EdgeCurve[] {
  const kept = curves.filter(curve => key(curve.a, curve.b) !== key(a, b));
  return shape ? [...kept, { a, b, shape }] : kept;
}

// Drops curves whose line is no longer part of the mesh.
export function curvesOnMesh(curves: EdgeCurve[], faces: Face[], edges: Edge[]): EdgeCurve[] {
  const lines = new Set<string>();
  faces.forEach(face => face.forEach((a, i) => lines.add(key(a, face[(i + 1) % face.length]))));
  edges.forEach(([a, b]) => lines.add(key(a, b)));
  return curves.filter(curve => lines.has(key(curve.a, curve.b)));
}

// After vertices are deleted: kept lists the survivors' old indices, in their new order.
export function curvesAfterDelete(curves: EdgeCurve[], kept: number[]): EdgeCurve[] {
  const index = new Map(kept.map((old, i) => [old, i]));
  return curves.filter(c => index.has(c.a) && index.has(c.b)).map(c => ({ ...c, a: index.get(c.a)!, b: index.get(c.b)! }));
}

// After vertices are copied to the end: curves between copied vertices are copied too.
export function curvesAfterCopy(curves: EdgeCurve[], copiedFrom: number[], count: number): EdgeCurve[] {
  const copyOf = new Map(copiedFrom.map((source, i) => [source, count + i]));
  const copies = curves.filter(c => copyOf.has(c.a) && copyOf.has(c.b)).map(c => ({ ...c, a: copyOf.get(c.a)!, b: copyOf.get(c.b)! }));
  return [...curves, ...copies];
}

export function curvesAfterOffset(curves: EdgeCurve[], offset: number): EdgeCurve[] {
  return curves.map(c => ({ ...c, a: c.a + offset, b: c.b + offset }));
}

// After a mirror across `axis`: each vertex's reflection is a copy appended at the end, or the vertex
// itself where it was welded onto the plane. A curve is reflected when either end moved.
export function curvesAfterMirror(curves: EdgeCurve[], copiedFrom: number[], count: number, axis: 'x' | 'y' | 'z'): EdgeCurve[] {
  const copyOf = new Map(copiedFrom.map((source, i) => [source, count + i]));
  const reflect = (v: number) => copyOf.get(v) ?? v;
  const reflected = curves
    .filter(c => copyOf.has(c.a) || copyOf.has(c.b))
    .map(c => ({ a: reflect(c.a), b: reflect(c.b), shape: mirroredCurve(c.shape, axis) }));
  return [...curves, ...reflected];
}

// After lines are split at new vertices appended in order (splits[i] gets vertex count + i): a curved
// line becomes two curves meeting at the curve's own middle. The vertices given are where everything
// is now, to split the curves against.
export function curvesAfterSubdivide(curves: EdgeCurve[], splits: Edge[], count: number, vertices: Vec3[]): EdgeCurve[] {
  const middle = new Map(splits.map(([a, b], i) => [key(a, b), count + i]));
  return curves.flatMap(curve => {
    const m = middle.get(key(curve.a, curve.b));
    if (m === undefined) return [curve];
    const { first, second } = splitCurve(curve.shape, vertices[curve.a], vertices[curve.b]);
    return [{ a: curve.a, b: m, shape: first }, { a: m, b: curve.b, shape: second }];
  });
}

// Where a split curve's new vertex goes: on the curve, rather than at the chord's middle.
export function splitPoint(curves: EdgeCurve[] | undefined, a: number, b: number, vertices: Vec3[]): Vec3 | null {
  const shape = curveBetween(curves, a, b);
  return shape ? curveAt(shape, vertices[a], vertices[b], 0.5) : null;
}

// How a mesh's curves are drawn: which new vertices each curve gets and where faces and lines take
// them in. It depends only on the mesh's structure, so it's worked out once per structure and reused
// as vertices move; that keeps face lists the same, so their triangles stay cached too. A curve's
// piece count is set from the vertices first seen.
type Plan = {
  source: { faces: Face[]; edges: Edge[]; marked: Edge[] | undefined; count: number };
  runs: { a: number; b: number; shape: CurveShape; pieces: number }[];
  faces: Face[];
  edges: Edge[];
  marked: Edge[] | undefined;
};

const plans = new WeakMap<EdgeCurve[], Plan>();

function planFor(mesh: MeshData & { curves: EdgeCurve[] }): Plan {
  const known = plans.get(mesh.curves);
  const { faces, edges, marked } = mesh;
  if (known && known.source.faces === faces && known.source.edges === edges && known.source.marked === marked && known.source.count === mesh.vertices.length) {
    return known;
  }
  const runs: Plan['runs'] = [];
  const interior = new Map<string, { a: number; indices: number[] }>();
  let next = mesh.vertices.length;
  for (const { a, b, shape } of mesh.curves) {
    if (!mesh.vertices[a] || !mesh.vertices[b] || interior.has(key(a, b))) continue;
    const pieces = curvePieces(shape, mesh.vertices[a], mesh.vertices[b]);
    runs.push({ a, b, shape, pieces });
    interior.set(key(a, b), { a, indices: Array.from({ length: pieces - 1 }, (_, i) => next + i) });
    next += pieces - 1;
  }
  const between = (p: number, q: number): number[] => {
    const run = interior.get(key(p, q));
    if (!run) return [];
    return run.a === p ? run.indices : [...run.indices].reverse();
  };
  const chain = (p: number, q: number): Edge[] => {
    const path = [p, ...between(p, q), q];
    return path.slice(1).map((v, i): Edge => [path[i], v]);
  };
  const plan: Plan = {
    source: { faces, edges, marked, count: mesh.vertices.length },
    runs,
    faces: faces.map(face => face.flatMap((p, i) => [p, ...between(p, face[(i + 1) % face.length])])),
    edges: edges.flatMap(([p, q]) => chain(p, q)),
    marked: marked?.flatMap(([p, q]) => chain(p, q)),
  };
  plans.set(mesh.curves, plan);
  return plan;
}

// The mesh with each curve drawn as a run of straight pieces: new vertices are appended, faces take
// them into their loops, curved lines become chains, and marked curves are marked along their length.
// Returns the mesh unchanged when it has no curves.
export function tessellated(mesh: MeshData & { curves?: EdgeCurve[] }): MeshData {
  const curves = mesh.curves ?? [];
  if (curves.length === 0) {
    return mesh;
  }
  const plan = planFor({ ...mesh, curves });
  const vertices = [...mesh.vertices];
  for (const { a, b, shape, pieces } of plan.runs) {
    for (let i = 1; i < pieces; i++) {
      vertices.push(curveAt(shape, mesh.vertices[a], mesh.vertices[b], i / pieces));
    }
  }
  return { vertices, faces: plan.faces, edges: plan.edges, ...(plan.marked ? { marked: plan.marked } : {}) };
}

// The curve after a linear map, such as an object's world matrix without its translation, so it can
// be drawn and picked against vertices mapped the same way. An arc's frame is mapped with it and its
// radii stretched along, so its normal comes from the mapped frame and the sweep keeps its meaning.
export function transformCurve(shape: CurveShape, map: (v: Vec3) => Vec3): CurveShape {
  if (shape.kind === 'quadratic') return { kind: 'quadratic', control: map(shape.control) };
  if (shape.kind === 'cubic') return { kind: 'cubic', out: map(shape.out), in: map(shape.in) };
  const n = unit(shape.normal);
  const u = unit(sub(shape.axis, scale(n, dot(shape.axis, n))));
  const v = cross(n, u);
  const [mu, mv] = [map(u), map(v)];
  const [su, sv] = [Math.hypot(mu.x, mu.y, mu.z), Math.hypot(mv.x, mv.y, mv.z)];
  return { ...shape, axis: mu, normal: cross(mu, mv), radii: { x: shape.radii.x * su, y: shape.radii.y * sv } };
}

export function transformCurves(curves: EdgeCurve[] | undefined, map: (v: Vec3) => Vec3): EdgeCurve[] {
  return (curves ?? []).map(curve => ({ ...curve, shape: transformCurve(curve.shape, map) }));
}

// The points a line is drawn through, from a to b: just its ends when straight.
export function linePoints(curves: EdgeCurve[] | undefined, vertices: Vec3[], a: number, b: number): Vec3[] {
  const shape = curveBetween(curves, a, b);
  return shape ? [vertices[a], ...curveInterior(shape, vertices[a], vertices[b]), vertices[b]] : [vertices[a], vertices[b]];
}
