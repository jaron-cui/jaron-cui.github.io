import { toPath } from './geometry';
import { applyMatrix, averageScale, Matrix, multiply, transformMatrix, viewMatrix } from './matrix';
import { Camera, Color, EllipsoidNode, Face, MeshNode, PathGeometry, Rgb, Scene, SceneNode, ShapeNode, Stack, Vec2, Vec3 } from './model';
import { allTriangles, edgeTopology } from './triangulate';

// Nothing closer to the camera than this is drawn. Projection divides by depth, so geometry must
// be cut off before depth reaches zero.
const NEAR_DEPTH = 1;
const MAX_SUBDIVISION = 12;
const MAX_SUBDIVISION_ACROSS_NEAR = 6;

export type ProjectedStroke = { color: Color; width: number };
export type ProjectedRun = { points: Vec2[]; closed: boolean };

// Coordinates are in image space, with the camera's axis at the origin.
export type ShapeItem = {
  kind: 'shape';
  depth: number;
  runs: ProjectedRun[];
  fill: Color | null;
  stroke: ProjectedStroke | null;
};

// Each polygon winds the same way on screen, so a nonzero fill of them all covers their union.
export type MeshItem = {
  kind: 'mesh';
  depth: number;
  polygons: Vec2[][];
  lines: Vec2[][];
  // The visible stretches of marked edges, drawn over the fill.
  marks?: Vec2[][];
  fill: Rgb;
  border: ProjectedStroke | null;
  highlight?: Rgb;
};

// An ellipse in image space, with radiusX along the direction at angle, as canvas's ellipse() takes it.
export type ProjectedEllipse = { x: number; y: number; radiusX: number; radiusY: number; angle: number };

// Part of an ellipse, from start to end in its parametric angle, increasing.
export type EllipseArc = ProjectedEllipse & { start: number; end: number };

// The outline is its arcs in order, each joined to the next by a straight line, then closed.
export type EllipsoidItem = {
  kind: 'ellipsoid';
  // The scene node's name, so callers can tell items apart after sorting.
  name?: string;
  depth: number;
  arcs: EllipseArc[];
  fill: Rgb;
  border: ProjectedStroke | null;
  highlight?: Rgb;
};

export type DrawItem = (ShapeItem | MeshItem | EllipsoidItem) & { stack?: Stack };

function project({ x, y, z }: Vec3, focalLength: number): Vec2 {
  return { x: focalLength * x / z, y: focalLength * y / z };
}

// Where a world point lands in image space, or null if it is behind the camera.
export function projectPoint(camera: Camera, { x, y, z }: Vec3): Vec2 | null {
  const point = applyMatrix(viewMatrix(camera), x, y, z);
  return point.z < NEAR_DEPTH ? null : project(point, camera.focalLength);
}

// The part of a world-space segment in front of the camera, in image space.
export function projectSegment(camera: Camera, a: Vec3, b: Vec3): [Vec2, Vec2] | null {
  const view = viewMatrix(camera);
  const [run] = clipOpenPath([applyMatrix(view, a.x, a.y, a.z), applyMatrix(view, b.x, b.y, b.z)]);
  return run ? [project(run[0], camera.focalLength), project(run[1], camera.focalLength)] : null;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const s = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - a.x - s * dx, p.y - a.y - s * dy);
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

// Appends a camera-space cubic as line segments, excluding its first point. A projected cubic is
// no longer a cubic, but it stays within the hull of its projected control points, so they bound
// its distance from a straight line.
function flattenCubic(
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3,
  focalLength: number, tolerance: number, level: number, output: Vec3[]
) {
  const minDepth = Math.min(p0.z, p1.z, p2.z, p3.z);
  const maxDepth = Math.max(p0.z, p1.z, p2.z, p3.z);
  let flat: boolean;
  if (maxDepth < NEAR_DEPTH) {
    flat = true;
  } else if (minDepth < NEAR_DEPTH) {
    flat = level >= MAX_SUBDIVISION_ACROSS_NEAR;
  } else {
    const start = project(p0, focalLength);
    const end = project(p3, focalLength);
    flat = level >= MAX_SUBDIVISION || Math.max(
      distanceToSegment(project(p1, focalLength), start, end),
      distanceToSegment(project(p2, focalLength), start, end)
    ) <= tolerance;
  }
  if (flat) {
    output.push(p3);
    return;
  }

  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const center = midpoint(p012, p123);
  flattenCubic(p0, p01, p012, center, focalLength, tolerance, level + 1, output);
  flattenCubic(center, p123, p23, p3, focalLength, tolerance, level + 1, output);
}

function flattenPath({ anchors, closed }: PathGeometry, matrix: Matrix, focalLength: number, tolerance: number): Vec3[] {
  if (anchors.length === 0) {
    return [];
  }
  const start = anchors[0].point;
  const points = [applyMatrix(matrix, start.x, start.y, 0)];
  const segments = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segments; i++) {
    const from = anchors[i];
    const to = anchors[(i + 1) % anchors.length];
    // A straight segment stays straight in perspective, so its end is all it needs.
    if (from.out.x === 0 && from.out.y === 0 && to.in.x === 0 && to.in.y === 0) {
      points.push(applyMatrix(matrix, to.point.x, to.point.y, 0));
      continue;
    }
    flattenCubic(
      applyMatrix(matrix, from.point.x, from.point.y, 0),
      applyMatrix(matrix, from.point.x + from.out.x, from.point.y + from.out.y, 0),
      applyMatrix(matrix, to.point.x + to.in.x, to.point.y + to.in.y, 0),
      applyMatrix(matrix, to.point.x, to.point.y, 0),
      focalLength, tolerance, 0, points
    );
  }
  if (closed) {
    points.pop();
  }
  return points;
}

function nearCrossing(a: Vec3, b: Vec3): Vec3 {
  const s = (NEAR_DEPTH - a.z) / (b.z - a.z);
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: NEAR_DEPTH };
}

function clipPolygon(points: Vec3[]): Vec3[] {
  const result: Vec3[] = [];
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length];
    const inside = point.z >= NEAR_DEPTH;
    if (inside) {
      result.push(point);
    }
    if (inside !== (next.z >= NEAR_DEPTH)) {
      result.push(nearCrossing(point, next));
    }
  });
  return result;
}

function clipOpenPath(points: Vec3[]): Vec3[][] {
  const runs: Vec3[][] = [];
  let run: Vec3[] = [];
  points.forEach((point, i) => {
    const inside = point.z >= NEAR_DEPTH;
    if (inside) {
      run.push(point);
    }
    const next = points[i + 1];
    if (next && inside !== (next.z >= NEAR_DEPTH)) {
      run.push(nearCrossing(point, next));
      if (inside) {
        runs.push(run);
        run = [];
      }
    }
  });
  if (run.length > 0) {
    runs.push(run);
  }
  return runs;
}

function meanDepth(points: Vec3[]): number {
  return points.reduce((sum, point) => sum + point.z, 0) / points.length;
}

function strokeOnScreen(
  stroke: { color: Color; width: number } | null, matrix: Matrix, depth: number, focalLength: number
): ProjectedStroke | null {
  return stroke && { color: stroke.color, width: stroke.width * averageScale(matrix) * focalLength / depth };
}

function projectShape(node: ShapeNode, matrix: Matrix, focalLength: number, tolerance: number): ShapeItem | null {
  const path = toPath(node.geometry);
  const points = flattenPath(path, matrix, focalLength, tolerance);
  const clipped = path.closed ? [clipPolygon(points)] : clipOpenPath(points);
  const visible = clipped.filter(run => run.length > 0);
  if (visible.length === 0) {
    return null;
  }
  const depth = meanDepth(visible.flat());
  return {
    kind: 'shape',
    depth,
    runs: visible.map(run => ({ points: run.map(point => project(point, focalLength)), closed: path.closed })),
    fill: node.style.fill,
    stroke: strokeOnScreen(node.style.stroke, matrix, depth, focalLength),
  };
}

function signedArea(polygon: Vec2[]): number {
  let area = 0;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.y - b.x * a.y;
  });
  return area / 2;
}

// The finest step along a marked edge, as a share of the mesh's size on screen.
const MARK_SAMPLE_SHARE = 1 / 150;
// A stretch of an edge whose ends agree is taken as wholly shown or hidden up to this many sample
// spacings long.
const COARSE_MARK_SAMPLES = 8;
// Triangles are bucketed in a grid this many cells across the mesh's screen bounds, so each sample
// tests only the faces near it.
const MARK_GRID = 24;
// How much nearer a face must be to hide a point on a marked edge, as a share of the point's depth.
// The edge's own faces pass through it at the same depth, so they never hide it.
const MARK_DEPTH_TOLERANCE = 1e-3;

// The parts of each marked edge not hidden by the mesh's own faces, projected. Each edge is sampled,
// and a sample is hidden when a face covers it on screen at a nearer depth. Depth is interpolated as
// 1 / z, which is linear on screen. Faces reaching behind the near plane don't hide anything.
//
// Runs every frame, so it keeps to flat typed arrays: vertices are projected once, triangle bounds sit
// in one buffer, and the grid is two integer arrays filled by counting, with nothing allocated per
// sample.
function visibleMarks(marked: [number, number][], vertices: Vec3[], faces: Face[], focalLength: number): Vec2[][] {
  const n = vertices.length;
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const iz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const { x, y, z } = vertices[i];
    iz[i] = 1 / z;
    sx[i] = focalLength * x * iz[i];
    sy[i] = focalLength * y * iz[i];
  }
  const all = allTriangles(faces, vertices);
  const tri = new Int32Array(all.length * 3);
  const bounds = new Float64Array(all.length * 4);
  let count = 0;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const [a, b, c] of all) {
    if (vertices[a].z < NEAR_DEPTH || vertices[b].z < NEAR_DEPTH || vertices[c].z < NEAR_DEPTH) continue;
    tri[count * 3] = a;
    tri[count * 3 + 1] = b;
    tri[count * 3 + 2] = c;
    const l = Math.min(sx[a], sx[b], sx[c]);
    const r = Math.max(sx[a], sx[b], sx[c]);
    const t = Math.min(sy[a], sy[b], sy[c]);
    const btm = Math.max(sy[a], sy[b], sy[c]);
    bounds[count * 4] = l;
    bounds[count * 4 + 1] = r;
    bounds[count * 4 + 2] = t;
    bounds[count * 4 + 3] = btm;
    if (l < left) left = l;
    if (r > right) right = r;
    if (t < top) top = t;
    if (btm > bottom) bottom = btm;
    count++;
  }
  const cellW = (right - left) / MARK_GRID || 1;
  const cellH = (bottom - top) / MARK_GRID || 1;
  const column = (x: number) => Math.min(MARK_GRID - 1, Math.max(0, Math.floor((x - left) / cellW)));
  const row = (y: number) => Math.min(MARK_GRID - 1, Math.max(0, Math.floor((y - top) / cellH)));
  // Counting sort of triangles into cells: first how many each cell gets, then where each starts.
  const cellCount = MARK_GRID * MARK_GRID;
  const starts = new Int32Array(cellCount + 1);
  for (let k = 0; k < count; k++) {
    for (let r = row(bounds[k * 4 + 2]); r <= row(bounds[k * 4 + 3]); r++) {
      for (let c = column(bounds[k * 4]); c <= column(bounds[k * 4 + 1]); c++) starts[r * MARK_GRID + c + 1]++;
    }
  }
  for (let i = 0; i < cellCount; i++) starts[i + 1] += starts[i];
  const fill = starts.slice(0, cellCount);
  const items = new Int32Array(starts[cellCount]);
  for (let k = 0; k < count; k++) {
    for (let r = row(bounds[k * 4 + 2]); r <= row(bounds[k * 4 + 3]); r++) {
      for (let c = column(bounds[k * 4]); c <= column(bounds[k * 4 + 1]); c++) items[fill[r * MARK_GRID + c]++] = k;
    }
  }
  const hidden = (px: number, py: number, z: number) => {
    if (px < left || px > right || py < top || py > bottom) return false;
    const cell = row(py) * MARK_GRID + column(px);
    for (let at = starts[cell]; at < starts[cell + 1]; at++) {
      const k = items[at];
      if (px < bounds[k * 4] || px > bounds[k * 4 + 1] || py < bounds[k * 4 + 2] || py > bounds[k * 4 + 3]) continue;
      const a = tri[k * 3], b = tri[k * 3 + 1], c = tri[k * 3 + 2];
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
      if (Math.abs(area) < 1e-12) continue;
      const u = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) / area;
      const v = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) / area;
      const w = 1 - u - v;
      if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
      if (1 / (u * iz[a] + v * iz[b] + w * iz[c]) < z * (1 - MARK_DEPTH_TOLERANCE)) return true;
    }
    return false;
  };
  const spacing = Math.hypot(right - left, bottom - top) * MARK_SAMPLE_SHARE || 1;
  const coarse = spacing * COARSE_MARK_SAMPLES;
  // The edge being sampled, on screen and in depth. The helpers below read these, so they're made
  // once per mesh rather than once per edge.
  let ax = 0, ay = 0, bx = 0, by = 0, fromZ = 1, toZ = 1, length = 0;
  const ts: number[] = [];
  const vs: boolean[] = [];
  const shown = (t: number) => !hidden(ax + (bx - ax) * t, ay + (by - ay) * t, 1 / ((1 - t) / fromZ + t / toZ));
  // Adaptive: an edge is tested at its ends and middle, and a stretch is split again only where
  // those disagree, or where it's long enough on screen to hide something between its tests. Splits
  // stop at the sample spacing, so where visibility changes it's found as finely as before, while
  // a short edge that's plainly in view or plainly hidden costs three tests.
  const refine = (t0: number, v0: boolean, t1: number, v1: boolean) => {
    const span = (t1 - t0) * length;
    if (span <= spacing || (v0 === v1 && span <= coarse && t1 - t0 < 1)) {
      ts.push(t1);
      vs.push(v1);
      return;
    }
    const tm = (t0 + t1) / 2;
    const vm = shown(tm);
    refine(t0, v0, tm, vm);
    refine(tm, vm, t1, v1);
  };
  const runs: Vec2[][] = [];
  for (const [i, j] of marked) {
    let from = vertices[i];
    let to = vertices[j];
    if (from.z < NEAR_DEPTH || to.z < NEAR_DEPTH) {
      const [run] = clipOpenPath([from, to]);
      if (!run) continue;
      [from, to] = run;
    }
    ax = (focalLength * from.x) / from.z;
    ay = (focalLength * from.y) / from.z;
    bx = (focalLength * to.x) / to.z;
    by = (focalLength * to.y) / to.z;
    fromZ = from.z;
    toZ = to.z;
    length = Math.hypot(bx - ax, by - ay);
    ts.length = 0;
    vs.length = 0;
    ts.push(0);
    vs.push(shown(0));
    refine(0, vs[0], 1, shown(1));
    // A marked edge is straight on screen, so a visible stretch needs only its two ends.
    let first = -1;
    for (let k = 0; k <= ts.length; k++) {
      if (k < ts.length && vs[k]) {
        if (first < 0) first = k;
      } else if (first >= 0) {
        if (k - 1 > first) {
          const [t0, t1] = [ts[first], ts[k - 1]];
          runs.push([{ x: ax + (bx - ax) * t0, y: ay + (by - ay) * t0 }, { x: ax + (bx - ax) * t1, y: ay + (by - ay) * t1 }]);
        }
        first = -1;
      }
    }
  }
  return runs;
}

// A mesh's outline as closed loops whose nonzero fill covers exactly what its triangles cover.
// Each projected triangle is wound positively on screen, so it adds +1 inside itself. An edge two
// triangles share from opposite sides on screen is then run both ways and cancels; what's left are
// the silhouette, fold, and open edges, which chain into loops with the same winding everywhere, so
// they fill the same area. Stroking them draws only the outline that shows, where stroking every
// triangle drew it too but painted the rest over. Null if any vertex is behind the near plane, which
// needs clipping triangle by triangle.
function outlineLoops(node: MeshNode, vertices: Vec3[], focalLength: number): { loops: Vec2[][]; depthSum: number; depthCount: number } | null {
  const n = vertices.length;
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const { x, y, z } = vertices[i];
    if (z < NEAR_DEPTH) return null;
    sx[i] = (focalLength * x) / z;
    sy[i] = (focalLength * y) / z;
  }
  const { triangles, edgeA, edgeB, sides, directions, corners } = edgeTopology(node.faces.value, node.vertices);
  const count = new Int32Array(edgeA.length);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
    if (area === 0) continue;
    const sign = area > 0 ? 1 : -1;
    count[sides[t]] += sign * directions[t];
    count[sides[t + 1]] += sign * directions[t + 1];
    count[sides[t + 2]] += sign * directions[t + 2];
  }
  // The edges left over, directed, then sorted by where they start.
  const from: number[] = [];
  const to: number[] = [];
  for (let e = 0; e < count.length; e++) {
    for (let k = count[e]; k > 0; k--) { from.push(edgeA[e]); to.push(edgeB[e]); }
    for (let k = count[e]; k < 0; k++) { from.push(edgeB[e]); to.push(edgeA[e]); }
  }
  const starts = new Int32Array(n + 1);
  for (const v of from) starts[v + 1]++;
  for (let v = 0; v < n; v++) starts[v + 1] += starts[v];
  const cursor = starts.slice(0, n);
  const order = new Int32Array(from.length);
  from.forEach((v, i) => { order[cursor[v]++] = i; });
  cursor.set(starts.subarray(0, n));
  // Every vertex has as many edges in as out, so walking unused edges always returns to the start.
  const used = new Uint8Array(from.length);
  const loops: Vec2[][] = [];
  for (let i = 0; i < from.length; i++) {
    if (used[i]) continue;
    const loop: Vec2[] = [{ x: sx[from[i]], y: sy[from[i]] }];
    let current = i;
    for (;;) {
      used[current] = 1;
      const v = to[current];
      let next = -1;
      while (cursor[v] < starts[v + 1]) {
        const candidate = order[cursor[v]++];
        if (!used[candidate]) { next = candidate; break; }
      }
      if (next < 0) break;
      loop.push({ x: sx[v], y: sy[v] });
      current = next;
    }
    loops.push(loop);
  }
  let depthSum = 0;
  let depthCount = 0;
  for (let i = 0; i < n; i++) {
    depthSum += corners[i] * vertices[i].z;
    depthCount += corners[i];
  }
  return { loops, depthSum, depthCount };
}

function projectMesh(node: MeshNode, matrix: Matrix, focalLength: number): MeshItem | null {
  const vertices = node.vertices.map(({ x, y, z }) => applyMatrix(matrix, x, y, z));
  const outline = outlineLoops(node, vertices, focalLength);
  const polygons: Vec2[][] = outline ? outline.loops : [];
  // Depth weighs every triangle corner, then every line end, as before.
  let depthSum = outline?.depthSum ?? 0;
  let depthCount = outline?.depthCount ?? 0;
  // Faces draw as their triangles: a projected triangle can't fold over itself, so every piece can
  // be wound the same way and the nonzero fill covers their union. A larger face, a curved one most
  // of all, can fold over seen nearly edge-on, and its reversed part would cancel what's behind it.
  for (const face of outline ? [] : allTriangles(node.faces.value, node.vertices)) {
    const clipped = clipPolygon(face.map(i => vertices[i]));
    if (clipped.length === 0) {
      continue;
    }
    depthSum += meanDepth(clipped) * clipped.length;
    depthCount += clipped.length;
    const polygon = clipped.map(point => project(point, focalLength));
    polygons.push(signedArea(polygon) < 0 ? polygon.reverse() : polygon);
  }
  const lines: Vec2[][] = [];
  for (const [a, b] of node.edges.value) {
    const [run] = clipOpenPath([vertices[a], vertices[b]]);
    if (run) {
      depthSum += meanDepth(run) * run.length;
      depthCount += run.length;
      lines.push(run.map(point => project(point, focalLength)));
    }
  }
  if (depthCount === 0) {
    return null;
  }
  const depth = depthSum / depthCount;
  const marks = node.marked?.value.length ? visibleMarks(node.marked.value, vertices, node.faces.value, focalLength) : [];
  return {
    kind: 'mesh',
    depth,
    polygons,
    lines,
    ...(marks.length ? { marks } : {}),
    fill: node.fill,
    border: strokeOnScreen(node.border, matrix, depth, focalLength),
    highlight: node.highlight?.value,
  };
}

const FULL_TURN = 2 * Math.PI;

function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const determinant = a * A + b * B + c * C;
  if (Math.abs(determinant) < 1e-18) {
    return null;
  }
  return [
    A / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant,
    B / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant,
    C / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant,
  ];
}

// The outline of a camera-space ellipsoid, (p - center) . A (p - center) = 1, seen from the camera
// at the origin. The rays that graze it form a cone, d . K d = 0, and the image plane cuts the cone
// in an ellipse. Null when the camera is inside it, or it reaches behind the image plane's horizon.
export function projectEllipsoidAt(center: Vec3, A: number[], focalLength: number): ProjectedEllipse | null {
  const c = [center.x, center.y, center.z];
  const Ac = [0, 1, 2].map(r => A[3 * r] * c[0] + A[3 * r + 1] * c[1] + A[3 * r + 2] * c[2]);
  const k = c[0] * Ac[0] + c[1] * Ac[1] + c[2] * Ac[2] - 1;
  if (k <= 0) {
    return null;
  }
  const K = (r: number, s: number) => Ac[r] * Ac[s] - k * A[3 * r + s];
  // With image point q, the ray is (q, f): q . K2 q + 2 f kv . q + f^2 kzz = 0.
  const [k00, k01, k11, k02, k12, k22] = [K(0, 0), K(0, 1), K(1, 1), K(0, 2), K(1, 2), K(2, 2)];
  const determinant = k00 * k11 - k01 * k01;
  if (determinant <= 0) {
    return null;
  }
  const f = focalLength;
  const x = -f * (k11 * k02 - k01 * k12) / determinant;
  const y = -f * (k00 * k12 - k01 * k02) / determinant;
  const rhs = f * f * ((k11 * k02 * k02 - 2 * k01 * k02 * k12 + k00 * k12 * k12) / determinant - k22);
  // (q - center) . S (q - center) = 1, with S = K2 / rhs, which must be positive definite.
  const [a, b, d] = [k00 / rhs, k01 / rhs, k11 / rhs];
  if (!(a > 0) || !(d > 0)) {
    return null;
  }
  const half = Math.hypot((a - d) / 2, b);
  const larger = (a + d) / 2 + half;
  const smaller = (a + d) / 2 - half;
  if (smaller <= 0) {
    return null;
  }
  return { x, y, radiusX: 1 / Math.sqrt(larger), radiusY: 1 / Math.sqrt(smaller), angle: Math.atan2(2 * b, a - d) / 2 };
}

// The semi-axes in camera space are the columns of M = linear(matrix) * diag(radii), and the
// ellipsoid is |M^-1 (p - center)| = 1, so A = M^-T M^-1.
function ellipsoidQuadric(matrix: Matrix, radii: Vec3): { M: number[]; A: number[]; inverse: number[] } | null {
  const M = [
    matrix[0] * radii.x, matrix[1] * radii.y, matrix[2] * radii.z,
    matrix[4] * radii.x, matrix[5] * radii.y, matrix[6] * radii.z,
    matrix[8] * radii.x, matrix[9] * radii.y, matrix[10] * radii.z,
  ];
  const inverse = invert3(M);
  if (!inverse) {
    return null;
  }
  const A = [0, 1, 2].flatMap(r => [0, 1, 2].map(s => (
    inverse[r] * inverse[s] + inverse[3 + r] * inverse[3 + s] + inverse[6 + r] * inverse[6 + s]
  )));
  return { M, A, inverse };
}

// Where a camera-space point lands on an image ellipse, as its parametric angle.
function angleOn(e: ProjectedEllipse, p: Vec3, focalLength: number): number {
  const [qx, qy] = [focalLength * p.x / p.z - e.x, focalLength * p.y / p.z - e.y];
  const [cos, sin] = [Math.cos(e.angle), Math.sin(e.angle)];
  return Math.atan2((qy * cos - qx * sin) / e.radiusY, (qx * cos + qy * sin) / e.radiusX);
}

// The outline of a swept ellipsoid, in closed form. Mapped by M^-1 about its centre, it becomes two
// unit spheres at (0, 0, +-h), and the eye lands at e = -M^-1 centre. A plane through the eye that
// touches both spheres on the same side has a unit normal n square to z, with n . e = -1, so
// n = (cos t, sin t, 0) where t = atan2(e.y, e.x) + PI +- acos(1 / |e.xy|). It touches each sphere at
// its centre minus n. A linear map keeps planes and tangency, so mapping those four points back gives
// where the outline's two straight sides meet each end's ellipse. With the eye inside the spheres'
// cylinder, |e.xy| <= 1, there is no such plane: the nearer end hides the farther one entirely.
function sweptOutline(center: Vec3, M: number[], inverse: number[], A: number[], h: number, focalLength: number): EllipseArc[] {
  const ends = [h, -h].map(z => ({ x: center.x + M[2] * z, y: center.y + M[5] * z, z: center.z + M[8] * z }));
  const [top, bottom] = ends.map(end => projectEllipsoidAt(end, A, focalLength));
  if (!top || !bottom) {
    return [];
  }
  const eye = [0, 1, 2].map(r => -(inverse[3 * r] * center.x + inverse[3 * r + 1] * center.y + inverse[3 * r + 2] * center.z));
  const reach = Math.hypot(eye[0], eye[1]);
  if (reach <= 1) {
    const nearTop = Math.hypot(eye[0], eye[1], eye[2] - h) < Math.hypot(eye[0], eye[1], eye[2] + h);
    return [{ ...(nearTop ? top : bottom), start: 0, end: FULL_TURN }];
  }
  const facing = Math.atan2(eye[1], eye[0]) + Math.PI;
  const spread = Math.acos(1 / reach);
  // Each side's touching points on the top and bottom ends, in camera space.
  const sides = [facing - spread, facing + spread].map(t => {
    const [nx, ny] = [Math.cos(t), Math.sin(t)];
    return [h, -h].map(z => ({
      x: center.x - M[0] * nx - M[1] * ny + M[2] * z,
      y: center.y - M[3] * nx - M[4] * ny + M[5] * z,
      z: center.z - M[6] * nx - M[7] * ny + M[8] * z,
    }));
  });
  const [topA, topB] = [angleOn(top, sides[0][0], focalLength), angleOn(top, sides[1][0], focalLength)];
  const [bottomA, bottomB] = [angleOn(bottom, sides[0][1], focalLength), angleOn(bottom, sides[1][1], focalLength)];
  // Of the two arcs between a pair of points, the outline keeps the one facing away from the other
  // end. Canvas runs arcs one way only, so pick which point to start from by testing a midpoint.
  const away = { x: top.x - bottom.x, y: top.y - bottom.y };
  const span = (((topB - topA) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const middle = topA + span / 2;
  const [cos, sin] = [Math.cos(top.angle), Math.sin(top.angle)];
  const [u, v] = [top.radiusX * Math.cos(middle), top.radiusY * Math.sin(middle)];
  const outward = (u * cos - v * sin) * away.x + (u * sin + v * cos) * away.y > 0;
  return outward
    ? [{ ...top, start: topA, end: topB }, { ...bottom, start: bottomB, end: bottomA }]
    : [{ ...top, start: topB, end: topA }, { ...bottom, start: bottomA, end: bottomB }];
}

function projectEllipsoid(node: EllipsoidNode, matrix: Matrix, focalLength: number): EllipsoidItem | null {
  const quadric = ellipsoidQuadric(matrix, node.radii);
  if (!quadric) {
    return null;
  }
  const { M, A } = quadric;
  const center = applyMatrix(matrix, 0, 0, 0);
  const sweep = { x: matrix[2] * node.length, y: matrix[6] * node.length, z: matrix[10] * node.length };
  // All of it must be in front of the near plane, since the outline is never clipped.
  const depthReach = Math.hypot(M[6], M[7], M[8]) + Math.abs(sweep.z);
  if (center.z - depthReach < NEAR_DEPTH) {
    return null;
  }
  let arcs: EllipseArc[] = [];
  if (node.length === 0) {
    const outline = projectEllipsoidAt(center, A, focalLength);
    arcs = outline ? [{ ...outline, start: 0, end: FULL_TURN }] : [];
  } else {
    arcs = sweptOutline(center, M, quadric.inverse, A, node.length / node.radii.z, focalLength);
  }
  if (arcs.length === 0) {
    return null;
  }
  return {
    kind: 'ellipsoid',
    name: node.name,
    depth: center.z,
    arcs,
    fill: node.fill,
    border: strokeOnScreen(node.border, matrix, center.z, focalLength),
    highlight: node.highlight?.value,
  };
}

// Reduces a 3D scene to flat items in painting order, farthest first. Each shape or mesh sorts as
// a single item by its average depth, and items at equal depth keep their document order.
// tolerance is the largest allowed error from flattening curves, in image units.
export function projectScene({ camera, nodes }: Scene, tolerance: number): DrawItem[] {
  const items: DrawItem[] = [];
  const visit = (node: SceneNode, parent: Matrix) => {
    const local = (node.kind === 'mesh' || node.kind === 'ellipsoid') && node.worldMatrix ? node.worldMatrix.value : transformMatrix(node.transform);
    const matrix = multiply(parent, local);
    if (node.kind === 'group') {
      node.children.forEach(child => visit(child, matrix));
      return;
    }
    const item = node.kind === 'shape'
      ? projectShape(node, matrix, camera.focalLength, tolerance)
      : node.kind === 'ellipsoid'
        ? projectEllipsoid(node, matrix, camera.focalLength)
        : projectMesh(node, matrix, camera.focalLength);
    if (item) {
      items.push(node.stack ? { ...item, stack: node.stack.value } : item);
    }
  };
  const view = viewMatrix(camera);
  nodes.forEach(node => visit(node, view));
  // A stack sorts as one item, at its members' average depth, and its members by index.
  const stacks = new Map<string, { sum: number; count: number }>();
  for (const item of items) {
    if (item.stack) {
      const entry = stacks.get(item.stack.id) ?? { sum: 0, count: 0 };
      entry.sum += item.depth;
      entry.count++;
      stacks.set(item.stack.id, entry);
    }
  }
  const depthOf = (item: DrawItem) => {
    const entry = item.stack && stacks.get(item.stack.id);
    return entry ? entry.sum / entry.count : item.depth;
  };
  return items.sort((a, b) => {
    const order = depthOf(b) - depthOf(a);
    if (order !== 0 || !a.stack || !b.stack || a.stack.id !== b.stack.id) return order;
    return a.stack.index - b.stack.index;
  });
}
