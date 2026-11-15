// Marked edges: lines of a mesh drawn along with its outline, like Blender's Freestyle edge marks.
// A mesh draws as one silhouette, so the creases and contours inside it vanish; marking them brings
// them back. Marks are vertex index pairs, kept on the object beside its faces and lines, and follow
// every edit that renumbers vertices the way vertex groups do.
import type { Edge, Face } from '../../../lib/vrender/model';
import type { Selection } from './editing';

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

// Every line of the mesh: face sides and standalone lines, each once.
function meshLines(faces: Face[], edges: Edge[]): Edge[] {
  const seen = new Map<string, Edge>();
  const add = (a: number, b: number) => {
    if (a !== b && !seen.has(key(a, b))) seen.set(key(a, b), a < b ? [a, b] : [b, a]);
  };
  for (const [a, b, c] of faces) {
    add(a, b);
    add(b, c);
    add(c, a);
  }
  for (const [a, b] of edges) add(a, b);
  return Array.from(seen.values());
}

// The mesh's lines with both ends selected, which is what Mark and Clear act on.
export function selectedLines(faces: Face[], edges: Edge[], selection: Selection): Edge[] {
  return meshLines(faces, edges).filter(([a, b]) => selection.has(a) && selection.has(b));
}

export function setMarked(marks: Edge[], lines: Edge[], marked: boolean): Edge[] {
  const chosen = new Set(lines.map(([a, b]) => key(a, b)));
  const kept = marks.filter(([a, b]) => !chosen.has(key(a, b)));
  return marked ? [...kept, ...lines] : kept;
}

// Drops marks that are no longer a line of the mesh, and duplicates.
export function marksOnMesh(marks: Edge[], faces: Face[], edges: Edge[]): Edge[] {
  const lines = new Set(meshLines(faces, edges).map(([a, b]) => key(a, b)));
  const seen = new Set<string>();
  return marks.filter(([a, b]) => {
    const k = key(a, b);
    if (!lines.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// After vertices are deleted: kept lists the survivors' old indices, in their new order.
export function marksAfterDelete(marks: Edge[], kept: number[]): Edge[] {
  const index = new Map(kept.map((old, i) => [old, i]));
  return marks.filter(([a, b]) => index.has(a) && index.has(b)).map(([a, b]): Edge => [index.get(a)!, index.get(b)!]);
}

// After vertices are copied to the end: copiedFrom lists each copy's source. Marks between copied
// vertices are copied too.
export function marksAfterCopy(marks: Edge[], copiedFrom: number[], count: number): Edge[] {
  const copyOf = new Map(copiedFrom.map((source, i) => [source, count + i]));
  const copies = marks.filter(([a, b]) => copyOf.has(a) && copyOf.has(b)).map(([a, b]): Edge => [copyOf.get(a)!, copyOf.get(b)!]);
  return [...marks, ...copies];
}

// After lines are split at new vertices appended in order: a marked line stays marked in both halves.
export function marksAfterSubdivide(marks: Edge[], splits: Edge[], count: number): Edge[] {
  const middle = new Map(splits.map(([a, b], i) => [key(a, b), count + i]));
  return marks.flatMap(([a, b]): Edge[] => {
    const m = middle.get(key(a, b));
    return m === undefined ? [[a, b]] : [[a, m], [m, b]];
  });
}

export function marksAfterOffset(marks: Edge[], offset: number): Edge[] {
  return marks.map(([a, b]): Edge => [a + offset, b + offset]);
}

// After a mirror: each vertex's reflection is a copy appended at the end, or the vertex itself where
// it was welded onto the plane. A mark is reflected when either end moved.
export function marksAfterMirror(marks: Edge[], copiedFrom: number[], count: number): Edge[] {
  const copyOf = new Map(copiedFrom.map((source, i) => [source, count + i]));
  const reflect = (v: number) => copyOf.get(v) ?? v;
  const reflected = marks.filter(([a, b]) => copyOf.has(a) || copyOf.has(b)).map(([a, b]): Edge => [reflect(a), reflect(b)]);
  return [...marks, ...reflected];
}
