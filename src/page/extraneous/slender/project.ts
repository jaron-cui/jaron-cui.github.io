import { toPath } from './geometry';
import { applyMatrix, averageScale, Matrix, multiply, transformMatrix, viewMatrix } from './matrix';
import { Camera, Color, MeshNode, PathGeometry, Rgb, Scene, SceneNode, ShapeNode, Vec2, Vec3 } from './model';

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
  fill: Rgb;
  border: ProjectedStroke | null;
  highlight?: Rgb;
};

export type DrawItem = ShapeItem | MeshItem;

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

function projectMesh(node: MeshNode, matrix: Matrix, focalLength: number): MeshItem | null {
  const vertices = node.vertices.map(({ x, y, z }) => applyMatrix(matrix, x, y, z));
  const polygons: Vec2[][] = [];
  let depthSum = 0;
  let depthCount = 0;
  for (const [a, b, c] of node.faces.value) {
    const clipped = clipPolygon([vertices[a], vertices[b], vertices[c]]);
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
  return {
    kind: 'mesh',
    depth,
    polygons,
    lines,
    fill: node.fill,
    border: strokeOnScreen(node.border, matrix, depth, focalLength),
    highlight: node.highlight?.value,
  };
}

// Reduces a 3D scene to flat items in painting order, farthest first. Each shape or mesh sorts as
// a single item by its average depth, and items at equal depth keep their document order.
// tolerance is the largest allowed error from flattening curves, in image units.
export function projectScene({ camera, nodes }: Scene, tolerance: number): DrawItem[] {
  const items: DrawItem[] = [];
  const visit = (node: SceneNode, parent: Matrix) => {
    const local = node.kind === 'mesh' && node.worldMatrix ? node.worldMatrix.value : transformMatrix(node.transform);
    const matrix = multiply(parent, local);
    if (node.kind === 'group') {
      node.children.forEach(child => visit(child, matrix));
      return;
    }
    const item = node.kind === 'shape'
      ? projectShape(node, matrix, camera.focalLength, tolerance)
      : projectMesh(node, matrix, camera.focalLength);
    if (item) {
      items.push(item);
    }
  };
  const view = viewMatrix(camera);
  nodes.forEach(node => visit(node, view));
  return items.sort((a, b) => b.depth - a.depth);
}
