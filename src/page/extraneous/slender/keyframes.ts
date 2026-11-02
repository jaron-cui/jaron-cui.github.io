import { Animated, BezierEase, CubicEase, Ease, Key, sampleTrack, Track, track } from './animation';
import { applyMatrix, Matrix, nearestQuaternion, rotationAs } from './matrix';
import { Rotation, Vec3 } from './model';
import { Selection } from './editing';

// Each coordinate of a vertex is constant or has its own track, with key times of its own. Only a
// quaternion rotation has a w.
export type AnimatedVertex = Animated<Vec3> & { w?: number | Track };

export const SNAP_RATE = 24;
export const EASE_IN_OUT: CubicEase = [0.42, 0, 0.58, 1];
const TIME_EPSILON = 1e-6;

export type VectorCoordinate = 'x' | 'y' | 'z';
export type Coordinate = VectorCoordinate | 'w';
export const COORDINATES: readonly VectorCoordinate[] = ['x', 'y', 'z'];
const QUATERNION_COORDINATES: readonly Coordinate[] = ['w', 'x', 'y', 'z'];

export function coordinatesIn(vertex: AnimatedVertex): readonly Coordinate[] {
  return vertex.w === undefined ? COORDINATES : QUATERNION_COORDINATES;
}

export function snapTime(time: number, rate = SNAP_RATE): number {
  return Math.round(time * rate) / rate;
}

function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) < TIME_EPSILON;
}

export function isKeyed(vertex: AnimatedVertex): boolean {
  return coordinatesIn(vertex).some(coordinate => typeof vertex[coordinate] !== 'number');
}

export function valueAt(value: number | Track, time: number): number {
  return typeof value === 'number' ? value : sampleTrack(value, time);
}

export function poseAt(vertices: AnimatedVertex[], time: number): Rotation[] {
  return vertices.map(({ w, x, y, z }) => {
    const pose = { x: valueAt(x, time), y: valueAt(y, time), z: valueAt(z, time) };
    return w === undefined ? pose : { w: valueAt(w, time), ...pose };
  });
}

function keysOf(vertex: AnimatedVertex, coordinate: Coordinate): Key[] {
  const value = vertex[coordinate];
  return typeof value === 'object' ? value.keys : [];
}

function mapKeyed(vertices: AnimatedVertex[], indices: Iterable<number>, change: (vertex: AnimatedVertex) => AnimatedVertex): AnimatedVertex[] {
  const result = [...vertices];
  for (const i of Array.from(indices)) {
    if (isKeyed(result[i])) {
      result[i] = change(result[i]);
    }
  }
  return result;
}

function insertKey(vertex: AnimatedVertex, pose: Rotation, time: number, coordinates: readonly Coordinate[] = coordinatesIn(vertex)): AnimatedVertex {
  const next: AnimatedVertex = { ...vertex };
  // Part of a quaternion means nothing, so any of it keys all of it. Its sign must not send the
  // blend from the key before the long way around.
  const isQuaternion = vertex.w !== undefined;
  const chosen = isQuaternion && coordinates.length > 0 ? QUATERNION_COORDINATES : coordinates;
  const value = isQuaternion ? nearestQuaternion(pose, poseAt([vertex], time - 1e-3)[0]) : pose;
  for (const coordinate of chosen) {
    const keys = keysOf(vertex, coordinate);
    const existing = keys.find(key => sameTime(key.time, time));
    const others = keys.filter(key => key !== existing);
    next[coordinate] = track(...others, { time, value: value[coordinate]!, ease: existing?.ease ?? EASE_IN_OUT });
  }
  return next;
}

// Keys these vertices at a time with their given poses, starting tracks on any that were constant.
// coordinatesOf can limit which coordinates of each get keys.
export function writeKeys(
  vertices: AnimatedVertex[], indices: Iterable<number>, pose: Rotation[], time: number, coordinatesOf: (index: number) => readonly Coordinate[] = () => COORDINATES
): AnimatedVertex[] {
  const result = [...vertices];
  for (const i of Array.from(indices)) {
    result[i] = insertKey(result[i], pose[i], time, coordinatesOf(i));
  }
  return result;
}

// Records an edit to the current pose. Constant vertices just change value. Animated vertices hold
// the edit at this time without a key, as in Blender: only I keys it, and otherwise it is gone at
// the next frame change.
export function commitEdit(vertices: AnimatedVertex[], selection: Selection, pose: Rotation[], time: number): AnimatedVertex[] {
  const result = [...vertices];
  selection.forEach(i => {
    result[i] = isKeyed(result[i]) ? holdEdit(result[i], pose[i], time) : pose[i];
  });
  return result;
}

function holdEdit(vertex: AnimatedVertex, pose: Rotation, time: number): AnimatedVertex {
  const next: AnimatedVertex = { ...vertex };
  for (const coordinate of coordinatesIn(vertex)) {
    const value = next[coordinate]!;
    if (typeof value === 'number') {
      next[coordinate] = pose[coordinate]!;
    } else if (sampleTrack(value, time) !== pose[coordinate]) {
      next[coordinate] = { ...value, held: { time, value: pose[coordinate]! } };
    }
  }
  return next;
}

// Discards any held edits. Returns the same vertices if there were none.
export function dropHeldEdits(vertices: AnimatedVertex[]): AnimatedVertex[] {
  let changed = false;
  const result = vertices.map(vertex => {
    if (coordinatesIn(vertex).every(coordinate => typeof vertex[coordinate] === 'number' || !(vertex[coordinate] as Track).held)) {
      return vertex;
    }
    changed = true;
    const next: AnimatedVertex = { ...vertex };
    for (const coordinate of coordinatesIn(vertex)) {
      const value = next[coordinate]!;
      if (typeof value !== 'number') {
        next[coordinate] = track(...value.keys);
      }
    }
    return next;
  });
  return changed ? result : vertices;
}

// The point halfway between two vertices. If either is animated, it follows them at every key
// time of either.
export function midpointVertex(a: AnimatedVertex, b: AnimatedVertex): AnimatedVertex {
  const times = keyTimes([a, b]);
  const halfway = (time: number): Vec3 => {
    const [p, q] = poseAt([a, b], time);
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 };
  };
  if (times.length === 0) {
    return halfway(0);
  }
  const result = times.reduce<AnimatedVertex>((vertex, time) => insertKey(vertex, halfway(time), time), { x: track(), y: track(), z: track() });
  return result;
}

function changeCoordinateKey(vertex: AnimatedVertex, coordinate: Coordinate, time: number, change: (key: Key) => Key): AnimatedVertex {
  return { ...vertex, [coordinate]: track(...keysOf(vertex, coordinate).map(key => (sameTime(key.time, time) ? change(key) : key))) };
}

// Sets how one coordinate leaves a key, which the curves editor can do apart from the others.
export function setCoordinateEase(vertex: AnimatedVertex, coordinate: Coordinate, time: number, ease: Ease): AnimatedVertex {
  return changeCoordinateKey(vertex, coordinate, time, key => ({ ...key, ease }));
}

export function setCoordinateValue(vertex: AnimatedVertex, coordinate: Coordinate, time: number, value: number): AnimatedVertex {
  return changeCoordinateKey(vertex, coordinate, time, key => ({ ...key, value }));
}

// A segment's bezier handles as offsets from its keys, or null if it has none to show.
export function segmentHandles(from: Key, to: Key): BezierEase | null {
  const { ease } = from;
  if (!ease || typeof ease === 'string') {
    return null;
  }
  if (!Array.isArray(ease)) {
    return ease;
  }
  const [x1, y1, x2, y2] = ease;
  const [span, change] = [to.time - from.time, to.value - from.value];
  return { out: [x1 * span, y1 * change], in: [(x2 - 1) * span, (y2 - 1) * change] };
}

function scaledEase(ease: Ease | undefined, factor: number): Ease | undefined {
  return ease && typeof ease === 'object' && !Array.isArray(ease)
    ? { out: [ease.out[0] * factor, ease.out[1]], in: [ease.in[0] * factor, ease.in[1]] }
    : ease;
}

export type HandleSide = 'out' | 'in';

// Changes the handle beside a key, as an offset in seconds and value from that key. Time stays on
// the handle's own side of its key, so a curve cannot run backward.
export function changeHandle(
  vertex: AnimatedVertex, coordinate: Coordinate, time: number, side: HandleSide, change: (offset: [number, number]) => [number, number]
): AnimatedVertex {
  const keys = keysOf(vertex, coordinate);
  const i = keys.findIndex(key => sameTime(key.time, time));
  const [from, to] = side === 'out' ? [keys[i], keys[i + 1]] : [keys[i - 1], keys[i]];
  const handles = i >= 0 && from && to ? segmentHandles(from, to) : null;
  if (!handles) {
    return vertex;
  }
  const [dt, dv] = change(handles[side]);
  return setCoordinateEase(vertex, coordinate, from.time, { ...handles, [side]: [side === 'out' ? Math.max(0, dt) : Math.min(0, dt), dv] });
}

// Turns a handle's offset by an angle as it appears on screen, given how many pixels a second and a
// unit of value each cover there. Turning the raw numbers would skew it.
export function rotateOffset([dt, dv]: [number, number], angle: number, xPerSecond: number, yPerUnit: number): [number, number] {
  const [x, y] = [dt * xPerSecond, dv * yPerUnit];
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return [(x * cos - y * sin) / xPerSecond, (x * sin + y * cos) / yPerUnit];
}

// Times moved by a whole number of frames, as far as the earliest can go without passing zero.
export function shiftedTimes(times: number[], frames: number, rate: number): number[] {
  const earliest = Math.min(...times);
  const allowed = Math.max(frames, -Math.round(earliest * rate));
  return times.map(time => snapTime(time + allowed / rate, rate));
}

// Times stretched away from a pivot time, landing on whole frames.
export function scaledTimes(times: number[], factor: number, pivot: number, rate: number): number[] {
  return times.map(time => snapTime(Math.max(0, pivot + (time - pivot) * factor), rate));
}

export type KeyMove = { from: number; to: number };

// Moves keys between times all at once, so one key moving to where another just left is no
// collision. A key not moving is replaced by one landing on it, and of several landing together the
// last wins. A stretch by a factor stretches the moving keys' handles too.
export function remapKeys(vertices: AnimatedVertex[], indices: Iterable<number>, moves: KeyMove[], factor = 1, coordinates: readonly Coordinate[] = QUATERNION_COORDINATES): AnimatedVertex[] {
  return mapKeyed(vertices, indices, vertex => {
    const next: AnimatedVertex = { ...vertex };
    for (const coordinate of coordinates) {
      const keys = keysOf(vertex, coordinate);
      const moved = new Map<number, Key>();
      const others: Key[] = [];
      keys.forEach(key => {
        const move = moves.find(candidate => sameTime(candidate.from, key.time));
        if (move) {
          moved.set(move.to, { ...key, time: move.to, ease: scaledEase(key.ease, factor) });
        } else {
          others.push(key);
        }
      });
      if (moved.size > 0) {
        const destinations = Array.from(moved.keys());
        next[coordinate] = track(...others.filter(key => !destinations.some(to => sameTime(to, key.time))), ...Array.from(moved.values()));
      }
    }
    return next;
  });
}

// Stretches every key's time by a factor, along with any handles.
export function scaleKeyTimes(vertices: AnimatedVertex[], factor: number): AnimatedVertex[] {
  const scaled = (key: Key): Key => ({ ...key, time: key.time * factor, ease: scaledEase(key.ease, factor) });
  return vertices.map(vertex => {
    if (!isKeyed(vertex)) {
      return vertex;
    }
    const next: AnimatedVertex = { ...vertex };
    for (const coordinate of coordinatesIn(vertex)) {
      if (typeof vertex[coordinate] !== 'number') {
        next[coordinate] = track(...keysOf(vertex, coordinate).map(scaled));
      }
    }
    return next;
  });
}

// Every key time among these vertices, in order, each once. Without indices, all vertices.
export function keyTimes(vertices: AnimatedVertex[], indices?: Iterable<number>): number[] {
  const chosen = indices ? Array.from(indices).map(i => vertices[i]) : vertices;
  const times: number[] = [];
  for (const vertex of chosen) {
    for (const coordinate of coordinatesIn(vertex)) {
      for (const { time } of keysOf(vertex, coordinate)) {
        if (!times.some(existing => sameTime(existing, time))) {
          times.push(time);
        }
      }
    }
  }
  return times.sort((a, b) => a - b);
}

export function allIndices(vertices: AnimatedVertex[]): number[] {
  return vertices.map((_, i) => i);
}

// Removing a coordinate's last key leaves it constant at that key's value. Any coordinates not
// named keep their keys.
export function deleteKeys(vertices: AnimatedVertex[], indices: Iterable<number>, time: number, coordinates: readonly Coordinate[] = QUATERNION_COORDINATES): AnimatedVertex[] {
  return mapKeyed(vertices, indices, vertex => {
    let next = vertex;
    for (const coordinate of coordinates) {
      const keys = keysOf(vertex, coordinate);
      const remaining = keys.filter(key => !sameTime(key.time, time));
      if (remaining.length !== keys.length) {
        next = { ...next, [coordinate]: remaining.length > 0 ? track(...remaining) : keys[0].value };
      }
    }
    return next;
  });
}

// Moves keys between times. A key already at the destination is replaced.
export function retimeKeys(vertices: AnimatedVertex[], indices: Iterable<number>, from: number, to: number): AnimatedVertex[] {
  return sameTime(from, to) ? vertices : remapKeys(vertices, indices, [{ from, to }]);
}

export function setKeyEase(vertices: AnimatedVertex[], indices: Iterable<number>, time: number, ease: Ease): AnimatedVertex[] {
  return mapKeyed(vertices, indices, vertex => {
    const next: AnimatedVertex = { ...vertex };
    for (const coordinate of coordinatesIn(vertex)) {
      if (typeof vertex[coordinate] !== 'number') {
        next[coordinate] = track(...keysOf(vertex, coordinate).map(key => (sameTime(key.time, time) ? { ...key, ease } : key)));
      }
    }
    return next;
  });
}

// The easing of the first key found at a time, or null if there is none.
export function keyEase(vertices: AnimatedVertex[], indices: Iterable<number>, time: number): Ease | null {
  for (const i of Array.from(indices)) {
    for (const coordinate of coordinatesIn(vertices[i])) {
      const key = keysOf(vertices[i], coordinate).find(candidate => sameTime(candidate.time, time));
      if (key) {
        return key.ease ?? 'linear';
      }
    }
  }
  return null;
}

// How a property stands at a time: a change not keyed yet, a key right here, keys elsewhere, or none.
export type KeyState = 'none' | 'animated' | 'keyed' | 'held';

export function keyState(values: (number | Track | undefined)[], time: number): KeyState {
  const tracks = values.filter((value): value is Track => typeof value === 'object');
  if (tracks.length === 0) {
    return 'none';
  }
  if (tracks.some(({ held }) => held && sameTime(held.time, time))) {
    return 'held';
  }
  return tracks.some(({ keys }) => keys.some(key => sameTime(key.time, time))) ? 'keyed' : 'animated';
}

// Which properties I keys. A vertex's position counts as its location.
export type KeyingProperty = 'location' | 'rotation' | 'scale';
export type KeyingSet = Record<KeyingProperty, Record<VectorCoordinate, boolean>>;
export const KEYING_PROPERTIES: KeyingProperty[] = ['location', 'rotation', 'scale'];

const ALL_COORDINATES = { x: true, y: true, z: true };
export const DEFAULT_KEYING: KeyingSet = { location: ALL_COORDINATES, rotation: ALL_COORDINATES, scale: ALL_COORDINATES };

export function keyedCoordinates(keying: KeyingSet, property: KeyingProperty): VectorCoordinate[] {
  return COORDINATES.filter(coordinate => keying[property][coordinate]);
}

// A rotation as the other kind, keeping what it does at each of its keys. Handles are in the old
// kind's values, so segments with them go back to a plain ease. Spins of more than half a turn
// between keys are lost, since only the keys' own rotations carry over.
export function convertRotation(rotation: AnimatedVertex, quaternion: boolean): AnimatedVertex {
  if ((rotation.w !== undefined) === quaternion) {
    return rotation;
  }
  const times = keyTimes([rotation]);
  if (times.length === 0) {
    return rotationAs(poseAt([rotation], 0)[0], quaternion);
  }
  const keys: Record<Coordinate, Key[]> = { w: [], x: [], y: [], z: [] };
  let previous: Rotation | undefined;
  for (const time of times) {
    const value = rotationAs(poseAt([rotation], time)[0], quaternion, previous);
    previous = value;
    const ease = keyEase([rotation], [0], time) ?? EASE_IN_OUT;
    (quaternion ? QUATERNION_COORDINATES : COORDINATES).forEach(coordinate => {
      keys[coordinate].push({ time, value: value[coordinate]!, ease: typeof ease === 'object' && !Array.isArray(ease) ? EASE_IN_OUT : ease });
    });
  }
  const tracks = { x: track(...keys.x), y: track(...keys.y), z: track(...keys.z) };
  return quaternion ? { w: track(...keys.w), ...tracks } : tracks;
}

// A constant or a track turned to its opposite, as reflecting needs. Any handles go along.
export function negatedValue(value: number | Track): number | Track {
  if (typeof value === 'number') {
    return -value;
  }
  const negatedEase = (ease: Ease | undefined): Ease | undefined => (ease && typeof ease === 'object' && !Array.isArray(ease)
    ? { out: [ease.out[0], -ease.out[1]], in: [ease.in[0], -ease.in[1]] }
    : ease);
  return track(...value.keys.map(key => ({ ...key, value: -key.value, ease: negatedEase(key.ease) })));
}

// A vertex carried through a matrix. An animated one goes key by key, keeping each key's easing,
// with handles going back to a plain ease.
export function transformedVertex(vertex: AnimatedVertex, matrix: Matrix): AnimatedVertex {
  const place = ({ x, y, z }: Vec3) => applyMatrix(matrix, x, y, z);
  if (!isKeyed(vertex)) {
    return place(poseAt([vertex], 0)[0]);
  }
  const times = keyTimes([vertex]);
  const keysAt = (coordinate: VectorCoordinate) => track(...times.map(time => {
    const ease = keyEase([vertex], [0], time) ?? EASE_IN_OUT;
    return { time, value: place(poseAt([vertex], time)[0])[coordinate], ease: typeof ease === 'object' && !Array.isArray(ease) ? EASE_IN_OUT : ease };
  }));
  return { x: keysAt('x'), y: keysAt('y'), z: keysAt('z') };
}
