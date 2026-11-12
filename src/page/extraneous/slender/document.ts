import { Ease, Track } from './animation';
import { Bone, deformVertices, distance, restMatrix, skinMatrix, tailOffset, VertexGroup } from './armature';
import { applyConstraint, childOfMatrix, Constraint, ConstraintKind, CONSTRAINT_LABELS, DEFAULT_CHAIN_LENGTH } from './constraints';
import { Occlusion, Selection } from './editing';
import { solveChain } from './ik';
import { AnimatedVertex, commitEdit, convertRotation, Coordinate, coordinatesIn, deleteKeys, dropHeldEdits, isKeyed, keyEase, keyTimes, poseAt, scaleKeyTimes, setKeyEase, valueAt, writeKeys } from './keyframes';
import { applyMatrix, decompose, invertMatrix, Matrix, matrixOrigin, multiply, rotationLike, transformMatrix } from '../../../lib/vrender/matrix';
import { Camera, Edge, EllipsoidShape, Face, fixed, Rgb, Scene, SceneNode, Transform, Vec2, Vec3 } from '../../../lib/vrender/model';
import { Modifier, modifiedMesh } from './modifiers';
import { ellipsoidMesh, MeshData } from './primitives';
import { projectPoint } from '../../../lib/vrender/project';

// What the editor edits. Every change makes a new document that shares its unchanged parts, so
// a past document is a complete undo step, selection included.
export type EditorMode = 'object' | 'edit' | 'pose' | 'weight';

export type ObjectTransform = { position: AnimatedVertex; rotation: AnimatedVertex; scale: AnimatedVertex };

// Anything with a transform: an object or a bone.
type Posable = { transform: ObjectTransform };
type Constrained = Posable & { id: string; name: string; constraints: Constraint[] };

export type SceneObject = {
  id: string;
  name: string;
  // Relative to the parent, or to the world without one.
  transform: ObjectTransform;
  // An object or a bone.
  parent: string | null;
  constraints: Constraint[];
  folder: string | null;
  visible: boolean;
  // Relative to the object's origin.
  vertices: AnimatedVertex[];
  faces: Face[];
  edges: Edge[];
  fill: Rgb;
  border: { color: Rgb; width: number };
  selectedVertices: Selection;
  // Set on a camera, whose mesh is only the wire shape that marks it and is never rendered.
  camera: { focalLength: number } | null;
  // Set on an ellipsoid, which has no vertices of its own. It draws from its exact outline, and
  // picks and hides things through a stand-in mesh. Missing in files from before there were any.
  ellipsoid?: EllipsoidShape | null;
  // Clicks and boxes in the viewport pass through it. It can still be chosen in the outliner.
  unselectable?: boolean;
  // Set on an armature, whose vertices are its bones' joints and whose edges are its bones.
  bones: Bone[] | null;
  // The armature that bends this mesh, through the groups named after its bones.
  deformer: string | null;
  vertexGroups: VertexGroup[];
  activeGroup: string | null;
  // Only missing in files from before there were any.
  modifiers?: Modifier[];
  // An armature's mirroring across its own x, of joints in edit mode and of bones in pose mode.
  mirrorEdit?: boolean;
  mirrorPose?: boolean;
};

// Folders only organize the outliner and group visibility. They have no effect on transforms.
export type Folder = { id: string; name: string; parent: string | null; visible: boolean; unselectable?: boolean };

export type EditorDocument = {
  objects: SceneObject[];
  folders: Folder[];
  skyColor: Rgb;
  // Key times stay in seconds. These say how frames map onto them, and which ones play.
  frameRate: number;
  frameStart: number;
  frameEnd: number;
  nextId: number;
  mode: EditorMode;
  selectedObjects: string[];
  activeObject: string | null;
  selectedBones: string[];
  activeBone: string | null;
};

// An uncommitted transformation in progress, drawn in place of the document's values. Object
// transforms here are relative to the parent, as in the document.
export type Transient =
  // affected lists which vertices it changes, which proportional editing extends past the selection.
  | { kind: 'vertices'; id: string; local: Vec3[]; affected: Selection }
  | { kind: 'objects'; transforms: Map<string, Transform> };

export type KeyRow = 'all' | 'selected';
export type OutlinerItem = { kind: 'object' | 'folder'; id: string };

export const DEFAULT_FOCAL_LENGTH = 800;
export const DEFAULT_FRAME_RATE = 24;
export const DEFAULT_FRAME_START = 1;
export const DEFAULT_FRAME_END = 96;
const OCCLUSION_MARGIN = 0.002;
const OCCLUSION_MIN_MARGIN = 0.5;
const DEFAULT_SKY: Rgb = { r: 0.09, g: 0.1, b: 0.13 };
const SELECTED_OUTLINE: Rgb = { r: 1, g: 140 / 255, b: 40 / 255 };
const ACTIVE_OUTLINE: Rgb = { r: 1, g: 192 / 255, b: 106 / 255 };
const DEFAULT_FILL: Rgb = { r: 0x4a / 255, g: 0x6c / 255, b: 0xd8 / 255 };
const DEFAULT_BORDER_COLOR: Rgb = { r: 0xe6 / 255, g: 0xed / 255, b: 1 };

export function emptyDocument(): EditorDocument {
  return { objects: [], folders: [], skyColor: DEFAULT_SKY, frameRate: DEFAULT_FRAME_RATE, frameStart: DEFAULT_FRAME_START, frameEnd: DEFAULT_FRAME_END, nextId: 1, mode: 'object', selectedObjects: [], activeObject: null, selectedBones: [], activeBone: null };
}

export function uniqueName(taken: string[], wanted: string): string {
  const base = wanted.replace(/\.\d{3}$/, '');
  if (!taken.includes(base)) {
    return base;
  }
  for (let i = 1; ; i++) {
    const candidate = `${base}.${String(i).padStart(3, '0')}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
}

function objectNames(objects: SceneObject[]): string[] {
  return objects.map(object => object.name);
}

// Adds an object at a world point and makes it the only selected object.
export function addObject(
  document: EditorDocument, name: string, { vertices, faces, edges }: MeshData, camera: SceneObject['camera'] = null, at: Vec3 = { x: 0, y: 0, z: 0 }
): EditorDocument {
  const object: SceneObject = {
    id: `object-${document.nextId}`,
    name: uniqueName(objectNames(document.objects), name),
    transform: {
      position: at,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    parent: null,
    constraints: [],
    folder: null,
    visible: true,
    vertices,
    faces,
    edges,
    fill: DEFAULT_FILL,
    border: { color: DEFAULT_BORDER_COLOR, width: 6 },
    selectedVertices: new Set(),
    camera,
    bones: null,
    deformer: null,
    vertexGroups: [],
    activeGroup: null,
    modifiers: [],
  };
  return {
    ...document,
    objects: [...document.objects, object],
    nextId: document.nextId + 1,
    selectedObjects: [object.id],
    activeObject: object.id,
  };
}

// Adds an ellipsoid at a world point and makes it the only selected object.
export function addEllipsoid(document: EditorDocument, shape: EllipsoidShape, at: Vec3 = { x: 0, y: 0, z: 0 }, name = 'Ellipsoid'): EditorDocument {
  const next = addObject(document, name, { vertices: [], faces: [], edges: [] }, null, at);
  return updateObject(next, next.activeObject!, object => ({ ...object, ellipsoid: shape }));
}

// Copies the selected objects, animation included, and selects the copies. Copies refer to each
// other wherever their originals did: parents, armatures, and constraint targets. A reference to
// something not copied stays on the original, as in Blender.
export function duplicateObjects(document: EditorDocument): EditorDocument {
  let number = document.nextId;
  const sources = selectedVisible(document).flatMap(id => findObject(document, id) ?? []);
  const newIds = new Map<string, string>();
  for (const source of sources) {
    newIds.set(source.id, `object-${number++}`);
    // Bone ids are unique across the document, so a copied armature needs its own.
    source.bones?.forEach(bone => newIds.set(bone.id, `bone-${number++}`));
  }
  const relinked = <T extends string | null>(id: T) => (id !== null && newIds.get(id)) || id;
  const relinkedConstraints = (constraints: Constraint[]) => constraints.map(constraint => ({
    ...constraint,
    target: relinked(constraint.target),
    ...(constraint.pole ? { pole: relinked(constraint.pole) } : {}),
  }));
  let objects = document.objects;
  for (const source of sources) {
    const copy: SceneObject = {
      ...source,
      id: newIds.get(source.id)!,
      name: uniqueName(objectNames(objects), source.name),
      parent: relinked(source.parent),
      deformer: relinked(source.deformer),
      constraints: relinkedConstraints(source.constraints),
      bones: source.bones && source.bones.map(bone => ({
        ...bone,
        id: newIds.get(bone.id)!,
        parent: relinked(bone.parent),
        constraints: relinkedConstraints(bone.constraints),
      })),
    };
    objects = [...objects, copy];
  }
  const copies = sources.map(source => newIds.get(source.id)!);
  return {
    ...document,
    objects,
    nextId: number,
    selectedObjects: copies,
    activeObject: newIds.get(document.activeObject ?? '') ?? copies[copies.length - 1] ?? document.activeObject,
  };
}

export function findObject(document: EditorDocument, id: string | null): SceneObject | null {
  return document.objects.find(object => object.id === id) ?? null;
}

export function updateObject(document: EditorDocument, id: string, change: (object: SceneObject) => SceneObject): EditorDocument {
  return { ...document, objects: document.objects.map(object => (object.id === id ? change(object) : object)) };
}

export function findBone(document: EditorDocument, id: string | null): { armature: SceneObject; bone: Bone } | null {
  for (const armature of document.objects) {
    const bone = armature.bones?.find(candidate => candidate.id === id);
    if (bone) {
      return { armature, bone };
    }
  }
  return null;
}

export function updateBone(document: EditorDocument, id: string, change: (bone: Bone) => Bone): EditorDocument {
  return {
    ...document,
    objects: document.objects.map(object => (
      object.bones?.some(bone => bone.id === id)
        ? { ...object, bones: object.bones.map(bone => (bone.id === id ? change(bone) : bone)) }
        : object
    )),
  };
}

// Changes the transform of an object or a bone.
export function updateTransform(document: EditorDocument, id: string, change: (transform: ObjectTransform) => ObjectTransform): EditorDocument {
  return findBone(document, id)
    ? updateBone(document, id, bone => ({ ...bone, transform: change(bone.transform) }))
    : updateObject(document, id, object => ({ ...object, transform: change(object.transform) }));
}

export function nodeTransformAt(document: EditorDocument, id: string, time: number): Transform {
  return transformAt(findBone(document, id)?.bone ?? findObject(document, id)!, time);
}

// A name is kept unique by numbering it. A blank name is refused.
export function renameObject(document: EditorDocument, id: string, name: string): EditorDocument {
  const trimmed = name.trim();
  const object = findObject(document, id);
  if (!object || !trimmed || trimmed === object.name) {
    return document;
  }
  const others = document.objects.filter(other => other.id !== id);
  return updateObject(document, id, current => ({ ...current, name: uniqueName(objectNames(others), trimmed) }));
}

export function selectObjects(document: EditorDocument, ids: string[], active: string | null = document.activeObject): EditorDocument {
  return { ...document, selectedObjects: ids, activeObject: active };
}

// Selects or, with additive set, toggles one object. Null clears unless additive.
export function clickObject(document: EditorDocument, id: string | null, additive: boolean): EditorDocument {
  if (id === null) {
    return additive || document.selectedObjects.length === 0 ? document : selectObjects(document, []);
  }
  if (!additive) {
    return selectObjects(document, [id], id);
  }
  return document.selectedObjects.includes(id)
    ? selectObjects(document, document.selectedObjects.filter(other => other !== id))
    : selectObjects(document, [...document.selectedObjects, id], id);
}

export function transformParts({ transform }: Posable): AnimatedVertex[] {
  return [transform.position, transform.rotation, transform.scale];
}

export function withTransformParts<T extends Posable>(object: T, [position, rotation, scale]: AnimatedVertex[]): T {
  return { ...object, transform: { position, rotation, scale } };
}

export function transformAt(object: Posable, time: number): Transform {
  const [position, rotation, scale] = poseAt(transformParts(object), time);
  return { position, rotation, scale };
}

// An object's own transform and local vertices at a time, as a transformation in progress leaves them.
export function resolveObject(object: SceneObject, time: number, transient: Transient | null): { transform: Transform; local: Vec3[] } {
  const transform = transient?.kind === 'objects' ? transient.transforms.get(object.id) : undefined;
  return {
    transform: transform ?? transformAt(object, time),
    local: transient?.kind === 'vertices' && transient.id === object.id ? transient.local : poseAt(object.vertices, time),
  };
}

// Where every object and bone actually is: its own transform, inside its parent, then overridden
// by its constraints in order. A bone's transform is relative to where it rests, which keeps its
// offset from its parent bone. Inverse kinematics then bends whole chains of bones, whose ends reach
// for their targets. A constraint loop is broken by using the local transform at the point it closes.
export function worldMatrices(document: EditorDocument, time: number, transient: Transient | null = null): Map<string, Matrix> {
  if (transient) {
    return computeWorldMatrices(document, time, transient);
  }
  // Documents never change, so a result stays good. Child Of asks for past frames over and over.
  const known = worldMatrixCache.get(document) ?? new Map<number, Map<string, Matrix>>();
  worldMatrixCache.set(document, known);
  const found = known.get(time);
  if (found) {
    return found;
  }
  const result = computeWorldMatrices(document, time, null);
  if (known.size >= WORLD_MATRIX_CACHE_SIZE) {
    known.clear();
  }
  known.set(time, result);
  return result;
}

const WORLD_MATRIX_CACHE_SIZE = 64;
const worldMatrixCache = new WeakMap<EditorDocument, Map<number, Map<string, Matrix>>>();

function computeWorldMatrices(document: EditorDocument, time: number, transient: Transient | null): Map<string, Matrix> {
  const objects = new Map(document.objects.map(object => [object.id, object]));
  const bones = new Map<string, { armature: SceneObject; bone: Bone; rest: Matrix; length: number }>();
  for (const armature of document.objects) {
    const { local } = resolveObject(armature, time, transient);
    for (const bone of armature.bones ?? []) {
      bones.set(bone.id, {
        armature,
        bone,
        rest: restMatrix(local[bone.head], local[bone.tail]),
        length: distance(local[bone.head], local[bone.tail]),
      });
    }
  }
  const isNode = (id: string | null | undefined): id is string => Boolean(id) && (objects.has(id!) || bones.has(id!));
  // Which IK chain each bone is in, its bones listed from the root. A bone stays with the first chain
  // to reach it, and a later chain stops short of it.
  type Chain = { owner: string; constraint: Constraint; influence: number; ids: string[] };
  const chains = new Map<string, Chain>();
  bones.forEach(({ bone }, owner) => {
    bone.constraints.forEach(constraint => {
      const influence = valueAt(constraint.influence, time);
      if (constraint.kind !== 'ik' || !isNode(constraint.target) || constraint.target === owner || influence <= 0 || chains.has(owner)) {
        return;
      }
      const limit = constraint.chainLength || Infinity;
      const ids: string[] = [];
      for (let id: string | null = owner; id && ids.length < limit && !chains.has(id) && !ids.includes(id); id = bones.get(id)?.bone.parent ?? null) {
        ids.unshift(id);
      }
      const chain = { owner, constraint, influence, ids };
      ids.forEach(id => chains.set(id, chain));
    });
  });
  const solving = new Set<Chain>();
  const result = new Map<string, Matrix>();
  const visiting = new Set<string>();
  const withConstraints = (id: string, matrix: Matrix, constraints: Constraint[]) => constraints.reduce((current, constraint) => {
    const { kind, target, influence, inverse } = constraint;
    if (kind === 'ik' || target === id || !isNode(target)) {
      return current;
    }
    return kind === 'childOf'
      ? childOfMatrix(current, constraint, resolve(target), time, past => worldMatrices(document, past).get(target)!)
      : applyConstraint(current, kind, resolve(target), valueAt(influence, time), inverse);
  }, matrix);
  // A bone in the pose alone, from the world matrix its parent has.
  const posedBone = (entry: NonNullable<ReturnType<typeof bones.get>>, parentWorld: Matrix | null): Matrix => {
    const parent = entry.bone.parent ? bones.get(entry.bone.parent) : undefined;
    const base = parent && parentWorld
      ? multiply(multiply(parentWorld, invertMatrix(parent.rest)), entry.rest)
      : multiply(resolve(entry.armature.id), entry.rest);
    return withConstraints(entry.bone.id, multiply(base, ownTransform(entry.bone.id, entry.bone)), entry.bone.constraints);
  };
  const solve = (chain: Chain) => {
    solving.add(chain);
    const rootParent = bones.get(chain.ids[0])!.bone.parent;
    let parentWorld = rootParent ? resolve(rootParent) : null;
    const posed = chain.ids.map(id => {
      parentWorld = posedBone(bones.get(id)!, parentWorld);
      return parentWorld;
    });
    const { constraint, influence, owner } = chain;
    const solved = solveChain(posed, bones.get(owner)!.length, {
      target: matrixOrigin(resolve(constraint.target!)),
      pole: isNode(constraint.pole) && constraint.pole !== owner ? matrixOrigin(resolve(constraint.pole)) : null,
      poleAngle: constraint.poleAngle ?? 0,
      influence: Math.min(1, influence),
    });
    chain.ids.forEach((id, i) => result.set(id, solved[i]));
    solving.delete(chain);
  };
  const ownTransform = (id: string, node: Posable): Matrix => transformMatrix(transient?.kind === 'objects' && transient.transforms.get(id) || transformAt(node, time));
  const resolve = (id: string): Matrix => {
    const done = result.get(id);
    if (done) {
      return done;
    }
    const entry = bones.get(id);
    const chain = chains.get(id);
    if (chain && !solving.has(chain)) {
      solve(chain);
      return result.get(id)!;
    }
    const object = objects.get(id)!;
    const local = ownTransform(id, entry ? entry.bone : object);
    if (visiting.has(id)) {
      return local;
    }
    visiting.add(id);
    let matrix: Matrix;
    if (entry) {
      matrix = posedBone(entry, entry.bone.parent && bones.has(entry.bone.parent) ? resolve(entry.bone.parent) : null);
    } else {
      const parentBone = object.parent ? bones.get(object.parent) : undefined;
      if (parentBone) {
        matrix = multiply(multiply(resolve(parentBone.bone.id), tailOffset(parentBone.length)), local);
      } else {
        matrix = object.parent && objects.has(object.parent) ? multiply(resolve(object.parent), local) : local;
      }
      matrix = withConstraints(id, matrix, object.constraints);
    }
    visiting.delete(id);
    result.set(id, matrix);
    return matrix;
  };
  document.objects.forEach(object => resolve(object.id));
  bones.forEach((_, id) => resolve(id));
  return result;
}

export function toWorld(matrix: Matrix, local: Vec3[]): Vec3[] {
  return local.map(({ x, y, z }) => applyMatrix(matrix, x, y, z));
}

export function toLocal(matrix: Matrix, world: Vec3[]): Vec3[] {
  const inverse = invertMatrix(matrix);
  return world.map(({ x, y, z }) => applyMatrix(inverse, x, y, z));
}

export function worldVertices(document: EditorDocument, object: SceneObject, time: number, transient: Transient | null = null): Vec3[] {
  return toWorld(worldMatrices(document, time, transient).get(object.id)!, resolveObject(object, time, transient).local);
}

// What an object's or bone's own transform is relative to, in the world: for a bone, where it would
// be with no pose; for an object, its parent's frame, or the identity without one. Child Of
// constraints count, being parents themselves.
export function parentMatrix(document: EditorDocument, node: SceneObject | Bone, time: number): Matrix {
  const matrices = worldMatrices(document, time);
  return node.constraints.reduce((matrix, constraint) => {
    const { kind, target } = constraint;
    return kind === 'childOf' && target !== node.id && target && matrices.has(target)
      ? childOfMatrix(matrix, constraint, matrices.get(target)!, time, past => worldMatrices(document, past).get(target)!)
      : matrix;
  }, hierarchyMatrix(document, node, time, matrices));
}

function hierarchyMatrix(document: EditorDocument, node: SceneObject | Bone, time: number, matrices: Map<string, Matrix>): Matrix {
  const found = findBone(document, node.id);
  if (found) {
    const { armature, bone } = found;
    const joints = poseAt(armature.vertices, time);
    const rest = restMatrix(joints[bone.head], joints[bone.tail]);
    const parent = armature.bones!.find(other => other.id === bone.parent);
    if (!parent) {
      return multiply(matrices.get(armature.id)!, rest);
    }
    const parentRest = restMatrix(joints[parent.head], joints[parent.tail]);
    return multiply(multiply(matrices.get(parent.id)!, invertMatrix(parentRest)), rest);
  }
  if (!node.parent || !matrices.has(node.parent)) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  }
  const parentBone = findBone(document, node.parent);
  if (parentBone) {
    const joints = poseAt(parentBone.armature.vertices, time);
    return multiply(matrices.get(node.parent)!, tailOffset(distance(joints[parentBone.bone.head], joints[parentBone.bone.tail])));
  }
  return matrices.get(node.parent)!;
}

// Where an armature's bones are posed, in world space.
export function boneSegments(armature: SceneObject, matrices: Map<string, Matrix>, local: Vec3[]): { bone: Bone; head: Vec3; tail: Vec3 }[] {
  return (armature.bones ?? []).map(bone => {
    const matrix = matrices.get(bone.id)!;
    return {
      bone,
      head: matrixOrigin(matrix),
      tail: applyMatrix(matrix, 0, distance(local[bone.head], local[bone.tail]), 0),
    };
  });
}

// An object's vertices as they appear, relative to it: bent by its armature, or for an armature,
// its joints where the pose puts them. The object being edited shows its plain vertices, because
// those are what editing changes.
export function displayVertices(
  document: EditorDocument, object: SceneObject, time: number, transient: Transient | null, matrices: Map<string, Matrix>
): Vec3[] {
  const { local } = resolveObject(object, time, transient);
  if (document.mode === 'edit' && document.activeObject === object.id) {
    return local;
  }
  const own = matrices.get(object.id)!;
  if (object.bones) {
    const result = [...local];
    const inverse = invertMatrix(own);
    for (const { bone, head, tail } of boneSegments(object, matrices, local)) {
      result[bone.head] = applyMatrix(inverse, head.x, head.y, head.z);
      result[bone.tail] = applyMatrix(inverse, tail.x, tail.y, tail.z);
    }
    return result;
  }
  return deformedBy(document, object, local, object.vertexGroups, time, transient, matrices);
}

// Vertices relative to an object, bent by its armature if it has one.
function deformedBy(
  document: EditorDocument, object: SceneObject, local: Vec3[], groups: VertexGroup[], time: number, transient: Transient | null, matrices: Map<string, Matrix>
): Vec3[] {
  const armature = findObject(document, object.deformer);
  if (!armature?.bones) {
    return local;
  }
  const own = matrices.get(object.id)!;
  // Each bone's movement from rest, measured in world space and then expressed relative to this object.
  const joints = resolveObject(armature, time, transient).local;
  const armatureWorld = matrices.get(armature.id)!;
  const inverse = invertMatrix(own);
  const skins = new Map(armature.bones.map(bone => {
    const restWorld = multiply(armatureWorld, restMatrix(joints[bone.head], joints[bone.tail]));
    return [bone.name, multiply(multiply(inverse, skinMatrix(matrices.get(bone.id)!, restWorld)), own)];
  }));
  return deformVertices(local, groups, skins);
}

// A mesh as it finally looks, with its modifiers. Mesh editing still sees only displayVertices and
// the object's own faces, since the generated parts cannot be edited.
export function renderedMesh(
  document: EditorDocument, object: SceneObject, time: number, transient: Transient | null, matrices: Map<string, Matrix>
): MeshData {
  if (object.ellipsoid) {
    return ellipsoidMesh(object.ellipsoid);
  }
  const modifiers = object.modifiers ?? [];
  if (modifiers.length === 0) {
    return { vertices: displayVertices(document, object, time, transient, matrices), faces: object.faces, edges: object.edges };
  }
  const { local } = resolveObject(object, time, transient);
  const { vertices, faces, edges, groups } = modifiedMesh({ vertices: local, faces: object.faces, edges: object.edges }, object.vertexGroups, modifiers);
  const isEditing = document.mode === 'edit' && document.activeObject === object.id;
  return { vertices: isEditing ? vertices : deformedBy(document, object, vertices, groups, time, transient, matrices), faces, edges };
}

// The view from a camera object, from wherever parents and constraints put it. Scale is ignored.
export function viewFromObject(document: EditorDocument, object: SceneObject, time: number, transient: Transient | null): Camera {
  const { position, rotation } = decompose(worldMatrices(document, time, transient).get(object.id)!);
  return { position, rotation, focalLength: object.camera?.focalLength ?? DEFAULT_FOCAL_LENGTH };
}

// Which camera to look through: the active object if it is one, otherwise the first in the scene.
export function chooseCamera(document: EditorDocument): SceneObject | null {
  const active = findObject(document, document.activeObject);
  return active?.camera ? active : document.objects.find(object => object.camera) ?? null;
}

export function isVisible(document: EditorDocument, object: SceneObject): boolean {
  if (!object.visible) {
    return false;
  }
  let folder = document.folders.find(candidate => candidate.id === object.folder);
  while (folder) {
    if (!folder.visible) {
      return false;
    }
    const parentId: string | null = folder.parent;
    folder = document.folders.find(candidate => candidate.id === parentId);
  }
  return true;
}

// Hidden objects stay selected, but what is out of sight is out of reach, so actions use this.
export function selectedVisible(document: EditorDocument): string[] {
  return document.selectedObjects.filter(id => {
    const object = findObject(document, id);
    return object && isVisible(document, object);
  });
}

// Whether clicks and boxes in the viewport can choose this object.
export function isSelectable(document: EditorDocument, object: SceneObject): boolean {
  if (!isVisible(document, object) || object.unselectable) {
    return false;
  }
  let folder = document.folders.find(candidate => candidate.id === object.folder);
  while (folder) {
    if (folder.unselectable) {
      return false;
    }
    const parentId: string | null = folder.parent;
    folder = document.folders.find(candidate => candidate.id === parentId);
  }
  return true;
}

// With highlight set, objects selected in object mode get an outline around their silhouette.
export function toScene(document: EditorDocument, camera: Camera, time: number, transient: Transient | null, highlight = false): Scene {
  const matrices = worldMatrices(document, time, transient);
  return {
    background: { ...document.skyColor, a: 1 },
    camera,
    nodes: document.objects.filter(object => !object.camera && !object.bones && isVisible(document, object)).map((object): SceneNode => {
      const { transform } = resolveObject(object, time, transient);
      const style = {
        name: object.name,
        transform,
        worldMatrix: fixed(matrices.get(object.id)!),
        fill: object.fill,
        border: { color: { ...object.border.color, a: 1 }, width: object.border.width },
        ...(highlight && document.mode === 'object' && document.selectedObjects.includes(object.id)
          ? { highlight: fixed(object.id === document.activeObject ? ACTIVE_OUTLINE : SELECTED_OUTLINE) }
          : {}),
      };
      if (object.ellipsoid) {
        return { kind: 'ellipsoid', ...style, radii: object.ellipsoid.radii, length: object.ellipsoid.length };
      }
      const { vertices: local, faces, edges } = renderedMesh(document, object, time, transient, matrices);
      return { kind: 'mesh', ...style, vertices: local, faces: fixed(faces), edges: fixed(edges) };
    }),
  };
}

// Hiding keeps the selection, but what is hidden cannot go on being edited.
function leavingHiddenModes(document: EditorDocument): EditorDocument {
  const active = findObject(document, document.activeObject);
  return active && !isVisible(document, active) ? { ...document, mode: 'object' } : document;
}

// Making something unselectable lets go of it, as Blender does. It stays the active object.
function withoutUnselectable(document: EditorDocument): EditorDocument {
  return {
    ...document,
    selectedObjects: document.selectedObjects.filter(id => {
      const object = findObject(document, id);
      return object && (!isVisible(document, object) || isSelectable(document, object));
    }),
  };
}

export function toggleObjectSelectable(document: EditorDocument, id: string): EditorDocument {
  return withoutUnselectable(updateObject(document, id, object => ({ ...object, unselectable: !object.unselectable })));
}

export function toggleFolderSelectable(document: EditorDocument, id: string): EditorDocument {
  return withoutUnselectable({
    ...document,
    folders: document.folders.map(folder => (folder.id === id ? { ...folder, unselectable: !folder.unselectable } : folder)),
  });
}

export function toggleObjectVisible(document: EditorDocument, id: string): EditorDocument {
  return leavingHiddenModes(updateObject(document, id, object => ({ ...object, visible: !object.visible })));
}

export function toggleFolderVisible(document: EditorDocument, id: string): EditorDocument {
  return leavingHiddenModes({
    ...document,
    folders: document.folders.map(folder => (folder.id === id ? { ...folder, visible: !folder.visible } : folder)),
  });
}

export function addFolder(document: EditorDocument): EditorDocument {
  const folder: Folder = {
    id: `folder-${document.nextId}`,
    name: uniqueName(document.folders.map(({ name }) => name), 'Folder'),
    parent: null,
    visible: true,
  };
  return { ...document, folders: [...document.folders, folder], nextId: document.nextId + 1 };
}

export function renameFolder(document: EditorDocument, id: string, name: string): EditorDocument {
  const trimmed = name.trim();
  const folder = document.folders.find(candidate => candidate.id === id);
  if (!folder || !trimmed || trimmed === folder.name) {
    return document;
  }
  const taken = document.folders.filter(other => other.id !== id).map(other => other.name);
  return { ...document, folders: document.folders.map(other => (other.id === id ? { ...other, name: uniqueName(taken, trimmed) } : other)) };
}

// Removes a folder but not its contents, which move up to where the folder was.
export function deleteFolder(document: EditorDocument, id: string): EditorDocument {
  const folder = document.folders.find(candidate => candidate.id === id);
  if (!folder) {
    return document;
  }
  return leavingHiddenModes({
    ...document,
    folders: document.folders
      .filter(other => other.id !== id)
      .map(other => (other.parent === id ? { ...other, parent: folder.parent } : other)),
    objects: document.objects.map(object => (object.folder === id ? { ...object, folder: folder.parent } : object)),
  });
}

function folderContains(document: EditorDocument, ancestor: string, id: string | null): boolean {
  let current = id;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    const folderId: string = current;
    current = document.folders.find(candidate => candidate.id === folderId)?.parent ?? null;
  }
  return false;
}

// Moves items into a folder, or to the top level with null. A folder cannot go inside itself.
export function moveToFolder(document: EditorDocument, items: OutlinerItem[], folder: string | null): EditorDocument {
  const objectIds = items.filter(item => item.kind === 'object').map(item => item.id);
  const folderIds = items
    .filter(item => item.kind === 'folder' && !folderContains(document, item.id, folder))
    .map(item => item.id);
  const objectsChange = document.objects.some(object => objectIds.includes(object.id) && object.folder !== folder);
  const foldersChange = document.folders.some(other => folderIds.includes(other.id) && other.parent !== folder);
  if (!objectsChange && !foldersChange) {
    return document;
  }
  return leavingHiddenModes({
    ...document,
    objects: document.objects.map(object => (objectIds.includes(object.id) ? { ...object, folder } : object)),
    folders: document.folders.map(other => (folderIds.includes(other.id) ? { ...other, parent: folder } : other)),
  });
}

// What a node's placement directly depends on: a bone's parent bone or armature, or an object's parent.
export function nodeParent(document: EditorDocument, id: string): string | null {
  const found = findBone(document, id);
  return found ? found.bone.parent ?? found.armature.id : findObject(document, id)?.parent ?? null;
}

function hasAncestor(document: EditorDocument, id: string, ancestor: string): boolean {
  const seen = new Set<string>();
  let current = nodeParent(document, id);
  while (current && !seen.has(current)) {
    if (current === ancestor) {
      return true;
    }
    seen.add(current);
    current = nodeParent(document, current);
  }
  return false;
}

export function canParent(document: EditorDocument, id: string, parent: string): boolean {
  return parent !== id && !hasAncestor(document, parent, id);
}

// Objects that may become this object's parent: not itself, nor anything already parented under it.
export function validParents(document: EditorDocument, object: SceneObject): SceneObject[] {
  return document.objects.filter(other => canParent(document, object.id, other.id));
}

// Bones that may become this object's parent, each with the armature that holds it.
export function validParentBones(document: EditorDocument, object: SceneObject): { armature: SceneObject; bone: Bone }[] {
  return document.objects.flatMap(armature => (armature.bones ?? [])
    .filter(bone => canParent(document, object.id, bone.id))
    .map(bone => ({ armature, bone })));
}

// Changes an object's parent. If its transform is not animated, the object stays where it is in
// the world by taking a new transform relative to the parent. Animated transforms are left as
// keyed, and so move with the new parent.
export function setParent(document: EditorDocument, id: string, parent: string | null, time: number): EditorDocument {
  const object = findObject(document, id);
  if (!object || object.parent === parent || (parent && !canParent(document, id, parent))) {
    return document;
  }
  const reparented = updateObject(document, id, current => ({ ...current, parent }));
  if (transformParts(object).some(isKeyed)) {
    return reparented;
  }
  const newParent = findObject(reparented, id)!;
  const world = worldMatrices(document, time).get(id)!;
  const { position, rotation, scale } = decompose(multiply(invertMatrix(parentMatrix(reparented, newParent, time)), world));
  return updateObject(reparented, id, current => withTransformParts(
    current, commitEdit(transformParts(current), new Set([0, 1, 2]), [position, rotationLike(rotation, transformAt(current, time).rotation), scale], time)
  ));
}

// Lets go of things that are about to be deleted: children stay in place in the world, and
// constraints on them and armatures bending with them are cleared.
export function releaseReferences(document: EditorDocument, gone: string[], time: number): EditorDocument {
  let next = document;
  for (const object of document.objects) {
    if (object.parent && gone.includes(object.parent) && !gone.includes(object.id)) {
      next = setParent(next, object.id, null, time);
    }
  }
  const cleared = (constraints: Constraint[]) => constraints.map(constraint => ({
    ...constraint,
    target: constraint.target && gone.includes(constraint.target) ? null : constraint.target,
    ...(constraint.pole && gone.includes(constraint.pole) ? { pole: null } : {}),
  }));
  return {
    ...next,
    objects: next.objects.map(object => ({
      ...object,
      constraints: cleared(object.constraints),
      deformer: object.deformer && gone.includes(object.deformer) ? null : object.deformer,
      bones: object.bones && object.bones.map(bone => ({ ...bone, constraints: cleared(bone.constraints) })),
    })),
    selectedBones: next.selectedBones.filter(id => !gone.includes(id)),
    activeBone: next.activeBone && gone.includes(next.activeBone) ? null : next.activeBone,
  };
}

// Deletes objects. Their children stay in place in the world, and constraints on them are cleared.
export function deleteObjects(document: EditorDocument, ids: string[], time: number): EditorDocument {
  const bones = document.objects.filter(object => ids.includes(object.id)).flatMap(object => (object.bones ?? []).map(bone => bone.id));
  const next = releaseReferences(document, [...ids, ...bones], time);
  const remaining = next.objects.filter(object => !ids.includes(object.id));
  const active = next.activeObject && ids.includes(next.activeObject) ? null : next.activeObject;
  return {
    ...next,
    objects: remaining,
    selectedObjects: next.selectedObjects.filter(id => !ids.includes(id)),
    activeObject: active,
    mode: active ? next.mode : 'object',
  };
}

// Changes the constraints of an object or a bone.
function updateConstraints(document: EditorDocument, id: string, change: (constraints: Constraint[]) => Constraint[]): EditorDocument {
  return findBone(document, id)
    ? updateBone(document, id, bone => ({ ...bone, constraints: change(bone.constraints) }))
    : updateObject(document, id, object => ({ ...object, constraints: change(object.constraints) }));
}

export function addConstraint(document: EditorDocument, id: string, kind: ConstraintKind): EditorDocument {
  const constraint: Constraint = {
    id: `constraint-${document.nextId}`,
    kind,
    target: null,
    influence: 1,
    ...(kind === 'ik' ? { chainLength: DEFAULT_CHAIN_LENGTH, pole: null, poleAngle: 0 } : {}),
  };
  return {
    ...updateConstraints(document, id, constraints => [...constraints, constraint]),
    nextId: document.nextId + 1,
  };
}

export function updateConstraint(document: EditorDocument, id: string, constraintId: string, change: Partial<Constraint>): EditorDocument {
  return updateConstraints(document, id, constraints => constraints.map(constraint => (
    constraint.id === constraintId ? { ...constraint, ...change } : constraint
  )));
}

function findNode(document: EditorDocument, id: string): (Constrained & { parent: string | null }) | null {
  return findBone(document, id)?.bone ?? findObject(document, id);
}

function findConstraint(document: EditorDocument, id: string, constraintId: string): Constraint | undefined {
  return findNode(document, id)?.constraints.find(constraint => constraint.id === constraintId);
}

// Child Of keeps where the child is now, by undoing where the target is now.
export function childOfInverse(document: EditorDocument, target: string | null, time: number): Matrix | undefined {
  const matrix = target ? worldMatrices(document, time).get(target) : undefined;
  return matrix && invertMatrix(matrix);
}

export function setConstraintTarget(document: EditorDocument, id: string, constraintId: string, target: string | null, time: number): EditorDocument {
  const isChildOf = findConstraint(document, id, constraintId)?.kind === 'childOf';
  return updateConstraint(document, id, constraintId, isChildOf ? { target, inverse: childOfInverse(document, target, time) } : { target });
}

// A constraint's influence as a part of its own, so that key operations work on it. Keys go on x.
function influenceParts(constraints: Constraint[]): AnimatedVertex[] {
  return constraints.map(({ influence }) => ({ x: influence, y: 0, z: 0 }));
}

function withInfluenceParts(constraints: Constraint[], parts: AnimatedVertex[]): Constraint[] {
  return constraints.map((constraint, i) => ({ ...constraint, influence: parts[i].x }));
}

// Changes a constraint's influence. If it is animated, the change holds until the frame changes.
export function setConstraintInfluence(document: EditorDocument, id: string, constraintId: string, influence: number, time: number): EditorDocument {
  return updateConstraints(document, id, constraints => withInfluenceParts(constraints, commitEdit(
    influenceParts(constraints), new Set([constraints.findIndex(constraint => constraint.id === constraintId)]), constraints.map(() => ({ x: influence, y: 0, z: 0 })), time
  )));
}

// Turns a Child Of on or off here. With no keys it means always or never, so turning it on starts
// following from where the target is now.
export function setChildOfOn(document: EditorDocument, id: string, constraintId: string, on: boolean, time: number): EditorDocument {
  const constraint = findConstraint(document, id, constraintId);
  const set = setConstraintInfluence(document, id, constraintId, on ? 1 : 0, time);
  return on && typeof constraint?.influence === 'number'
    ? updateConstraint(set, id, constraintId, { inverse: childOfInverse(document, constraint.target, time) })
    : set;
}

// Keys a constraint's influence at a time, with the given value or what it has there.
export function keyConstraintInfluence(document: EditorDocument, id: string, constraintId: string, time: number, value?: number, hold = false): EditorDocument {
  return updateConstraints(document, id, constraints => {
    const index = constraints.findIndex(constraint => constraint.id === constraintId);
    const parts = influenceParts(constraints);
    const keyed = writeKeys(parts, [index], constraints.map(constraint => ({ x: value ?? valueAt(constraint.influence, time), y: 0, z: 0 })), time, () => ['x']);
    return withInfluenceParts(constraints, hold ? setKeyEase(keyed, [index], time, 'hold') : keyed);
  });
}

export function unkeyConstraintInfluence(document: EditorDocument, id: string, constraintId: string, time: number): EditorDocument {
  return updateConstraints(document, id, constraints => withInfluenceParts(
    constraints, deleteKeys(influenceParts(constraints), [constraints.findIndex(constraint => constraint.id === constraintId)], time)
  ));
}

// Switches a node between Euler and quaternion rotation, keeping what its keys do.
export function setRotationMode(document: EditorDocument, id: string, quaternion: boolean): EditorDocument {
  return updateTransform(document, id, transform => ({ ...transform, rotation: convertRotation(transform.rotation, quaternion) }));
}

export function removeConstraint(document: EditorDocument, id: string, constraintId: string): EditorDocument {
  return updateConstraints(document, id, constraints => constraints.filter(constraint => constraint.id !== constraintId));
}

// The chosen objects or bones without any whose parent chain includes another, since those move with it.
export function topLevelOnly(document: EditorDocument, ids: string[]): string[] {
  return ids.filter(id => (
    (findObject(document, id) || findBone(document, id)) && !ids.some(other => other !== id && hasAncestor(document, id, other))
  ));
}

export function objectOrigin(document: EditorDocument, id: string, time: number): Vec3 {
  return matrixOrigin(worldMatrices(document, time).get(id)!);
}

type Triangle = [Vec3, Vec3, Vec3];

// Every visible mesh face, in world space. Lines, vertices and cameras are not surfaces.
function surfaceTriangles(document: EditorDocument, time: number, transient: Transient | null): Triangle[] {
  const matrices = worldMatrices(document, time, transient);
  return document.objects
    .filter(object => !object.camera && isVisible(document, object))
    .flatMap(object => {
      const { vertices, faces } = renderedMesh(document, object, time, transient, matrices);
      const world = toWorld(matrices.get(object.id)!, vertices);
      return faces.map(([a, b, c]): Triangle => [world[a], world[b], world[c]]);
    });
}

function minus(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// How far along a unit ray it meets a triangle, or null if it does not.
function rayHitsTriangle(origin: Vec3, direction: Vec3, [a, b, c]: Triangle): number | null {
  const ab = minus(b, a);
  const ac = minus(c, a);
  const p = cross(direction, ac);
  const determinant = dot(ab, p);
  if (Math.abs(determinant) < 1e-12) {
    return null;
  }
  const fromA = minus(origin, a);
  const u = dot(fromA, p) / determinant;
  if (u < 0 || u > 1) {
    return null;
  }
  const q = cross(fromA, ab);
  const v = dot(direction, q) / determinant;
  if (v < 0 || u + v > 1) {
    return null;
  }
  const distance = dot(ac, q) / determinant;
  return distance > 0 ? distance : null;
}

// The distance along a unit ray to the nearest visible mesh face, or null if it hits none.
export function raycastSurface(document: EditorDocument, time: number, origin: Vec3, direction: Vec3): number | null {
  let nearest: number | null = null;
  for (const triangle of surfaceTriangles(document, time, null)) {
    const distance = rayHitsTriangle(origin, direction, triangle);
    if (distance !== null && (nearest === null || distance < nearest)) {
      nearest = distance;
    }
  }
  return nearest;
}

// A test for whether a world point is hidden from a camera by any visible mesh face. A point lying
// on a face does not count as behind it.
export function occlusionTest(document: EditorDocument, time: number, camera: Camera, transient: Transient | null = null): Occlusion {
  const triangles = surfaceTriangles(document, time, transient);
  return point => {
    const toPoint = minus(point, camera.position);
    const length = Math.hypot(toPoint.x, toPoint.y, toPoint.z);
    if (length === 0) {
      return false;
    }
    const direction = { x: toPoint.x / length, y: toPoint.y / length, z: toPoint.z / length };
    const limit = length - Math.max(OCCLUSION_MIN_MARGIN, length * OCCLUSION_MARGIN);
    return triangles.some(triangle => {
      const distance = rayHitsTriangle(camera.position, direction, triangle);
      return distance !== null && distance < limit;
    });
  };
}

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const side = (u: Vec2, v: Vec2) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
  const [ab, bc, ca] = [side(a, b), side(b, c), side(c, a)];
  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const lengthSquared = dx * dx + dy * dy;
  const s = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - a.x - s * dx, p.y - a.y - s * dy);
}

// The visible object under an image-space point: an armature's bone, which draws over everything,
// then the nearest face hit, else the nearest line or vertex within the radius. Geometry partly
// behind the camera is skipped.
export function pickObject(document: EditorDocument, camera: Camera, time: number, point: Vec2, radius: number): string | null {
  let faceHit: string | null = null;
  let faceDistance = Infinity;
  let wireHit: string | null = null;
  let wireDistance = radius;
  let boneHit: string | null = null;
  let boneDistance = radius;
  const matrices = worldMatrices(document, time);

  for (const object of document.objects.filter(candidate => isSelectable(document, candidate))) {
    const mesh = renderedMesh(document, object, time, null, matrices);
    const world = toWorld(matrices.get(object.id)!, mesh.vertices);
    const projected = world.map(vertex => projectPoint(camera, vertex));
    for (const [a, b] of object.bones ? mesh.edges : []) {
      const [pa, pb] = [projected[a], projected[b]];
      if (pa && pb && distanceToSegment(point, pa, pb) <= boneDistance) {
        boneHit = object.id;
        boneDistance = distanceToSegment(point, pa, pb);
      }
    }
    for (const [a, b, c] of mesh.faces) {
      const [pa, pb, pc] = [projected[a], projected[b], projected[c]];
      if (pa && pb && pc && inTriangle(point, pa, pb, pc)) {
        const distance = [a, b, c].reduce((sum, i) => (
          sum + Math.hypot(world[i].x - camera.position.x, world[i].y - camera.position.y, world[i].z - camera.position.z)
        ), 0) / 3;
        if (distance < faceDistance) {
          faceHit = object.id;
          faceDistance = distance;
        }
      }
    }
    for (const [a, b] of mesh.edges) {
      const [pa, pb] = [projected[a], projected[b]];
      if (pa && pb) {
        const distance = distanceToSegment(point, pa, pb);
        if (distance <= wireDistance) {
          wireHit = object.id;
          wireDistance = distance;
        }
      }
    }
    for (const vertex of projected) {
      if (vertex) {
        const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
        if (distance <= wireDistance) {
          wireHit = object.id;
          wireDistance = distance;
        }
      }
    }
  }
  return boneHit ?? faceHit ?? wireHit;
}

// The bone of an armature under an image-space point, or null.
export function pickBone(document: EditorDocument, armature: SceneObject, camera: Camera, time: number, point: Vec2, radius: number): string | null {
  const matrices = worldMatrices(document, time);
  let hit: string | null = null;
  let nearest = radius;
  for (const { bone, head, tail } of boneSegments(armature, matrices, poseAt(armature.vertices, time))) {
    const [a, b] = [projectPoint(camera, head), projectPoint(camera, tail)];
    if (a && b && distanceToSegment(point, a, b) <= nearest) {
      hit = bone.id;
      nearest = distanceToSegment(point, a, b);
    }
  }
  return hit;
}

// The bones of an armature with either end inside an image-space box.
export function bonesInBox(document: EditorDocument, armature: SceneObject, camera: Camera, time: number, a: Vec2, b: Vec2): string[] {
  const [minX, maxX] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [minY, maxY] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const inside = (point: Vec3) => {
    const p = projectPoint(camera, point);
    return p !== null && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  };
  return boneSegments(armature, worldMatrices(document, time), poseAt(armature.vertices, time))
    .filter(({ head, tail }) => inside(head) || inside(tail))
    .map(({ bone }) => bone.id);
}

// Visible objects with any unhidden vertex inside an image-space box.
export function objectsInBox(document: EditorDocument, camera: Camera, time: number, a: Vec2, b: Vec2, occluded?: Occlusion): string[] {
  const [minX, maxX] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [minY, maxY] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const matrices = worldMatrices(document, time);
  return document.objects
    .filter(object => isSelectable(document, object))
    .filter(object => toWorld(matrices.get(object.id)!, renderedMesh(document, object, time, null, matrices).vertices).some(vertex => {
      const p = projectPoint(camera, vertex);
      return p !== null && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY && !occluded?.(vertex);
    }))
    .map(object => object.id);
}

type KeyTarget = { object: SceneObject; part: 'transform' | 'vertices' | Bone | { constraintsOf: Constrained }; indices: number[] };

function constraintTargets(object: SceneObject, node: Constrained): KeyTarget[] {
  return node.constraints.length > 0 ? [{ object, part: { constraintsOf: node }, indices: node.constraints.map((_, i) => i) }] : [];
}

function boneTargets(object: SceneObject, bones: Bone[]): KeyTarget[] {
  return bones.flatMap((bone): KeyTarget[] => [{ object, part: bone, indices: [0, 1, 2] }, ...constraintTargets(object, bone)]);
}

// What a row of the animation pane covers. In edit mode, the active object's vertices. In pose
// mode, the active armature's bones. In object mode, whole objects: their transforms, any vertex
// animation inside them, and any bones.
function keyTargets(document: EditorDocument, row: KeyRow): KeyTarget[] {
  if (document.mode === 'edit') {
    const object = findObject(document, document.activeObject);
    if (!object) {
      return [];
    }
    const indices = row === 'all' ? object.vertices.map((_, i) => i) : Array.from(object.selectedVertices);
    return [{ object, part: 'vertices', indices }];
  }
  if (document.mode === 'pose') {
    const object = findObject(document, document.activeObject);
    const bones = object?.bones ?? [];
    return object ? boneTargets(object, row === 'all' ? bones : bones.filter(bone => document.selectedBones.includes(bone.id))) : [];
  }
  const objects = row === 'all'
    ? document.objects
    : document.objects.filter(object => document.selectedObjects.includes(object.id));
  return objects.flatMap((object): KeyTarget[] => [
    { object, part: 'transform', indices: [0, 1, 2] },
    { object, part: 'vertices', indices: object.vertices.map((_, i) => i) },
    ...constraintTargets(object, object),
    ...boneTargets(object, object.bones ?? []),
  ]);
}

function partOf({ object, part }: KeyTarget): AnimatedVertex[] {
  if (part === 'transform') {
    return transformParts(object);
  }
  if (part === 'vertices') {
    return object.vertices;
  }
  return 'constraintsOf' in part ? influenceParts(part.constraintsOf.constraints) : transformParts(part);
}

export function rowKeyTimes(document: EditorDocument, row: KeyRow): number[] {
  const times = keyTargets(document, row).flatMap(target => keyTimes(partOf(target), target.indices));
  return times
    .sort((a, b) => a - b)
    .filter((time, i) => i === 0 || Math.abs(time - times[i - 1]) >= 1e-6);
}

export function rowKeyEase(document: EditorDocument, row: KeyRow, time: number): Ease | null {
  for (const target of keyTargets(document, row)) {
    const ease = keyEase(partOf(target), target.indices, time);
    if (ease !== null) {
      return ease;
    }
  }
  return null;
}

// Forgets edits not keyed, as leaving their frame does. Returns the same document if there were none.
export function dropHeldDocumentEdits(document: EditorDocument): EditorDocument {
  let changed = false;
  const dropped = <T extends { transform: ObjectTransform; constraints: Constraint[] }>(node: T): T => {
    const parts = transformParts(node);
    const next = dropHeldEdits(parts);
    const influences = influenceParts(node.constraints);
    const nextInfluences = dropHeldEdits(influences);
    if (next === parts && nextInfluences === influences) {
      return node;
    }
    changed = true;
    return { ...withTransformParts(node, next), constraints: withInfluenceParts(node.constraints, nextInfluences) };
  };
  const objects = document.objects.map(object => {
    const vertices = dropHeldEdits(object.vertices);
    changed = changed || vertices !== object.vertices;
    return { ...dropped(object), vertices, bones: object.bones && object.bones.map(dropped) };
  });
  return changed ? { ...document, objects } : document;
}

// Changes the frame rate, keeping every key on its frame as Blender does, so the animation plays
// faster or slower. The rate is a positive whole number.
export function setFrameRate(document: EditorDocument, rate: number): EditorDocument {
  const frameRate = Math.max(1, Math.round(rate));
  const factor = document.frameRate / frameRate;
  const scaled = <T extends { transform: ObjectTransform; constraints: Constraint[] }>(node: T): T => ({
    ...withTransformParts(node, scaleKeyTimes(transformParts(node), factor)),
    constraints: withInfluenceParts(node.constraints, scaleKeyTimes(influenceParts(node.constraints), factor)),
  });
  return {
    ...document,
    frameRate,
    objects: document.objects.map(object => ({
      ...scaled(object),
      vertices: scaleKeyTimes(object.vertices, factor),
      bones: object.bones && object.bones.map(scaled),
    })),
  };
}

// Frames are whole and not negative, and the end is never before the start. Whichever was just
// changed wins, pushing the other along.
export function setFrameStart(document: EditorDocument, frame: number): EditorDocument {
  const frameStart = Math.max(0, Math.round(frame));
  return { ...document, frameStart, frameEnd: Math.max(frameStart, document.frameEnd) };
}

export function setFrameEnd(document: EditorDocument, frame: number): EditorDocument {
  const frameEnd = Math.max(0, Math.round(frame));
  return { ...document, frameEnd, frameStart: Math.min(frameEnd, document.frameStart) };
}

// One animated number shown in the curves editor: one coordinate of a vertex or a transform part, or
// a constraint's influence.
export type CurveChannel = {
  id: string;
  label: string;
  owner: string;
  part: 'transform' | 'vertices' | 'constraints';
  index: number;
  coordinate: Coordinate;
  // Multiplies stored values into the units shown, as with rotations in degrees.
  scale: number;
  track: Track;
};

const TRANSFORM_PART_NAMES = ['Location', 'Rotation', 'Scale'];

function channelsOf(owner: string, part: CurveChannel['part'], vertices: AnimatedVertex[], indices: number[], labelOf: (index: number, coordinate: Coordinate) => string, scaleOf: (index: number) => number): CurveChannel[] {
  return indices.flatMap(index => (isKeyed(vertices[index])
    ? coordinatesIn(vertices[index]).filter(coordinate => typeof vertices[index][coordinate] !== 'number').map((coordinate): CurveChannel => ({
      id: `${owner}/${part}/${index}/${coordinate}`,
      label: labelOf(index, coordinate),
      owner,
      part,
      index,
      coordinate,
      scale: scaleOf(index),
      track: vertices[index][coordinate] as Track,
    }))
    : []));
}

// What the curves editor shows: the animated values of whatever is selected.
export function curveChannels(document: EditorDocument): CurveChannel[] {
  const active = findObject(document, document.activeObject);
  const transformChannels = (node: Constrained) => [
    ...channelsOf(
      node.id, 'transform', transformParts(node), [0, 1, 2],
      (index, coordinate) => `${node.name} ${TRANSFORM_PART_NAMES[index]} ${coordinate.toUpperCase()}`,
      // A quaternion's numbers are not angles.
      index => (index === 1 && node.transform.rotation.w === undefined ? 180 / Math.PI : 1)
    ),
    ...channelsOf(
      node.id, 'constraints', influenceParts(node.constraints), node.constraints.map((_, i) => i),
      index => `${node.name} ${CONSTRAINT_LABELS[node.constraints[index].kind]} Influence`, () => 1
    ),
  ];
  if (document.mode === 'edit' && active) {
    return channelsOf(active.id, 'vertices', active.vertices, Array.from(active.selectedVertices), (index, coordinate) => `Vertex ${index} ${coordinate.toUpperCase()}`, () => 1);
  }
  if (document.mode === 'pose' && active?.bones) {
    return active.bones.filter(bone => document.selectedBones.includes(bone.id)).flatMap(transformChannels);
  }
  return document.objects.filter(object => document.selectedObjects.includes(object.id) && isVisible(document, object)).flatMap(transformChannels);
}

// Changes the vertex or transform part a channel belongs to.
export function updateChannel(document: EditorDocument, { owner, part, index }: CurveChannel, change: (vertex: AnimatedVertex) => AnimatedVertex): EditorDocument {
  const replaced = (vertices: AnimatedVertex[]) => vertices.map((vertex, i) => (i === index ? change(vertex) : vertex));
  if (part === 'vertices') {
    return updateObject(document, owner, object => ({ ...object, vertices: replaced(object.vertices) }));
  }
  if (part === 'constraints') {
    return updateConstraints(document, owner, constraints => withInfluenceParts(constraints, replaced(influenceParts(constraints))));
  }
  return updateTransform(document, owner, transform => {
    const posable = { transform };
    return withTransformParts(posable, replaced(transformParts(posable))).transform;
  });
}

// Applies a key operation to everything a row covers.
export function changeRowKeys(
  document: EditorDocument, row: KeyRow, change: (part: AnimatedVertex[], indices: number[]) => AnimatedVertex[]
): EditorDocument {
  let next = document;
  for (const target of keyTargets(document, row)) {
    const changed = change(partOf(target), target.indices);
    const { part } = target;
    if (part === 'transform' || part === 'vertices') {
      next = updateObject(next, target.object.id, object => (
        part === 'transform' ? withTransformParts(object, changed) : { ...object, vertices: changed }
      ));
    } else if ('constraintsOf' in part) {
      next = updateConstraints(next, part.constraintsOf.id, constraints => withInfluenceParts(constraints, changed));
    } else {
      next = updateBone(next, part.id, bone => withTransformParts(bone, changed));
    }
  }
  return next;
}
