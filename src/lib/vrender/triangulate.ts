// Triangles for n-sided faces, for what needs them: depth tests, picking, occlusion. Drawing doesn't;
// canvas fills any simple polygon. A face is flattened onto its best-fit plane (Newell's normal) and
// cut by ear clipping, which handles concave faces and faces with a hole bridged in by a zero-width
// cut (the bridge's ends appear twice in the loop).
import type { Face, Vec3 } from './model';

export type Triangle = [number, number, number];

// The face's normal by Newell's method: the sum of its sides' cross terms, which works for concave and
// slightly bent faces alike. Not normalized; zero for a degenerate face.
export function faceNormal(points: Vec3[]): Vec3 {
  const n = { x: 0, y: 0, z: 0 };
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    n.x += (p.y - q.y) * (p.z + q.z);
    n.y += (p.z - q.z) * (p.x + q.x);
    n.z += (p.x - q.x) * (p.y + q.y);
  });
  return n;
}

// Ear clipping, in the plane square to the normal's largest axis. Returns triangles of indices into
// `loop`. Ears are taken counterclockwise in that plane, and a candidate ear is refused if any other
// vertex lies inside it, unless that vertex sits exactly on one of the ear's corners (as a bridge's
// duplicated ends do).
export function triangulateLoop(points: Vec3[]): Triangle[] {
  const n = points.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const normal = faceNormal(points);
  const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
  // Drop the dominant axis, keeping the winding counterclockwise when seen along the normal.
  const flat = points.map(p => (az >= ax && az >= ay
    ? { x: p.x, y: normal.z >= 0 ? p.y : -p.y }
    : ax >= ay
      ? { x: p.y, y: normal.x >= 0 ? p.z : -p.z }
      : { x: p.z, y: normal.y >= 0 ? p.x : -p.x }));
  const cross = (a: number, b: number, c: number) =>
    (flat[b].x - flat[a].x) * (flat[c].y - flat[a].y) - (flat[b].y - flat[a].y) * (flat[c].x - flat[a].x);
  const same = (i: number, j: number) => flat[i].x === flat[j].x && flat[i].y === flat[j].y;
  const inside = (p: number, a: number, b: number, c: number) => {
    if (same(p, a) || same(p, b) || same(p, c)) return false;
    return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  };
  const remaining = Array.from({ length: n }, (_, i) => i);
  const triangles: Triangle[] = [];
  let guard = 0;
  while (remaining.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < remaining.length; k++) {
      const a = remaining[(k + remaining.length - 1) % remaining.length];
      const b = remaining[k];
      const c = remaining[(k + 1) % remaining.length];
      const turn = cross(a, b, c);
      if (turn < 0) continue; // reflex
      if (turn === 0) {
        // A straight run, or a bridge folding back on itself: drop the middle vertex.
        remaining.splice(k, 1);
        clipped = true;
        break;
      }
      if (remaining.some(p => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      triangles.push([a, b, c]);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Self-intersecting or otherwise unclippable: fan the rest so something still covers it.
      for (let k = 1; k + 1 < remaining.length; k++) triangles.push([remaining[0], remaining[k], remaining[k + 1]]);
      return triangles;
    }
  }
  if (remaining.length === 3 && cross(remaining[0], remaining[1], remaining[2]) !== 0) {
    triangles.push([remaining[0], remaining[1], remaining[2]]);
  }
  return triangles;
}

const cache = new WeakMap<Face[], Triangle[][]>();

// Each face's triangles, as indices into the mesh's vertices. Cached per face list: meshes are
// immutable, and an animated mesh keeps its face list, so its triangles are worked out once, from
// the vertices given the first time.
export function faceTriangles(faces: Face[], vertices: Vec3[]): Triangle[][] {
  const known = cache.get(faces);
  if (known) return known;
  const result = faces.map(face => (face.length === 3
    ? [[face[0], face[1], face[2]] as Triangle]
    : triangulateLoop(face.map(i => vertices[i])).map(([a, b, c]): Triangle => [face[a], face[b], face[c]])));
  cache.set(faces, result);
  return result;
}

const flatCache = new WeakMap<Face[], Triangle[]>();

// Every face's triangles in one list, cached the same way.
export function allTriangles(faces: Face[], vertices: Vec3[]): Triangle[] {
  const known = flatCache.get(faces);
  if (known) return known;
  const result = faceTriangles(faces, vertices).flat();
  flatCache.set(faces, result);
  return result;
}

// A mesh's triangles and the edges between them, for drawing its outline: each edge once (a < b),
// and for each triangle side, which edge it is and whether the triangle runs along it a → b (+1) or
// b → a (−1). Also how many triangle corners each vertex has, for the mesh's average depth.
export type EdgeTopology = {
  triangles: Int32Array; // three vertex indices per triangle
  edgeA: Int32Array;
  edgeB: Int32Array;
  sides: Int32Array; // three edge indices per triangle
  directions: Int8Array; // three per triangle
  corners: Int32Array; // per vertex
};

const topologyCache = new WeakMap<Face[], EdgeTopology>();

export function edgeTopology(faces: Face[], vertices: Vec3[]): EdgeTopology {
  const known = topologyCache.get(faces);
  if (known && known.corners.length === vertices.length) return known;
  const list = allTriangles(faces, vertices);
  const n = vertices.length;
  const triangles = new Int32Array(list.length * 3);
  const sides = new Int32Array(list.length * 3);
  const directions = new Int8Array(list.length * 3);
  const corners = new Int32Array(n);
  const index = new Map<number, number>();
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  list.forEach((triangle, t) => {
    for (let k = 0; k < 3; k++) {
      const a = triangle[k];
      const b = triangle[(k + 1) % 3];
      triangles[t * 3 + k] = a;
      corners[a]++;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const key = lo * n + hi;
      let e = index.get(key);
      if (e === undefined) {
        e = edgeA.length;
        index.set(key, e);
        edgeA.push(lo);
        edgeB.push(hi);
      }
      sides[t * 3 + k] = e;
      directions[t * 3 + k] = a < b ? 1 : -1;
    }
  });
  const result = { triangles, edgeA: Int32Array.from(edgeA), edgeB: Int32Array.from(edgeB), sides, directions, corners };
  topologyCache.set(faces, result);
  return result;
}
