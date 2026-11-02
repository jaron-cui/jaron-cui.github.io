import { VertexGroup } from './armature';
import { Edge, Face, Vec3 } from './model';
import { MeshData } from './primitives';

export type MirrorAxis = 'x' | 'y' | 'z';

// Reflects a mesh across its object's own planes without changing the mesh itself. Vertices within
// the threshold of a plane join their reflections, so the two halves make one surface. With clipping,
// editing cannot take a vertex across a plane, or away from one it sits on.
export type MirrorModifier = {
  id: string;
  kind: 'mirror';
  axes: Record<MirrorAxis, boolean>;
  merge: boolean;
  threshold: number;
  clipping: boolean;
};

export type Modifier = MirrorModifier;

export const DEFAULT_MERGE_THRESHOLD = 1;
const AXES: MirrorAxis[] = ['x', 'y', 'z'];

export function newMirror(id: string): MirrorModifier {
  return { id, kind: 'mirror', axes: { x: true, y: false, z: false }, merge: true, threshold: DEFAULT_MERGE_THRESHOLD, clipping: true };
}

// Group.L and Group.R swap sides in a reflection, as do _L and _R.
export function flippedName(name: string): string {
  const match = /^(.*[._-])([LlRr])(\.\d+)?$/.exec(name);
  if (!match) {
    return name;
  }
  const flipped = { L: 'R', R: 'L', l: 'r', r: 'l' }[match[2]];
  return `${match[1]}${flipped}${match[3] ?? ''}`;
}

export type MirrorResult = MeshData & {
  groups: VertexGroup[];
  // For each vertex added at the end, the vertex it reflects.
  copiedFrom: number[];
  // Vertices brought onto the plane by joining their reflections.
  welded: number[];
};

function mirrorAcross(mesh: MeshData, groups: VertexGroup[], axis: MirrorAxis, modifier: MirrorModifier): MirrorResult {
  const onPlane = (vertex: Vec3) => modifier.merge && Math.abs(vertex[axis]) <= modifier.threshold;
  const count = mesh.vertices.length;
  const copiedFrom: number[] = [];
  const welded: number[] = [];
  const copyOf = mesh.vertices.map((vertex, i) => {
    if (onPlane(vertex)) {
      welded.push(i);
      return i;
    }
    copiedFrom.push(i);
    return count + copiedFrom.length - 1;
  });
  const vertices: Vec3[] = [
    ...mesh.vertices.map(vertex => (onPlane(vertex) ? { ...vertex, [axis]: 0 } : vertex)),
    ...copiedFrom.map(source => ({ ...mesh.vertices[source], [axis]: -mesh.vertices[source][axis] })),
  ];
  const isCopied = (i: number) => copyOf[i] !== i;
  const faces: Face[] = [
    ...mesh.faces,
    ...mesh.faces.filter(face => face.some(isCopied)).map(([a, b, c]): Face => [copyOf[a], copyOf[c], copyOf[b]]),
  ];
  const edges: Edge[] = [
    ...mesh.edges,
    ...mesh.edges.filter(edge => edge.some(isCopied)).map(([a, b]): Edge => [copyOf[a], copyOf[b]]),
  ];
  // Only reflecting across x swaps left and right.
  const sideOf = (name: string) => (axis === 'x' ? flippedName(name) : name);
  const result = new Map(groups.map(group => [group.name, { ...group, weights: new Map(group.weights) }]));
  groups.forEach(group => {
    const name = sideOf(group.name);
    const receiving = result.get(name) ?? { id: `${group.id}:mirrored`, name, weights: new Map<number, number>() };
    result.set(name, receiving);
    group.weights.forEach((weight, i) => {
      if (isCopied(i)) {
        receiving.weights.set(copyOf[i], weight);
      }
    });
  });
  return { vertices, faces, edges, groups: Array.from(result.values()), copiedFrom, welded };
}

// One modifier's result on a mesh and its vertex groups.
export function mirrorMesh(mesh: MeshData, groups: VertexGroup[], modifier: MirrorModifier): MirrorResult {
  let result: MirrorResult = { ...mesh, groups, copiedFrom: [], welded: [] };
  for (const axis of AXES.filter(candidate => modifier.axes[candidate])) {
    const step = mirrorAcross(result, result.groups, axis, modifier);
    result = {
      ...step,
      // A copy of a copy reflects whatever the first copy did.
      copiedFrom: [...result.copiedFrom, ...step.copiedFrom],
      welded: Array.from(new Set([...result.welded, ...step.welded])),
    };
  }
  return result;
}

// What a mesh becomes under all of its modifiers, in order.
export function modifiedMesh(mesh: MeshData, groups: VertexGroup[], modifiers: readonly Modifier[]): MeshData & { groups: VertexGroup[] } {
  return modifiers.reduce<MeshData & { groups: VertexGroup[] }>((current, modifier) => mirrorMesh(current, current.groups, modifier), { ...mesh, groups });
}

// Holds edited vertices to their sides of any planes that clip.
export function clippedByMirrors(edited: Vec3[], before: Vec3[], modifiers: readonly Modifier[]): Vec3[] {
  const clipping = (modifiers ?? []).filter(modifier => modifier.clipping);
  if (clipping.length === 0) {
    return edited;
  }
  return edited.map((vertex, i) => {
    let result = vertex;
    for (const { axes, threshold } of clipping) {
      for (const axis of AXES.filter(candidate => axes[candidate])) {
        const start = before[i][axis];
        if (Math.abs(start) <= threshold || start * result[axis] < 0) {
          result = { ...result, [axis]: 0 };
        }
      }
    }
    return result;
  });
}
