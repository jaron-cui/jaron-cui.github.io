import { Edge, EllipsoidShape, Face, Vec3 } from '../../../lib/vrender/model';

export type MeshData = { vertices: Vec3[]; faces: Face[]; edges: Edge[] };

const FULL_TURN = Math.PI * 2;

export function vertexMesh(): MeshData {
  return { vertices: [{ x: 0, y: 0, z: 0 }], faces: [], edges: [] };
}

// Lies flat on the x-y plane.
export function planeMesh(halfSize: number): MeshData {
  return {
    vertices: [
      { x: -halfSize, y: -halfSize, z: 0 },
      { x: halfSize, y: -halfSize, z: 0 },
      { x: halfSize, y: halfSize, z: 0 },
      { x: -halfSize, y: halfSize, z: 0 },
    ],
    faces: [[0, 1, 2], [0, 2, 3]],
    edges: [],
  };
}

export function cubeMesh(halfSize: number): MeshData {
  const vertices: Vec3[] = [];
  for (const x of [-halfSize, halfSize]) {
    for (const y of [-halfSize, halfSize]) {
      for (const z of [-halfSize, halfSize]) {
        vertices.push({ x, y, z });
      }
    }
  }
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const faces = quads.flatMap(([a, b, c, d]): Face[] => [[a, b, c], [a, c, d]]);
  return { vertices, faces, edges: [] };
}

// A loop of lines with no face, lying flat on the x-y plane.
export function circleMesh(radius: number, steps: number): MeshData {
  const vertices: Vec3[] = [];
  const edges: Edge[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * FULL_TURN;
    vertices.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: 0 });
    edges.push([i, (i + 1) % steps]);
  }
  return { vertices, faces: [], edges };
}

// A low-poly stand-in for an ellipsoid, for picking, box select, and hiding things behind it. The
// ellipsoid itself draws from its exact outline. The upper half is swept up by length and the
// lower half down, with a band between them.
export function ellipsoidMesh({ radii, length }: EllipsoidShape, segments = 16, halfRings = 4): MeshData {
  const vertices: Vec3[] = [{ x: 0, y: 0, z: radii.z + length }];
  const rings: number[] = [];
  for (let i = 1; i <= halfRings; i++) {
    rings.push((i / halfRings) * (Math.PI / 2));
  }
  const polar = [...rings.map(angle => ({ angle, offset: length })), ...rings.map(angle => ({ angle: Math.PI - angle, offset: -length })).reverse()];
  for (const { angle, offset } of polar) {
    for (let j = 0; j < segments; j++) {
      const azimuth = (j / segments) * FULL_TURN;
      vertices.push({
        x: radii.x * Math.sin(angle) * Math.cos(azimuth),
        y: radii.y * Math.sin(angle) * Math.sin(azimuth),
        z: radii.z * Math.cos(angle) + offset,
      });
    }
  }
  const bottom = vertices.length;
  vertices.push({ x: 0, y: 0, z: -radii.z - length });
  const ring = (r: number, j: number) => 1 + r * segments + (j % segments);
  const faces: Face[] = [];
  for (let j = 0; j < segments; j++) {
    faces.push([0, ring(0, j), ring(0, j + 1)]);
    for (let r = 0; r + 1 < polar.length; r++) {
      faces.push([ring(r, j), ring(r + 1, j), ring(r + 1, j + 1)], [ring(r, j), ring(r + 1, j + 1), ring(r, j + 1)]);
    }
    faces.push([bottom, ring(polar.length - 1, j + 1), ring(polar.length - 1, j)]);
  }
  return { vertices, faces, edges: [] };
}

// The wire shape that shows where a camera is: a pyramid opening toward its local +y, its
// lens at the origin, with a small triangle marking which way is up.
export function cameraGizmoMesh(): MeshData {
  const [halfWidth, halfHeight, depth] = [40, 28, 60];
  return {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: -halfWidth, y: depth, z: halfHeight },
      { x: halfWidth, y: depth, z: halfHeight },
      { x: halfWidth, y: depth, z: -halfHeight },
      { x: -halfWidth, y: depth, z: -halfHeight },
      { x: -15, y: depth, z: halfHeight + 4 },
      { x: 15, y: depth, z: halfHeight + 4 },
      { x: 0, y: depth, z: halfHeight + 22 },
    ],
    faces: [],
    edges: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1], [5, 6], [6, 7], [7, 5]],
  };
}

export function torusMesh(ringRadius: number, tubeRadius: number, ringSteps: number, tubeSteps: number): MeshData {
  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  for (let i = 0; i < ringSteps; i++) {
    const ringAngle = (i / ringSteps) * FULL_TURN;
    for (let j = 0; j < tubeSteps; j++) {
      const tubeAngle = (j / tubeSteps) * FULL_TURN;
      const distance = ringRadius + tubeRadius * Math.cos(tubeAngle);
      vertices.push({
        x: distance * Math.cos(ringAngle),
        y: distance * Math.sin(ringAngle),
        z: tubeRadius * Math.sin(tubeAngle),
      });
      const here = i * tubeSteps + j;
      const nextTube = i * tubeSteps + (j + 1) % tubeSteps;
      const nextRing = ((i + 1) % ringSteps) * tubeSteps + j;
      const nextBoth = ((i + 1) % ringSteps) * tubeSteps + (j + 1) % tubeSteps;
      faces.push([here, nextRing, nextBoth], [here, nextBoth, nextTube]);
    }
  }
  return { vertices, faces, edges: [] };
}
