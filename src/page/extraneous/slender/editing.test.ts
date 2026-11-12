import {
  appendMesh, blendPoints, proportionalWeights, cursorScale, deleteSelected, scaledAbout, deleteVertices, duplicateSelection, elementsInBox, pickElement, fillSelection, walkStep, MAX_PITCH, OrbitCamera, orbitAt, panOrbit, pickVertex, rotated, rotatedAroundAxis, toCamera, translated,
  translatedAlongAxis, verticesInBox, wireframeEdges,
} from './editing';
import { applyMatrix, viewMatrix } from '../../../lib/vrender/matrix';
import { Camera, Vec3 } from '../../../lib/vrender/model';
import { cubeMesh, MeshData, planeMesh, vertexMesh } from './primitives';
import { projectPoint } from '../../../lib/vrender/project';

// Looks along +z with +y toward the bottom of the image, which keeps these point layouts easy to read.
const FRONT: Camera = { position: { x: 0, y: 0, z: -100 }, rotation: { x: Math.PI / 2, y: 0, z: 0 }, focalLength: 100 };

function points(...coordinates: [number, number][]): Vec3[] {
  return coordinates.map(([x, y]) => ({ x, y, z: 0 }));
}

function meshOf(vertices: Vec3[]): MeshData {
  return { vertices, faces: [], edges: [] };
}

describe('orbit camera', () => {
  const orbit: OrbitCamera = { target: { x: 10, y: 20, z: 30 }, yaw: 0.7, pitch: -0.4, distance: 500, focalLength: 800 };

  it('keeps its target at the center of the image from any angle', () => {
    const seen = projectPoint(toCamera(orbit), orbit.target);
    expect(seen?.x).toBeCloseTo(0);
    expect(seen?.y).toBeCloseTo(0);
  });

  it('stands above the target at negative pitch, since z points up', () => {
    expect(toCamera(orbit).position.z).toBeGreaterThan(orbit.target.z);
  });

  it('faces +y at zero yaw and turns left with positive yaw', () => {
    const level = { ...orbit, target: { x: 0, y: 0, z: 0 }, pitch: 0 };
    const facing = toCamera({ ...level, yaw: 0 }).position;
    expect(facing.y).toBeCloseTo(-500);
    expect(facing.x).toBeCloseTo(0);
    expect(toCamera({ ...level, yaw: 0.5 }).position.x).toBeGreaterThan(0);
  });

  it('moves the image by the amount panned', () => {
    const moved = projectPoint(toCamera(panOrbit(orbit, 30, -10)), orbit.target);
    expect(moved?.x).toBeCloseTo(30);
    expect(moved?.y).toBeCloseTo(-10);
  });
});

describe('walk navigation', () => {
  const orbit: OrbitCamera = { target: { x: 10, y: 20, z: 30 }, yaw: 0.7, pitch: -0.4, distance: 500, focalLength: 800 };
  const near = (a: Vec3, b: Vec3) => {
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
    expect(a.z).toBeCloseTo(b.z);
  };

  it('turns in place, keeping the viewer where they are', () => {
    near(toCamera(walkStep(orbit, 0.5, 0.2, 0, 0, 0)).position, toCamera(orbit).position);
  });

  it('moves forward along the view direction', () => {
    const before = toCamera(orbit);
    const after = toCamera(walkStep(orbit, 0, 0, 0, 0, 100)).position;
    const straight = { x: 0, y: 0, z: 0 };
    // The point 100 ahead appears dead center, and the target has come 100 closer.
    expect(Math.hypot(after.x - before.position.x, after.y - before.position.y, after.z - before.position.z)).toBeCloseTo(100);
    const ahead = projectPoint(before, after);
    near({ ...straight, ...ahead }, straight);
  });

  it('moves up and right as seen on screen', () => {
    const after = toCamera(walkStep(orbit, 0, 0, 30, 0, 0)).position;
    const seen = applyMatrix(viewMatrix(toCamera(orbit)), after.x, after.y, after.z);
    near(seen, { x: 30, y: 0, z: 0 });
    const raised = toCamera(walkStep({ ...orbit, yaw: 0, pitch: 0 }, 0, 0, 0, 30, 0)).position;
    expect(raised.z).toBeCloseTo(toCamera({ ...orbit, yaw: 0, pitch: 0 }).position.z + 30);
  });

  it('limits pitch', () => {
    expect(walkStep(orbit, 0, 100, 0, 0, 0).pitch).toBe(MAX_PITCH);
    expect(walkStep(orbit, 0, -100, 0, 0, 0).pitch).toBe(-MAX_PITCH);
  });

  it('starts from a camera without moving it', () => {
    const position = { x: 5, y: -6, z: 7 };
    const rotation = { x: -0.3, y: 0, z: 1.2 };
    const camera = toCamera(orbitAt(position, rotation, 800, 100));
    near(camera.position, position);
    near(camera.rotation, rotation);
  });
});

describe('selection', () => {
  const mesh = meshOf(points([0, 0], [10, 0], [30, 30]));

  it('picks the nearest vertex within the radius', () => {
    expect(pickVertex(mesh, FRONT, { x: 8, y: 1 }, 5)).toBe(1);
    expect(pickVertex(mesh, FRONT, { x: 50, y: 50 }, 5)).toBeNull();
  });

  it('finds vertices in a box dragged in any direction', () => {
    expect(verticesInBox(mesh, FRONT, { x: 15, y: 5 }, { x: -5, y: -5 })).toEqual(new Set([0, 1]));
  });

  it('ignores vertices behind the camera', () => {
    const behind = meshOf([{ x: 0, y: 0, z: -300 }]);
    expect(pickVertex(behind, FRONT, { x: 0, y: 0 }, 1000)).toBeNull();
    expect(verticesInBox(behind, FRONT, { x: -1000, y: -1000 }, { x: 1000, y: 1000 }).size).toBe(0);
  });
});

describe('transformations', () => {
  const vertices = points([10, 0], [-10, 0], [50, 50]);
  const selection = new Set([0, 1]);

  it('moves only the selection, leaving the original array untouched', () => {
    const moved = translated(vertices, selection, FRONT, 5, -5);
    expect(moved[0].x).toBeCloseTo(15);
    expect(moved[1].y).toBeCloseTo(-5);
    expect(moved[2]).toBe(vertices[2]);
    expect(vertices[0].x).toBe(10);
  });

  it('makes a moved vertex follow the cursor at its depth', () => {
    const far = [{ x: 0, y: 0, z: 100 }];
    const moved = translated(far, new Set([0]), FRONT, 20, 0);
    expect(projectPoint(FRONT, moved[0])?.x).toBeCloseTo(20);
  });

  it('rotates clockwise on screen about the selection center', () => {
    const turned = rotated(vertices, selection, FRONT, Math.PI / 2);
    expect(turned[0].x).toBeCloseTo(0);
    expect(turned[0].y).toBeCloseTo(10);
    expect(turned[1].y).toBeCloseTo(-10);
    expect(turned[2]).toBe(vertices[2]);
  });

  it('keeps edits parallel to the screen with a turned camera', () => {
    const orbit = toCamera({ target: { x: 0, y: 0, z: 0 }, yaw: 0.8, pitch: -0.5, distance: 200, focalLength: 200 });
    const moved = translated([{ x: 0, y: 0, z: 0 }], new Set([0]), orbit, 30, 10);
    const seen = projectPoint(orbit, moved[0]);
    expect(seen?.x).toBeCloseTo(30);
    expect(seen?.y).toBeCloseTo(10);
  });
});

describe('axis-locked transformations', () => {
  const orbit = toCamera({ target: { x: 0, y: 0, z: 0 }, yaw: 0.8, pitch: -0.5, distance: 400, focalLength: 400 });

  it('moves along only the chosen axis, leaving other vertices alone', () => {
    const vertices = [{ x: 1, y: 2, z: 3 }, { x: 9, y: 9, z: 9 }];
    const moved = translatedAlongAxis(vertices, new Set([0]), orbit, 'x', 40, 0);
    expect(moved[0].x).not.toBeCloseTo(1);
    expect(moved[0].y).toBe(2);
    expect(moved[0].z).toBe(3);
    expect(moved[1]).toBe(vertices[1]);
  });

  it('keeps the vertex under the cursor when the cursor moves along the axis image', () => {
    const start = { x: 0, y: 0, z: 0 };
    const along = projectPoint(orbit, { x: 100, y: 0, z: 0 })!;
    const moved = translatedAlongAxis([start], new Set([0]), orbit, 'x', along.x, along.y);
    expect(moved[0].x).toBeCloseTo(100);
  });

  it('does nothing when the axis points straight at the camera', () => {
    const moved = translatedAlongAxis([{ x: 0, y: 0, z: 0 }], new Set([0]), FRONT, 'z', 30, 30);
    expect(moved[0]).toEqual({ x: 0, y: 0, z: 0 });
    // The same axis, seen off-center, has an image to follow.
    const offCenter = translatedAlongAxis([{ x: 80, y: 0, z: 0 }], new Set([0]), FRONT, 'z', -10, 0);
    expect(offCenter[0].z).not.toBe(0);
  });

  it('rotates about a global axis through the selection center, preserving the axis coordinate', () => {
    const vertices = [{ x: 5, y: 10, z: 0 }, { x: 5, y: -10, z: 0 }];
    const turned = rotatedAroundAxis(vertices, new Set([0, 1]), FRONT, 'x', Math.PI / 2);
    expect(turned[0].x).toBeCloseTo(5);
    expect(turned[0].y).toBeCloseTo(0);
    expect(Math.abs(turned[0].z)).toBeCloseTo(10);
  });

  it('turns the way the cursor circles, whichever way the axis faces', () => {
    const vertices = [{ x: 10, y: 0, z: 0 }, { x: -10, y: 0, z: 0 }];
    const toward = { ...FRONT, position: { x: 0, y: 0, z: 100 }, rotation: { x: -Math.PI / 2, y: 0, z: 0 } };
    for (const camera of [FRONT, toward]) {
      const [turned] = rotatedAroundAxis(vertices, new Set([0, 1]), camera, 'z', 0.5);
      const before = projectPoint(camera, vertices[0])!;
      const after = projectPoint(camera, turned)!;
      // Clockwise on screen, with y down, is a positive cross product.
      expect(before.x * after.y - before.y * after.x).toBeGreaterThan(0);
    }
  });
});

describe('scaling', () => {
  const vertices = points([10, 0], [-10, 0], [50, 50]);
  const selection = new Set([0, 1]);

  it('scales about the selection center, leaving others alone', () => {
    const scaled = scaledAbout(vertices, selection, 3, null);
    expect(scaled[0].x).toBe(30);
    expect(scaled[1].x).toBe(-30);
    expect(scaled[2]).toBe(vertices[2]);
  });

  it('scales along one global axis only', () => {
    const tall = [{ x: 4, y: 4, z: 4 }, { x: -4, y: -4, z: -4 }];
    expect(scaledAbout(tall, new Set([0, 1]), 2, 'y')[0]).toEqual({ x: 4, y: 8, z: 4 });
  });

  it('reads the factor from the cursor distance to the pivot, staying positive', () => {
    const pivot = { x: 0, y: 0 };
    expect(cursorScale({ x: 100, y: 0 }, { x: 0, y: 200 }, pivot)).toBe(2);
    expect(cursorScale({ x: 100, y: 0 }, pivot, pivot)).toBeGreaterThan(0);
    expect(cursorScale(pivot, { x: 50, y: 0 }, pivot)).toBe(1);
  });
});

describe('proportional editing', () => {
  const line = points([0, 0], [50, 0], [100, 0], [300, 0]);

  it('weighs selected vertices fully and fades others smoothly to nothing at the radius', () => {
    const weights = proportionalWeights(line, new Set([0]), 100);
    expect(weights[0]).toBe(1);
    expect(weights[1]).toBeCloseTo(0.5);
    expect(weights[2]).toBe(0);
    expect(weights[3]).toBe(0);
  });

  it('measures from the nearest selected vertex', () => {
    expect(proportionalWeights(line, new Set([0, 2]), 100)[1]).toBeCloseTo(0.5);
    expect(proportionalWeights(line, new Set([0, 3]), 500)[2]).toBeGreaterThan(proportionalWeights(line, new Set([3]), 500)[2]);
  });

  it('blends partway, keeping the pivot on the selection', () => {
    const everyone = new Set([0, 1, 2, 3]);
    const scaled = scaledAbout(line, new Set([0]), 2, null, everyone);
    expect(scaled[0].x).toBe(0);
    expect(scaled[1].x).toBe(100);
    const blended = blendPoints(line, scaled, proportionalWeights(line, new Set([0]), 100));
    expect(blended[1].x).toBeCloseTo(75);
    expect(blended[3]).toBe(line[3]);
  });

  it('moves and rotates affected vertices about the selection only', () => {
    const everyone = new Set([0, 1, 2, 3]);
    expect(translated(line, new Set([0]), FRONT, 10, 0, everyone)[1].x).toBeCloseTo(60);
    const turned = rotated(line, new Set([0]), FRONT, Math.PI / 2, everyone);
    expect(turned[1].x).toBeCloseTo(0);
    expect(turned[1].y).toBeCloseTo(50);
    expect(translatedAlongAxis(line, new Set([0]), FRONT, 'x', 10, 0, everyone)[1].x).toBeCloseTo(60);
    expect(rotatedAroundAxis(line, new Set([0]), FRONT, 'z', Math.PI / 2, everyone)[1].y).toBeCloseTo(50);
  });
});

describe('fillSelection', () => {
  const square = meshOf(points([0, 0], [10, 10], [10, 0], [0, 10]));

  it('refuses fewer than two vertices', () => {
    expect(fillSelection(square, new Set([0]), FRONT).mesh).toBe(square);
  });

  it('makes a line from two vertices, once', () => {
    const { mesh } = fillSelection(square, new Set([0, 1]), FRONT);
    expect(mesh.edges).toEqual([[0, 1]]);
    expect(fillSelection(mesh, new Set([1, 0]), FRONT).mesh).toBe(mesh);
  });

  it('makes one triangle from three vertices, once', () => {
    const { mesh } = fillSelection(square, new Set([0, 1, 2]), FRONT);
    expect(mesh.faces).toHaveLength(1);
    expect(fillSelection(mesh, new Set([2, 1, 0]), FRONT).mesh).toBe(mesh);
  });

  it('orders four vertices around the outline, so the triangles cover the square exactly', () => {
    // Selected in crossing order: 0 and 1 are opposite corners.
    const { mesh } = fillSelection(square, new Set([0, 1, 2, 3]), FRONT);
    expect(mesh.faces).toHaveLength(2);
    const area = mesh.faces.reduce((sum, [a, b, c]) => {
      const [p, q, r] = [square.vertices[a], square.vertices[b], square.vertices[c]];
      return sum + Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
    }, 0);
    expect(area).toBeCloseTo(100);
  });
});

describe('select modes', () => {
  // Two triangles sharing the line between vertices 1 and 2, with one loose line.
  const mesh: MeshData = {
    vertices: [...points([0, 0], [40, 0], [0, 40], [40, 40]), { x: 90, y: 0, z: 0 }, { x: 90, y: 40, z: 0 }],
    faces: [[0, 1, 2], [1, 3, 2]],
    edges: [[4, 5]],
  };

  it('picks a vertex, a line, or a face', () => {
    expect(pickElement(mesh, FRONT, { x: 1, y: 1 }, 5, 'vertex')).toEqual([0]);
    expect(pickElement(mesh, FRONT, { x: 20, y: 1 }, 5, 'line')?.slice().sort()).toEqual([0, 1]);
    expect(pickElement(mesh, FRONT, { x: 91, y: 20 }, 5, 'line')).toEqual([4, 5]);
    expect(pickElement(mesh, FRONT, { x: 10, y: 10 }, 5, 'face')).toEqual([0, 1, 2]);
    expect(pickElement(mesh, FRONT, { x: 30, y: 30 }, 5, 'face')).toEqual([1, 3, 2]);
    expect(pickElement(mesh, FRONT, { x: 70, y: 20 }, 5, 'face')).toBeNull();
    expect(pickElement(mesh, FRONT, { x: 70, y: 20 }, 5, 'line')).toBeNull();
  });

  it('picks the nearer of two overlapping faces', () => {
    const stacked: MeshData = {
      vertices: [
        { x: 0, y: 0, z: 50 }, { x: 40, y: 0, z: 50 }, { x: 0, y: 40, z: 50 },
        { x: 0, y: 0, z: -50 }, { x: 40, y: 0, z: -50 }, { x: 0, y: 40, z: -50 },
      ],
      faces: [[0, 1, 2], [3, 4, 5]],
      edges: [],
    };
    expect(pickElement(stacked, FRONT, { x: 5, y: 5 }, 5, 'face')).toEqual([3, 4, 5]);
  });

  it('box selects only whole lines or faces', () => {
    const [a, b] = [{ x: -5, y: -5 }, { x: 45, y: 5 }];
    expect(elementsInBox(mesh, FRONT, a, b, 'vertex')).toEqual(new Set([0, 1]));
    expect(elementsInBox(mesh, FRONT, a, b, 'line')).toEqual(new Set([0, 1]));
    expect(elementsInBox(mesh, FRONT, a, b, 'face')).toEqual(new Set());
    expect(elementsInBox(mesh, FRONT, { x: -5, y: -5 }, { x: 45, y: 45 }, 'face')).toEqual(new Set([0, 1, 2, 3]));
  });

  it('deleting a face keeps vertices still in use', () => {
    const { mesh: left, kept } = deleteSelected(mesh, new Set([0, 1, 2]), 'face');
    expect(left.faces).toEqual([[0, 2, 1]]);
    expect(kept).toEqual([1, 2, 3, 4, 5]);
    expect(left.edges).toEqual([[3, 4]]);
  });

  it('deleting a line removes the faces it borders, and only then its vertices', () => {
    const { mesh: left, kept } = deleteSelected(mesh, new Set([1, 2]), 'line');
    expect(left.faces).toEqual([]);
    expect(kept).toEqual([0, 3, 4, 5]);
    expect(deleteSelected(mesh, new Set([4, 5]), 'line').mesh.edges).toEqual([]);
    expect(deleteSelected(mesh, new Set([4, 5]), 'line').mesh.faces).toHaveLength(2);
  });

  it('deleting vertices removes everything using them', () => {
    expect(deleteSelected(mesh, new Set([1]), 'vertex').mesh.faces).toEqual([]);
  });
});

describe('occlusion', () => {
  const mesh = meshOf(points([0, 0], [20, 0]));
  const hidesFirst = ({ x }: Vec3) => x === 0;

  it('keeps hidden vertices from being picked or boxed', () => {
    expect(pickElement(mesh, FRONT, { x: 1, y: 0 }, 5, 'vertex')).toEqual([0]);
    expect(pickElement(mesh, FRONT, { x: 1, y: 0 }, 5, 'vertex', hidesFirst)).toBeNull();
    expect(elementsInBox(mesh, FRONT, { x: -5, y: -5 }, { x: 25, y: 5 }, 'vertex', hidesFirst)).toEqual(new Set([1]));
  });

  it('keeps a line with a hidden middle from being picked, and from a box without both ends', () => {
    const line: MeshData = { ...mesh, edges: [[0, 1]] };
    expect(pickElement(line, FRONT, { x: 10, y: 0 }, 5, 'line', ({ x }) => x === 10)).toBeNull();
    expect(elementsInBox(line, FRONT, { x: -5, y: -5 }, { x: 25, y: 5 }, 'line', hidesFirst)).toEqual(new Set());
  });
});

describe('deleteVertices', () => {
  const square: MeshData = { ...meshOf(points([0, 0], [1, 0], [1, 1], [0, 1])), faces: [[0, 1, 2], [0, 2, 3]], edges: [[1, 3]] };

  it('removes faces and lines touching a deleted vertex and renumbers the rest', () => {
    const { mesh, kept } = deleteVertices(square, new Set([1]));
    expect(mesh.vertices).toHaveLength(3);
    expect(kept).toEqual([0, 2, 3]);
    expect(mesh.faces).toEqual([[0, 1, 2]]);
    expect(mesh.edges).toEqual([]);
  });

  it('can delete everything', () => {
    const { mesh } = deleteVertices(square, new Set([0, 1, 2, 3]));
    expect(mesh).toEqual({ vertices: [], faces: [], edges: [] });
  });
});

describe('duplicateSelection', () => {
  it('copies a fully selected cube with all its faces', () => {
    const cube = cubeMesh(1);
    const { mesh, copies, copiedFrom } = duplicateSelection(cube, new Set(cube.vertices.map((_, i) => i)));
    expect(mesh.vertices).toHaveLength(16);
    expect(mesh.faces).toHaveLength(24);
    expect(copies).toEqual(new Set([8, 9, 10, 11, 12, 13, 14, 15]));
    expect(copiedFrom).toHaveLength(8);
    expect(mesh.faces[12]).toEqual(cube.faces[0].map(i => i + 8));
  });

  it('turns a partly selected face into a line, and excludes outside vertices', () => {
    const triangle: MeshData = { ...meshOf(points([0, 0], [1, 0], [0, 1])), faces: [[0, 1, 2]] };
    const { mesh } = duplicateSelection(triangle, new Set([0, 1]));
    expect(mesh.faces).toHaveLength(1);
    expect(mesh.edges).toEqual([[3, 4]]);
  });

  it('copies a line once even when it is also a face side', () => {
    const triangle: MeshData = { ...meshOf(points([0, 0], [1, 0], [0, 1])), faces: [[0, 1, 2]], edges: [[1, 0]] };
    const { mesh } = duplicateSelection(triangle, new Set([0, 1]));
    expect(mesh.edges).toHaveLength(2);
  });

  it('leaves the original selection data alone', () => {
    const cube = cubeMesh(1);
    const selection = new Set([0]);
    const { mesh } = duplicateSelection(cube, selection);
    expect(mesh.vertices[8]).toBe(cube.vertices[0]);
    expect(selection).toEqual(new Set([0]));
    expect(cube.vertices).toHaveLength(8);
  });
});

describe('mesh data', () => {
  it('offsets appended indices and reports the new vertices', () => {
    const { mesh, addedVertices } = appendMesh(vertexMesh(), planeMesh(1));
    expect(mesh.vertices).toHaveLength(5);
    expect(mesh.faces[0]).toEqual([1, 2, 3]);
    expect(addedVertices).toEqual(new Set([1, 2, 3, 4]));
  });

  it('lists each cube wire once: 12 sides and 6 diagonals', () => {
    expect(wireframeEdges(cubeMesh(1))).toHaveLength(18);
  });
});
