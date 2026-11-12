import { Constraint } from './constraints';
import { AnimatedVertex } from './keyframes';
import { applyMatrix, invertMatrix, Matrix, multiply } from '../../../lib/vrender/matrix';
import { Vec3 } from '../../../lib/vrender/model';

// A bone runs between two of its armature's vertices, which are shared where bones connect. Its
// transform is its pose, relative to where it rests. Like an object, it can have constraints, and
// its id is unique across the document so that anything can parent to or target it.
export type Bone = {
  id: string;
  name: string;
  parent: string | null;
  head: number;
  tail: number;
  transform: { position: AnimatedVertex; rotation: AnimatedVertex; scale: AnimatedVertex };
  constraints: Constraint[];
};

// Named weights on a mesh's vertices. A bone moves the group that has its name. A vertex with no
// entry has no weight in the group.
export type VertexGroup = { id: string; name: string; weights: ReadonlyMap<number, number> };

const AUTO_WEIGHT_POWER = 4;
const AUTO_WEIGHT_MINIMUM = 0.02;

function normalized({ x, y, z }: Vec3): Vec3 {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// A bone's frame at rest: at its head, with local +y along the bone and +z as near to up as it can
// be. A bone with no length points up.
export function restMatrix(head: Vec3, tail: Vec3): Matrix {
  const y = distance(head, tail) < 1e-9 ? { x: 0, y: 0, z: 1 } : normalized({ x: tail.x - head.x, y: tail.y - head.y, z: tail.z - head.z });
  const up = Math.abs(y.z) > 0.999 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const x = normalized(cross(y, up));
  const z = cross(x, y);
  return [x.x, y.x, z.x, head.x, x.y, y.y, z.y, head.y, x.z, y.z, z.z, head.z];
}

// The offset from a bone's frame to its tail, which is where things parented to the bone attach.
export function tailOffset(length: number): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, length, 0, 0, 1, 0];
}

// What a bone's movement from rest does to a point, with everything measured in world space.
export function skinMatrix(boneWorld: Matrix, restWorld: Matrix): Matrix {
  return multiply(boneWorld, invertMatrix(restWorld));
}

// Blends each weighted vertex between what its bones do to it, dividing by the total weight.
// Vertices with no weight in any bone's group stay where they are.
export function deformVertices(local: Vec3[], groups: VertexGroup[], skins: ReadonlyMap<string, Matrix>): Vec3[] {
  const sums = local.map(() => ({ x: 0, y: 0, z: 0, weight: 0 }));
  for (const { name, weights } of groups) {
    const skin = skins.get(name);
    if (skin) {
      weights.forEach((weight, i) => {
        if (weight > 0 && i < local.length) {
          const moved = applyMatrix(skin, local[i].x, local[i].y, local[i].z);
          sums[i].x += moved.x * weight;
          sums[i].y += moved.y * weight;
          sums[i].z += moved.z * weight;
          sums[i].weight += weight;
        }
      });
    }
  }
  return local.map((vertex, i) => {
    const { x, y, z, weight } = sums[i];
    return weight > 0 ? { x: x / weight, y: y / weight, z: z / weight } : vertex;
  });
}

function distanceToBone(point: Vec3, head: Vec3, tail: Vec3): number {
  const along = { x: tail.x - head.x, y: tail.y - head.y, z: tail.z - head.z };
  const lengthSquared = along.x * along.x + along.y * along.y + along.z * along.z;
  const fromHead = { x: point.x - head.x, y: point.y - head.y, z: point.z - head.z };
  const s = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (fromHead.x * along.x + fromHead.y * along.y + fromHead.z * along.z) / lengthSquared));
  return distance(point, { x: head.x + along.x * s, y: head.y + along.y * s, z: head.z + along.z * s });
}

// Weights each vertex by how close it is to each bone, falling away steeply so that the nearest
// bone dominates. Each result lists one bone's weights, and each vertex's weights total 1.
export function automaticWeights(vertices: Vec3[], bones: { head: Vec3; tail: Vec3 }[]): Map<number, number>[] {
  const result = bones.map(() => new Map<number, number>());
  vertices.forEach((vertex, i) => {
    const raw = bones.map(({ head, tail }) => Math.pow(Math.max(distanceToBone(vertex, head, tail), 1e-3), -AUTO_WEIGHT_POWER));
    const total = raw.reduce((sum, value) => sum + value, 0);
    const kept = raw.map(value => (value / total >= AUTO_WEIGHT_MINIMUM ? value : 0));
    const keptTotal = kept.reduce((sum, value) => sum + value, 0);
    kept.forEach((value, bone) => {
      if (value > 0) {
        result[bone].set(i, value / keptTotal);
      }
    });
  });
  return result;
}

// Blue at no weight, through green, to red at full weight.
export function weightColor(weight: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, weight)) * 4;
  if (t < 1) {
    return [0, t * 255, 255];
  }
  if (t < 2) {
    return [0, 255, (2 - t) * 255];
  }
  if (t < 3) {
    return [(t - 2) * 255, 255, 0];
  }
  return [255, (4 - t) * 255, 0];
}
