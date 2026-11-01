import { Edge, Face, Vec3 } from './model';

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
