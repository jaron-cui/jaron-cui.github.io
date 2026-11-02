import { applyMatrix, invertMatrix, viewMatrix } from './matrix';
import { Camera, Edge, Face, Vec2, Vec3 } from './model';
import { MeshData } from './primitives';
import { projectPoint } from './project';

// Vertex indices.
export type Selection = Set<number>;

export type Axis = 'x' | 'y' | 'z';

// What a transformation is locked to: a global axis, or any other direction as a unit vector, such
// as an object's local axis or a face's normal.
export type AxisLock = Axis | Vec3;

// Whether a world point is hidden behind something. Left out, nothing is, as with X-Ray on.
export type Occlusion = (point: Vec3) => boolean;

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

// What clicks and boxes choose in edit mode. The selection itself is always vertices: choosing a
// line or face selects its vertices, and a line or face counts as selected when all of its are.
export type SelectMode = 'vertex' | 'line' | 'face';

// Orbits a target point, unlike a scene Camera, which only records where it stands and faces.
export type OrbitCamera = { target: Vec3; yaw: number; pitch: number; distance: number; focalLength: number };

export const MAX_PITCH = 1.55;

// Yaw turns left about world up from facing +y, and pitch tilts up from level.
function forwardOf(yaw: number, pitch: number): Vec3 {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.cos(yaw) * Math.cos(pitch),
    z: Math.sin(pitch),
  };
}

export function toCamera({ target, yaw, pitch, distance, focalLength }: OrbitCamera): Camera {
  const forward = forwardOf(yaw, pitch);
  return {
    position: {
      x: target.x - forward.x * distance,
      y: target.y - forward.y * distance,
      z: target.z - forward.z * distance,
    },
    rotation: { x: pitch, y: 0, z: yaw },
    focalLength,
  };
}

// Maps view space, whose axes follow the image, back to the world.
function viewToWorld(camera: Camera) {
  return invertMatrix(viewMatrix(camera));
}

// Moves the target with the image, by a distance given in image space at the target's depth.
export function panOrbit(orbit: OrbitCamera, dx: number, dy: number): OrbitCamera {
  const camera = toCamera(orbit);
  const scale = orbit.distance / orbit.focalLength;
  const target = applyMatrix(viewToWorld(camera), -dx * scale, -dy * scale, orbit.distance);
  return { ...orbit, target };
}

// One step of walk navigation: turns in place, then moves along the view's own axes. Unlike
// orbiting, the viewer stays put while turning and the target swings around them.
export function walkStep(
  orbit: OrbitCamera, turnYaw: number, turnPitch: number, right: number, up: number, forward: number
): OrbitCamera {
  const moved = applyMatrix(viewToWorld(toCamera(orbit)), right, -up, forward);
  const yaw = orbit.yaw + turnYaw;
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, orbit.pitch + turnPitch));
  const facing = forwardOf(yaw, pitch);
  return {
    ...orbit,
    yaw,
    pitch,
    target: {
      x: moved.x + facing.x * orbit.distance,
      y: moved.y + facing.y * orbit.distance,
      z: moved.z + facing.z * orbit.distance,
    },
  };
}

// An orbit that sees what a camera at this position and rotation sees, ignoring roll.
export function orbitAt(position: Vec3, rotation: Vec3, focalLength: number, distance: number): OrbitCamera {
  const facing = forwardOf(rotation.z, rotation.x);
  return {
    target: {
      x: position.x + facing.x * distance,
      y: position.y + facing.y * distance,
      z: position.z + facing.z * distance,
    },
    yaw: rotation.z,
    pitch: rotation.x,
    distance,
    focalLength,
  };
}

// Appends a mesh and returns the combined mesh and the indices of the new vertices.
export function appendMesh(mesh: MeshData, added: MeshData): { mesh: MeshData; addedVertices: Selection } {
  const offset = mesh.vertices.length;
  return {
    mesh: {
      vertices: [...mesh.vertices, ...added.vertices],
      faces: [...mesh.faces, ...added.faces.map(([a, b, c]): Face => [a + offset, b + offset, c + offset])],
      edges: [...mesh.edges, ...added.edges.map(([a, b]): Edge => [a + offset, b + offset])],
    },
    addedVertices: new Set(added.vertices.map((_, i) => i + offset)),
  };
}

// Removes vertices, along with every face and line that uses one. kept lists the surviving
// vertices' old indices, in their new order.
export function deleteVertices(mesh: MeshData, selection: Selection): { mesh: MeshData; kept: number[] } {
  const kept = mesh.vertices.map((_, i) => i).filter(i => !selection.has(i));
  const newIndex = new Map(kept.map((oldIndex, i) => [oldIndex, i]));
  const survives = (indices: number[]) => indices.every(i => newIndex.has(i));
  return {
    kept,
    mesh: {
      vertices: kept.map(i => mesh.vertices[i]),
      faces: mesh.faces.filter(survives).map(([a, b, c]): Face => [newIndex.get(a)!, newIndex.get(b)!, newIndex.get(c)!]),
      edges: mesh.edges.filter(survives).map(([a, b]): Edge => [newIndex.get(a)!, newIndex.get(b)!]),
    },
  };
}

// Removes what the select mode chose. Deleting vertices removes everything using them. Deleting
// lines or faces leaves their vertices where anything else still uses them.
export function deleteSelected(mesh: MeshData, selection: Selection, mode: SelectMode): { mesh: MeshData; kept: number[] } {
  if (mode === 'vertex') {
    return deleteVertices(mesh, selection);
  }
  const isSelected = (a: number, b: number) => selection.has(a) && selection.has(b);
  const faces = mesh.faces.filter(([a, b, c]) => (
    mode === 'face'
      ? !(selection.has(a) && isSelected(b, c))
      : !(isSelected(a, b) || isSelected(b, c) || isSelected(c, a))
  ));
  const edges = mode === 'line' ? mesh.edges.filter(([a, b]) => !isSelected(a, b)) : mesh.edges;
  const used = new Set([...faces.flat(), ...edges.flat()]);
  const orphans = new Set(Array.from(selection).filter(i => !used.has(i)));
  return deleteVertices({ vertices: mesh.vertices, faces, edges }, orphans);
}

// Copies the selected vertices with the faces and lines among them. A face with only two selected
// vertices contributes the line between them. The copies are appended in selection order, and
// copiedFrom lists each one's source.
export function duplicateSelection(mesh: MeshData, selection: Selection): { mesh: MeshData; copiedFrom: number[]; copies: Selection } {
  const copiedFrom = Array.from(selection);
  const copyOf = new Map(copiedFrom.map((source, i) => [source, mesh.vertices.length + i]));
  const faces: Face[] = [];
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();
  const addEdge = (a: number, b: number) => {
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      edges.push([copyOf.get(a)!, copyOf.get(b)!]);
    }
  };

  mesh.edges.forEach(([a, b]) => {
    if (selection.has(a) && selection.has(b)) {
      addEdge(a, b);
    }
  });
  mesh.faces.forEach(face => {
    const selected = face.filter(index => selection.has(index));
    if (selected.length === 3) {
      faces.push([copyOf.get(face[0])!, copyOf.get(face[1])!, copyOf.get(face[2])!]);
    } else if (selected.length === 2) {
      addEdge(selected[0], selected[1]);
    }
  });

  return {
    mesh: {
      vertices: [...mesh.vertices, ...copiedFrom.map(source => mesh.vertices[source])],
      faces: [...mesh.faces, ...faces],
      edges: [...mesh.edges, ...edges],
    },
    copiedFrom,
    copies: new Set(Array.from(copyOf.values())),
  };
}

// The vertex drawn nearest a point in image space, within a radius.
export function pickVertex(mesh: MeshData, camera: Camera, point: Vec2, radius: number, occluded?: Occlusion): number | null {
  let best: number | null = null;
  let bestDistance = radius;
  mesh.vertices.forEach((vertex, i) => {
    const projected = projectPoint(camera, vertex);
    if (projected && !occluded?.(vertex)) {
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (distance <= bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
  });
  return best;
}

function nearestLine(mesh: MeshData, camera: Camera, point: Vec2, radius: number, occluded?: Occlusion): Edge | null {
  let best: Edge | null = null;
  let bestDistance = radius;
  for (const edge of wireframeEdges(mesh)) {
    const a = projectPoint(camera, mesh.vertices[edge[0]]);
    const b = projectPoint(camera, mesh.vertices[edge[1]]);
    if (a && b && !occluded?.(midpoint(mesh.vertices[edge[0]], mesh.vertices[edge[1]]))) {
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const lengthSquared = dx * dx + dy * dy;
      const s = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
      const distance = Math.hypot(point.x - a.x - s * dx, point.y - a.y - s * dy);
      if (distance <= bestDistance) {
        best = edge;
        bestDistance = distance;
      }
    }
  }
  return best;
}

// The triangle nearest the camera that is drawn over a point.
function nearestFace(mesh: MeshData, camera: Camera, point: Vec2): Face | null {
  let best: Face | null = null;
  let bestDistance = Infinity;
  for (const face of mesh.faces) {
    const [a, b, c] = face.map(i => projectPoint(camera, mesh.vertices[i]));
    if (a && b && c) {
      const side = (u: Vec2, v: Vec2) => (v.x - u.x) * (point.y - u.y) - (v.y - u.y) * (point.x - u.x);
      const [ab, bc, ca] = [side(a, b), side(b, c), side(c, a)];
      if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) {
        const distance = face.reduce((sum, i) => {
          const v = mesh.vertices[i];
          return sum + Math.hypot(v.x - camera.position.x, v.y - camera.position.y, v.z - camera.position.z);
        }, 0);
        if (distance < bestDistance) {
          best = face;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

// The vertices of the vertex, line, or face under a point, or null if there is none.
export function pickElement(
  mesh: MeshData, camera: Camera, point: Vec2, radius: number, mode: SelectMode, occluded?: Occlusion
): number[] | null {
  if (mode === 'line') {
    return nearestLine(mesh, camera, point, radius, occluded);
  }
  if (mode === 'face') {
    return nearestFace(mesh, camera, point);
  }
  const vertex = pickVertex(mesh, camera, point, radius, occluded);
  return vertex === null ? null : [vertex];
}

// The vertices of every vertex, line, or face wholly inside a box.
export function elementsInBox(mesh: MeshData, camera: Camera, a: Vec2, b: Vec2, mode: SelectMode, occluded?: Occlusion): Selection {
  const inside = verticesInBox(mesh, camera, a, b, occluded);
  if (mode === 'vertex') {
    return inside;
  }
  const elements: number[][] = mode === 'line' ? wireframeEdges(mesh) : mesh.faces;
  const chosen = new Set<number>();
  for (const element of elements) {
    if (element.every(i => inside.has(i))) {
      element.forEach(i => chosen.add(i));
    }
  }
  return chosen;
}

export function verticesInBox(mesh: MeshData, camera: Camera, a: Vec2, b: Vec2, occluded?: Occlusion): Selection {
  const [minX, maxX] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [minY, maxY] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const inside = new Set<number>();
  mesh.vertices.forEach((vertex, i) => {
    const p = projectPoint(camera, vertex);
    if (p && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY && !occluded?.(vertex)) {
      inside.add(i);
    }
  });
  return inside;
}

// What rotating and scaling happen about.
export type PivotMode = 'median' | 'cursor';

export function selectionCenter(vertices: Vec3[], selection: Selection): Vec3 {
  const center = { x: 0, y: 0, z: 0 };
  selection.forEach(i => {
    center.x += vertices[i].x;
    center.y += vertices[i].y;
    center.z += vertices[i].z;
  });
  return { x: center.x / selection.size, y: center.y / selection.size, z: center.z / selection.size };
}

// Where a transformation pivots, in image space. Null if there is no selection, or it is behind
// the camera.
export function selectionPivot(vertices: Vec3[], selection: Selection, camera: Camera): Vec2 | null {
  return selection.size === 0 ? null : projectPoint(camera, selectionCenter(vertices, selection));
}

// Applies a change made in camera space to the selected vertices, leaving the input untouched.
function editInCameraSpace(
  vertices: Vec3[], selection: Selection, camera: Camera, edit: (point: Vec3, pivot: Vec3) => Vec3, affected: Selection, c: Vec3 = selectionCenter(vertices, selection)
): Vec3[] {
  const toView = viewMatrix(camera);
  const toWorld = viewToWorld(camera);
  const pivot = applyMatrix(toView, c.x, c.y, c.z);
  return vertices.map((vertex, i) => {
    if (!affected.has(i)) {
      return vertex;
    }
    const edited = edit(applyMatrix(toView, vertex.x, vertex.y, vertex.z), pivot);
    return applyMatrix(toWorld, edited.x, edited.y, edited.z);
  });
}

// Moves the selection parallel to the screen, so it follows a cursor moved by (dx, dy) in image space.
export function translated(vertices: Vec3[], selection: Selection, camera: Camera, dx: number, dy: number, affected: Selection = selection): Vec3[] {
  return editInCameraSpace(vertices, selection, camera, (point, pivot) => {
    const scale = pivot.z / camera.focalLength;
    return { x: point.x + dx * scale, y: point.y + dy * scale, z: point.z };
  }, affected);
}

// Moves by a world offset.
export function translatedBy(vertices: Vec3[], affected: Selection, offset: Vec3): Vec3[] {
  return vertices.map((vertex, i) => (affected.has(i)
    ? { x: vertex.x + offset.x, y: vertex.y + offset.y, z: vertex.z + offset.z }
    : vertex));
}

// Turns the selection about its center, or a given one, around the axis pointing into the screen.
// With y down, a positive angle is clockwise on screen.
export function rotated(vertices: Vec3[], selection: Selection, camera: Camera, angle: number, affected: Selection = selection, center?: Vec3): Vec3[] {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return editInCameraSpace(vertices, selection, camera, (point, pivot) => {
    const [x, y] = [point.x - pivot.x, point.y - pivot.y];
    return { x: pivot.x + x * cos - y * sin, y: pivot.y + x * sin + y * cos, z: point.z };
  }, affected, center);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

const MIN_AXIS_IMAGE_RATE = 0.03;
const MIN_CURSOR_SCALE = 0.001;

export const AXIS_VECTORS: Record<Axis, Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

export function lockVector(lock: AxisLock): Vec3 {
  return typeof lock === 'string' ? AXIS_VECTORS[lock] : lock;
}

// Moves the selection along an axis, by as far as keeps its center nearest the cursor's
// line of sight. The cursor has moved by (dx, dy) in image space from the center's image.
// Does nothing while the axis points almost straight at the camera, where no such point is stable.
export function translatedAlongAxis(
  vertices: Vec3[], selection: Selection, camera: Camera, axis: AxisLock, dx: number, dy: number, affected: Selection = selection
): Vec3[] {
  const toView = viewMatrix(camera);
  const c = selectionCenter(vertices, selection);
  const center = applyMatrix(toView, c.x, c.y, c.z);
  const world = lockVector(axis);
  const direction = applyMatrix(toView, c.x + world.x, c.y + world.y, c.z + world.z);
  const line = { x: direction.x - center.x, y: direction.y - center.y, z: direction.z - center.z };
  const scale = center.z / camera.focalLength;
  const ray = { x: center.x + dx * scale, y: center.y + dy * scale, z: center.z };

  const b = dot(line, ray);
  const c2 = dot(ray, ray);
  const d = dot(line, center);
  const e = dot(ray, center);
  const denominator = c2 - b * b;
  // How far the axis's image moves per unit along it, in units of distance over depth.
  const imageRate = Math.hypot(line.x - center.x * line.z / center.z, line.y - center.y * line.z / center.z);
  if (imageRate < MIN_AXIS_IMAGE_RATE || denominator / c2 < 1e-4) {
    return vertices;
  }
  const distance = (b * e - c2 * d) / denominator;
  return vertices.map((vertex, i) => (affected.has(i)
    ? { x: vertex.x + world.x * distance, y: vertex.y + world.y * distance, z: vertex.z + world.z * distance }
    : vertex));
}

// The world-space rotation for a cursor that has circled by an angle: about the locked axis if
// there is one, otherwise about the axis pointing into the screen.
export function worldRotation(camera: Camera, axis: AxisLock | null, angle: number): { axis: Vec3; angle: number } {
  const toWorld = viewToWorld(camera);
  const forward = { x: toWorld[2], y: toWorld[6], z: toWorld[10] };
  if (!axis) {
    return { axis: forward, angle };
  }
  const vector = lockVector(axis);
  return { axis: vector, angle: dot(vector, forward) < 0 ? -angle : angle };
}

// Turns the selection about an axis through its center, or a given one. The sign is chosen so the selection
// appears to turn the same way the cursor circles, whichever way the axis faces the camera.
export function rotatedAroundAxis(
  vertices: Vec3[], selection: Selection, camera: Camera, axis: AxisLock, angle: number, affected: Selection = selection, center?: Vec3
): Vec3[] {
  const { axis: a, angle: signed } = worldRotation(camera, axis, angle);
  const [cos, sin] = [Math.cos(signed), Math.sin(signed)];
  const c = center ?? selectionCenter(vertices, selection);
  return vertices.map((vertex, i) => {
    if (!affected.has(i)) {
      return vertex;
    }
    // Rodrigues' rotation formula.
    const v = { x: vertex.x - c.x, y: vertex.y - c.y, z: vertex.z - c.z };
    const cross = { x: a.y * v.z - a.z * v.y, y: a.z * v.x - a.x * v.z, z: a.x * v.y - a.y * v.x };
    const along = dot(a, v) * (1 - cos);
    return {
      x: c.x + v.x * cos + cross.x * sin + a.x * along,
      y: c.y + v.y * cos + cross.y * sin + a.y * along,
      z: c.z + v.z * cos + cross.z * sin + a.z * along,
    };
  });
}

// Scales the selection about its center, or a given one, uniformly or along an axis.
export function scaledAbout(vertices: Vec3[], selection: Selection, factor: number, axis: AxisLock | null, affected: Selection = selection, center?: Vec3): Vec3[] {
  const c = center ?? selectionCenter(vertices, selection);
  if (axis && typeof axis !== 'string') {
    return vertices.map((vertex, i) => {
      if (!affected.has(i)) {
        return vertex;
      }
      const along = ((vertex.x - c.x) * axis.x + (vertex.y - c.y) * axis.y + (vertex.z - c.z) * axis.z) * (factor - 1);
      return { x: vertex.x + axis.x * along, y: vertex.y + axis.y * along, z: vertex.z + axis.z * along };
    });
  }
  const along = (coordinate: Axis, value: number, center: number) => (
    !axis || axis === coordinate ? center + (value - center) * factor : value
  );
  return vertices.map((vertex, i) => (affected.has(i)
    ? { x: along('x', vertex.x, c.x), y: along('y', vertex.y, c.y), z: along('z', vertex.z, c.z) }
    : vertex));
}

// Proportional editing: how strongly each vertex follows the selection. Selected vertices follow
// fully, and others fade smoothly to nothing at the radius from the nearest selected vertex.
export function proportionalWeights(vertices: Vec3[], selection: Selection, radius: number): number[] {
  return falloffWeights(straightDistances(vertices, selection), radius);
}

// The smooth falloff at each distance from the selection.
export function falloffWeights(distances: number[], radius: number): number[] {
  return distances.map(distance => {
    const t = Math.max(0, 1 - distance / radius);
    return t * t * (3 - 2 * t);
  });
}

// How far each vertex is from the nearest selected one, in a straight line.
export function straightDistances(vertices: Vec3[], selection: Selection): number[] {
  const chosen = Array.from(selection).map(i => vertices[i]);
  return vertices.map((vertex, i) => (
    selection.has(i) ? 0 : Math.min(...chosen.map(other => Math.hypot(vertex.x - other.x, vertex.y - other.y, vertex.z - other.z)))
  ));
}

// Which vertices each vertex shares a line or face with.
export function vertexNeighbors(mesh: MeshData): number[][] {
  const neighbors: number[][] = mesh.vertices.map(() => []);
  wireframeEdges(mesh).forEach(([a, b]) => {
    neighbors[a].push(b);
    neighbors[b].push(a);
  });
  return neighbors;
}

// How far each vertex is from the nearest selected one, traveling along the mesh. Vertices not
// connected to the selection are infinitely far.
export function connectedDistances(mesh: MeshData, selection: Selection): number[] {
  const { vertices } = mesh;
  const neighbors = vertexNeighbors(mesh);
  const distances = vertices.map((_, i) => (selection.has(i) ? 0 : Infinity));
  const open = new Set(Array.from(selection));
  while (open.size > 0) {
    const current = Array.from(open).reduce((best, i) => (distances[i] < distances[best] ? i : best));
    open.delete(current);
    for (const next of neighbors[current]) {
      const [a, b] = [vertices[current], vertices[next]];
      const through = distances[current] + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (through < distances[next]) {
        distances[next] = through;
        open.add(next);
      }
    }
  }
  return distances;
}

// Moves each point the given fraction of the way from one position to another.
export function blendPoints(from: Vec3[], to: Vec3[], weights: number[]): Vec3[] {
  return from.map((point, i) => (weights[i] === 1 ? to[i] : weights[i] === 0 ? point : {
    x: point.x + (to[i].x - point.x) * weights[i],
    y: point.y + (to[i].y - point.y) * weights[i],
    z: point.z + (to[i].z - point.z) * weights[i],
  }));
}

// How much a cursor has scaled things, from how its distance to the pivot has changed. Never zero
// or negative, since scale must stay invertible.
export function cursorScale(start: Vec2, point: Vec2, pivot: Vec2): number {
  const from = Math.hypot(start.x - pivot.x, start.y - pivot.y);
  if (from < 1) {
    return 1;
  }
  return Math.max(MIN_CURSOR_SCALE, Math.hypot(point.x - pivot.x, point.y - pivot.y) / from);
}

// A line of sight through an image-space point, and where it crosses a plane facing the camera at
// the depth of a world point. A point behind the camera falls back to the focal distance.
export function viewRay(camera: Camera, point: Vec2, depthOf: Vec3): { direction: Vec3; onPlane: Vec3 } {
  const toWorld = viewToWorld(camera);
  const scale = 1 / camera.focalLength;
  const far = applyMatrix(toWorld, point.x * scale, point.y * scale, 1);
  const along = { x: far.x - camera.position.x, y: far.y - camera.position.y, z: far.z - camera.position.z };
  const length = Math.hypot(along.x, along.y, along.z);
  const seen = applyMatrix(viewMatrix(camera), depthOf.x, depthOf.y, depthOf.z).z;
  const depth = seen > 1 ? seen : camera.focalLength;
  return {
    direction: { x: along.x / length, y: along.y / length, z: along.z / length },
    onPlane: applyMatrix(toWorld, point.x * scale * depth, point.y * scale * depth, depth),
  };
}

function edgeKey(a: number, b: number, count: number): number {
  return Math.min(a, b) * count + Math.max(a, b);
}

function faceSides([a, b, c]: Face): Edge[] {
  return [[a, b], [b, c], [c, a]];
}

function isSelectedFace(face: Face, selection: Selection): boolean {
  return face.every(i => selection.has(i));
}

// How many of the given faces use each edge.
function sideCounts(faces: Face[], vertexCount: number): Map<number, number> {
  const counts = new Map<number, number>();
  faces.forEach(face => faceSides(face).forEach(([a, b]) => {
    const key = edgeKey(a, b, vertexCount);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }));
  return counts;
}

export type ExtrudeResult = { mesh: MeshData; copiedFrom: number[]; kept: number[]; selection: Selection };

// Extrudes what is selected, as Blender does, whatever the select mode:
// - Faces lift off as a region, with walls around its boundary only. A region bordered by unselected
//   faces leaves nothing behind. One bordered by nothing, like a lone plane, keeps its original as
//   the far side.
// - Lines not on a selected face grow a wall.
// - A vertex with no selected line touching it grows a line.
// The copies come after the mesh's vertices in the order of copiedFrom. kept then lists which of
// those survive, by index, in their new order, since vertices left unused are removed.
export function extrudeSelection(mesh: MeshData, selection: Selection): ExtrudeResult {
  const count = mesh.vertices.length;
  const copiedFrom = Array.from(selection);
  const copyOf = new Map(copiedFrom.map((source, i) => [source, count + i]));
  const region = mesh.faces.filter(face => isSelectedFace(face, selection));
  const regionCounts = sideCounts(region, count + copiedFrom.length);
  const allCounts = sideCounts(mesh.faces, count + copiedFrom.length);
  const keyOf = (a: number, b: number) => edgeKey(a, b, count + copiedFrom.length);

  const walls: Face[] = [];
  const touched = new Set<number>();
  wireframeEdges(mesh).filter(([a, b]) => selection.has(a) && selection.has(b)).forEach(([a, b]) => {
    touched.add(a);
    touched.add(b);
    // An edge shared by two selected faces is inside the region and needs no wall.
    if ((regionCounts.get(keyOf(a, b)) ?? 0) < 2) {
      walls.push([a, b, copyOf.get(b)!], [a, copyOf.get(b)!, copyOf.get(a)!]);
    }
  });
  const lines = copiedFrom.filter(i => !touched.has(i)).map((i): Edge => [i, copyOf.get(i)!]);

  const bordered = region.some(face => faceSides(face).some(([a, b]) => allCounts.get(keyOf(a, b))! > regionCounts.get(keyOf(a, b))!));
  const lifted = (face: Face) => face.map(i => copyOf.get(i)!) as Face;
  const faces = bordered
    ? mesh.faces.map(face => (isSelectedFace(face, selection) ? lifted(face) : face))
    : [...mesh.faces, ...region.map(lifted)];

  const grown: MeshData = {
    vertices: [...mesh.vertices, ...copiedFrom.map(source => mesh.vertices[source])],
    faces: [...faces, ...walls],
    edges: [...mesh.edges, ...lines],
  };
  const used = new Set([...grown.faces.flat(), ...grown.edges.flat()]);
  const unused = new Set(copiedFrom.filter(i => !used.has(i)));
  const { mesh: result, kept } = deleteVertices(grown, unused);
  const newIndex = new Map(kept.map((old, i) => [old, i]));
  return { mesh: result, copiedFrom, kept, selection: new Set(copiedFrom.map(source => newIndex.get(copyOf.get(source)!)!)) };
}

// The direction an open region of selected faces faces, as a unit vector. Null with no selected
// faces, or a closed region, which faces every way.
export function regionNormal(vertices: Vec3[], faces: Face[], selection: Selection): Vec3 | null {
  const region = faces.filter(face => isSelectedFace(face, selection));
  const counts = sideCounts(region, vertices.length);
  if (!Array.from(counts.values()).some(count => count === 1)) {
    return null;
  }
  const sum = { x: 0, y: 0, z: 0 };
  // Faces made by hand can wind either way, so each is counted facing the way of those before it.
  for (const [a, b, c] of region) {
    const [p, q, r] = [vertices[a], vertices[b], vertices[c]];
    const [ux, uy, uz] = [q.x - p.x, q.y - p.y, q.z - p.z];
    const [vx, vy, vz] = [r.x - p.x, r.y - p.y, r.z - p.z];
    const normal = { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
    const sign = dot(normal, sum) < 0 ? -1 : 1;
    sum.x += normal.x * sign;
    sum.y += normal.y * sign;
    sum.z += normal.z * sign;
  }
  const length = Math.hypot(sum.x, sum.y, sum.z);
  return length < 1e-9 ? null : { x: sum.x / length, y: sum.y / length, z: sum.z / length };
}

export type SubdivideResult = { faces: Face[]; edges: Edge[]; splits: Edge[]; selection: Selection };

// Splits every selected line at its middle, along with the faces around it. splits lists the ends
// of each split line, and its new vertex comes after the mesh's vertices in that order. A face with
// only some sides split stays whole across the others, so nothing tears.
export function subdivideSelection(mesh: MeshData, selection: Selection): SubdivideResult {
  const count = mesh.vertices.length;
  const splits = wireframeEdges(mesh).filter(([a, b]) => selection.has(a) && selection.has(b));
  const middle = new Map(splits.map(([a, b], i) => [edgeKey(a, b, count), count + i]));
  const mid = (a: number, b: number) => middle.get(edgeKey(a, b, count));

  const faces = mesh.faces.flatMap((face): Face[] => {
    const [a, b, c] = face;
    const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
    if (ab !== undefined && bc !== undefined && ca !== undefined) {
      return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
    }
    // Turned so that any one side left whole is c to a, and any lone split is on a to b.
    for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const [pq, qr, rp] = [mid(p, q), mid(q, r), mid(r, p)];
      if (pq !== undefined && qr !== undefined && rp === undefined) {
        return [[pq, q, qr], [p, pq, qr], [p, qr, r]];
      }
      if (pq !== undefined && qr === undefined && rp === undefined) {
        return [[p, pq, r], [pq, q, r]];
      }
    }
    return [face];
  });
  const edges = mesh.edges.flatMap(([a, b]): Edge[] => {
    const m = mid(a, b);
    return m === undefined ? [[a, b]] : [[a, m], [m, b]];
  });
  return { faces, edges, splits, selection: new Set([...Array.from(selection), ...splits.map((_, i) => count + i)]) };
}

export type FillResult = { mesh: MeshData; message: string };

function sameIndices(a: number[], b: number[]): boolean {
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((value, i) => value === sortedB[i]);
}

// Two selected vertices make a line. Three or more make a face, triangulated as a fan around the
// order the vertices appear in on screen, so the result does not fold over itself in this view.
export function fillSelection(mesh: MeshData, selection: Selection, camera: Camera): FillResult {
  const indices = Array.from(selection);
  if (indices.length < 2) {
    return { mesh, message: 'Select at least 2 vertices to make a line or face.' };
  }
  if (indices.length === 2) {
    const edge = indices as Edge;
    if (mesh.edges.some(existing => sameIndices(existing, edge))) {
      return { mesh, message: 'That line already exists.' };
    }
    return { mesh: { ...mesh, edges: [...mesh.edges, edge] }, message: 'Created a line.' };
  }

  const projected = indices
    .map(index => ({ index, point: projectPoint(camera, mesh.vertices[index]) }))
    .filter((entry): entry is { index: number; point: Vec2 } => entry.point !== null);
  if (projected.length !== indices.length) {
    return { mesh, message: 'Some selected vertices are behind the camera.' };
  }
  const centerX = projected.reduce((sum, { point }) => sum + point.x, 0) / projected.length;
  const centerY = projected.reduce((sum, { point }) => sum + point.y, 0) / projected.length;
  const ordered = projected
    .map(({ index, point }) => ({ index, angle: Math.atan2(point.y - centerY, point.x - centerX) }))
    .sort((a, b) => a.angle - b.angle)
    .map(({ index }) => index);

  const faces: Face[] = [];
  for (let i = 1; i < ordered.length - 1; i++) {
    const face: Face = [ordered[0], ordered[i], ordered[i + 1]];
    if (!mesh.faces.some(existing => sameIndices(existing, face))) {
      faces.push(face);
    }
  }
  if (faces.length === 0) {
    return { mesh, message: 'That face already exists.' };
  }
  return { mesh: { ...mesh, faces: [...mesh.faces, ...faces] }, message: 'Created a face.' };
}

// Every line to draw in the edit overlay: standalone edges and the sides of triangles, each once.
export function wireframeEdges({ vertices, faces, edges }: MeshData): Edge[] {
  const seen = new Set<number>();
  const result: Edge[] = [];
  const add = (a: number, b: number) => {
    const key = Math.min(a, b) * vertices.length + Math.max(a, b);
    if (!seen.has(key)) {
      seen.add(key);
      result.push([a, b]);
    }
  };
  edges.forEach(([a, b]) => add(a, b));
  faces.forEach(([a, b, c]) => {
    add(a, b);
    add(b, c);
    add(c, a);
  });
  return result;
}
