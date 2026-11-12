import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import './slender.css';
import { Ease } from './animation';
import {
  addConstraint, addEllipsoid, addFolder, addObject, boneSegments, bonesInBox, childOfInverse, chooseCamera, clickObject, DEFAULT_FOCAL_LENGTH, deleteFolder, keyConstraintInfluence, setChildOfOn, setConstraintInfluence, setConstraintTarget, setRotationMode, unkeyConstraintInfluence,
  deleteObjects, displayVertices, duplicateObjects, EditorDocument, emptyDocument, findBone, findObject, isVisible, moveToFolder, nodeTransformAt, objectsInBox,
  occlusionTest, parentMatrix, pickBone, pickObject, raycastSurface, removeConstraint, renameFolder, renameObject, resolveObject,
  dropHeldDocumentEdits, isSelectable, DEFAULT_FRAME_RATE, DEFAULT_FRAME_START, selectedVisible, setFrameEnd, setFrameRate, setFrameStart, toggleFolderSelectable, toggleObjectSelectable,
  SceneObject, selectObjects, setParent, toggleFolderVisible, toggleObjectVisible, toLocal, topLevelOnly, toScene, toWorld,
  Transient, transformAt, transformParts, updateConstraint, updateObject, updateTransform, viewFromObject, withTransformParts,
  worldMatrices, worldVertices,
} from './document';
import {
  appendMesh, Axis, AxisLock, AXIS_VECTORS, blendPoints, extrudeSelection, lockVector, regionNormal, subdivideSelection, viewRay, connectedDistances, cursorScale, deleteSelected, duplicateSelection, elementsInBox, falloffWeights, fillSelection, MAX_PITCH, OrbitCamera, orbitAt,
  panOrbit, pickElement, scaledAbout, rotated, rotatedAroundAxis, selectionCenter, selectionPivot, PivotMode, SelectMode, Selection, straightDistances, toCamera,
  translated, translatedAlongAxis, translatedBy, vertexNeighbors, walkStep, worldRotation,
} from './editing';
import { describeTyped, isTypedKey, nextField, TypedInput, typedOffset, typedValue, typeKey } from './typedInput';
import { commit, endStep, History, redo, startHistory, undo } from './history';
import { applyMirror, joinSelected, separateLooseParts, separateSelection } from './joining';
import { AnimatedVertex, commitEdit, coordinatesIn, deleteKeys, DEFAULT_KEYING, keyState, keyedCoordinates, KeyingSet, KEYING_PROPERTIES, midpointVertex, poseAt, writeKeys } from './keyframes';
import { applyMatrix, decompose, invertMatrix, Matrix, matrixOrigin, multiply, rotateRotation, rotationLike, transformMatrix, viewMatrix } from '../../../lib/vrender/matrix';
import { clippedByMirrors, Modifier, newMirror } from './modifiers';
import { Camera, Transform, Vec2, Vec3 } from '../../../lib/vrender/model';
import { projectPoint } from '../../../lib/vrender/project';
import { ConstraintHandlers, hexToRgb, ObjectPane, rgbToHex, Row, Section } from './ObjectPane';
import { Outliner } from './Outliner';
import {
  BoneIcon, CameraIcon, CircleIcon, EllipsoidIcon, ConnectedIcon, EditModeIcon, FaceModeIcon, LineModeIcon, ObjectModeIcon, OverlaysIcon, PlaneIcon,
  PoseModeIcon, ProportionalIcon, RenderIcon, TorusIcon, VertexIcon, VertexModeIcon, WeightModeIcon, WorldIcon, XRayIcon,
} from './icons';
import { AxisGuide, BoneDraw, drawOverlay } from './overlay';
import { PaneDivider } from './PaneDivider';
import { frameTimes, svgAnimation, svgFrame } from '../../../lib/vrender/exporting';
import { NumberField } from './NumberField';
import { FILE_EXTENSION, parseProject, ProjectState, savedCursor, serializeProject, upgradeDocument } from './projectFile';
import { applySnap, SNAP_LABELS, SnapAction } from './snapping';
import { cameraGizmoMesh, circleMesh, cubeMesh, MeshData, planeMesh, torusMesh, vertexMesh } from './primitives';
import { renderScene } from '../../../lib/vrender/render';
import { bonePartners, jointPartners, mirroredJoints, mirroredPose } from './armatureMirror';
import { ArmaturePane, BonePane, Brush, BrushPane, ModifiersPane, VertexGroupsPane } from './RigPanes';
import {
  addArmature, addBone, addVertexGroup, assignToGroup, boneFromJoints, ClearField, clearTransforms, bonesToDelete, deleteBones, duplicateBones, extrudeBones, groupsAfterCopy, groupsAfterDelete, groupsAfterSubdivide,
  PaintTool, paintWeights, parentBones, ParentKind, parentSelected, removeFromGroup, removeVertexGroup, renameBone, renameVertexGroup, selectedBonesOf, setBoneParent, symmetrizeBones,
} from './rigging';
import {
  canWriteFiles, currentTabId, deleteSession, downloadFile, FileHandle, forgetRecent, latestAbandonedSession, loadSession, pickFileToOpen, pickFileToSave, ProjectFile,
  pruneSessions, readHandle, RecentFile, rememberRecent, recentFiles, SessionRecord, writeHandle, writeSession,
} from './storage';
import { KeyEdit } from './CurvesEditor';
import { Timeline } from './Timeline';
import { TransformAxis, TransformField, TransformPanel } from './TransformPanel';

const PICK_RADIUS = 12;
const ORBIT_PER_PIXEL = 0.008;
const ZOOM_PER_WHEEL_PIXEL = 1.001;
const MIN_SCALE = 1e-6;
const MIN_OUTLINER_WIDTH = 160;
const MIN_OBJECT_PANE_HEIGHT = 40;
const MIN_OUTLINER_HEIGHT = 60;
const MIN_TIMELINE_HEIGHT = 40;
const MIN_VIEWPORT_SIZE = 200;
const TOOLBAR_AND_STATUS_HEIGHT = 150;
const AUTOSAVE_INTERVAL_MS = 1000;
const UNTITLED = 'Untitled';
const DEFAULT_ORBIT: OrbitCamera = { target: { x: 0, y: 0, z: 0 }, yaw: -0.6, pitch: -0.45, distance: 800, focalLength: 800 };
const CURVES_MIN_HEIGHT = 300;
const NUMBER_DRAG_STEP = 'number-drag';
const KEY_EDIT_STEP = 'key-edit';
const DEFAULT_LAYOUT: ProjectState['layout'] = { outlinerWidth: 200, timelineHeight: 112, objectPaneHeight: 340, transformPanelOpen: false, propertiesTab: 'object' };
const DEFAULT_BRUSH = { weight: 1, radius: 50, strength: 0.5 };
const SELECT_MODES: { mode: SelectMode; label: string; icon: JSX.Element }[] = [
  { mode: 'vertex', label: 'Vertex', icon: <VertexModeIcon /> },
  { mode: 'line', label: 'Line', icon: <LineModeIcon /> },
  { mode: 'face', label: 'Face', icon: <FaceModeIcon /> },
];
const DEFAULT_PROPORTIONAL_RADIUS = 200;
const PROPORTIONAL_PER_WHEEL_PIXEL = 1.001;
const SELECT_MODE_KEYS: Record<string, SelectMode> = { Digit1: 'vertex', Digit2: 'line', Digit3: 'face' };
const WALK_SPEED = 300;
const WALK_FAST_FACTOR = 4;
const WALK_ZOOM_SECONDS = 0.3;
const WALK_ZOOM_STANDOFF = 0.3;
const WALK_ZOOM_MAX_STANDOFF = 150;
const WALK_LOOK_PER_PIXEL = 0.003;
const WALK_SPEED_PER_WHEEL_PIXEL = 1.002;
const WALK_ORBIT_DISTANCE = 100;
const AXIS_KEYS: Record<string, Axis> = { KeyX: 'x', KeyY: 'y', KeyZ: 'z' };
const DUPLICATE_STEP = 'duplicate';
const EXTRUDE_STEP = 'extrude';
const MIN_OBJECT_FACTOR = 0.001;
const PAINT_STEP = 'weight-paint';
const MIN_BRUSH_RADIUS = 2;
const CLEAR_KEYS: Record<string, ClearField> = { KeyG: 'position', KeyR: 'rotation', KeyS: 'scale' };
const CLEAR_MESSAGES: Record<ClearField, string> = { position: 'Cleared location.', rotation: 'Cleared rotation.', scale: 'Cleared scale.' };

const CREATE_ITEMS: { label: string; icon: JSX.Element; make: () => MeshData }[] = [
  { label: 'Vertex', icon: <VertexIcon />, make: vertexMesh },
  { label: 'Plane', icon: <PlaneIcon />, make: () => planeMesh(100) },
  { label: 'Cube', icon: <ObjectModeIcon />, make: () => cubeMesh(100) },
  { label: 'Circle', icon: <CircleIcon />, make: () => circleMesh(100, 32) },
  { label: 'Torus', icon: <TorusIcon />, make: () => torusMesh(100, 40, 32, 16) },
];

// What a transformation acts on, as it was when the transformation began.
type TransformTarget =
  // distances says how far each vertex is from the selection, when proportional editing is on.
  // modifiers can hold edited vertices back at a mirror.
  | { kind: 'vertices'; id: string; matrix: Matrix; world: Vec3[]; selection: Selection; distances: number[] | null; modifiers: readonly Modifier[]; mirrorJoints: ReadonlyMap<number, number> | null }
  // Objects or bones. Moves are computed in the world, then expressed relative to each one's parent.
  // pinned marks bones connected to their parents, which turn but stay where they are.
  | { kind: 'objects'; ids: string[]; transforms: Transform[]; worldPositions: Vec3[]; parentInverses: Matrix[]; matrices: Matrix[]; pinned?: boolean[]; mirrored?: { source: string; id: string; transform: Transform }[] };

type TransformKind = 'translate' | 'rotate' | 'scale';

type TransformMode = {
  kind: TransformKind;
  target: TransformTarget;
  start: Vec2;
  pivot: Vec2;
  // The point turned or scaled about, when it is not the selection's own center.
  center: Vec3 | null;
  axis: Axis | null;
  // Whether the locked axis is the world's or the thing's own, as pressing the key again chooses.
  space: 'global' | 'local';
  // A direction locked to without any axis key, as when extruding faces.
  normal: Vec3 | null;
  // Set when this transformation continues the undo step of the action that started it.
  step: string | null;
  // Numbers typed, which the pointer has no say over until they are erased.
  typed: TypedInput | null;
};

// What the pointer and keys currently mean.
type Mode =
  | { kind: 'idle' }
  | { kind: 'orbit'; pan: boolean }
  | TransformMode
  // Walks the viewport, or the camera object being looked through.
  | { kind: 'walk'; original: OrbitCamera; cameraId: string | null; transform: Transform | null; parentInverse: Matrix | null }
  | { kind: 'boxArmed' }
  | { kind: 'boxDragging'; start: Vec2 }
  | { kind: 'painting'; tool: PaintTool; neighbors: number[][]; last: Vec2 }
  | { kind: 'brushResizing'; center: Vec2; original: number };

type MenuKind = 'add' | 'parent' | 'boneParent' | 'file' | 'snap' | 'specials' | 'separate';
type Menu = { kind: MenuKind; x: number; y: number };

const PARENT_MENU_LABELS: Record<ParentKind, string> = {
  object: 'Object',
  withoutInverse: 'Object (Without Inverse)',
  armature: 'Armature Deform',
  armatureAuto: 'With Automatic Weights',
  bone: 'Bone',
};

function isTransformMode(mode: Mode): mode is TransformMode {
  return mode.kind === 'translate' || mode.kind === 'rotate' || mode.kind === 'scale';
}

function transformMessage({ kind, axis, space, normal, typed }: Pick<TransformMode, 'kind' | 'axis' | 'space' | 'normal' | 'typed'>): string {
  const action = { translate: 'Moving', rotate: 'Rotating', scale: 'Scaling' }[kind];
  const preposition = kind === 'rotate' ? 'around' : 'along';
  let scope = '';
  if (axis) {
    scope = ` ${preposition} ${space} ${axis.toUpperCase()}`;
  } else if (normal) {
    scope = ` ${preposition} the normal`;
  }
  if (typed) {
    const separate = kind === 'translate' && !axis && !normal;
    return `${action}${scope}: ${describeTyped(typed, separate, { translate: '', rotate: '°', scale: '×' }[kind])}`;
  }
  return `${action}${scope}: X/Y/Z to lock an axis, again for local, left click to confirm, Esc or right click to cancel.`;
}

// A matrix's own axis as a world-space unit vector.
function localAxisOf(matrix: Matrix, axis: Axis): Vec3 {
  const column = { x: 0, y: 1, z: 2 }[axis];
  const [x, y, z] = [matrix[column], matrix[4 + column], matrix[8 + column]];
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

// What the transformation of one of its things is locked to. Things turned differently from each
// other have different local axes.
function lockOf(mode: TransformMode, index: number): AxisLock | null {
  if (!mode.axis) {
    return mode.normal;
  }
  if (mode.space === 'global') {
    return mode.axis;
  }
  return localAxisOf(mode.target.kind === 'vertices' ? mode.target.matrix : mode.target.matrices[index], mode.axis);
}

function transformedPoints(
  mode: TransformMode, axis: AxisLock | null, points: Vec3[], selection: Selection, camera: Camera, point: Vec2, affected: Selection = selection
): Vec3[] {
  const { kind, start } = mode;
  const center = mode.center ?? undefined;
  if (kind === 'scale') {
    return scaledAbout(points, selection, scaleFactor(mode, point), axis, affected, center);
  }
  if (kind === 'translate') {
    if (mode.typed) {
      return translatedBy(points, affected, typedOffset(mode.typed, axis));
    }
    const [dx, dy] = [point.x - start.x, point.y - start.y];
    return axis
      ? translatedAlongAxis(points, selection, camera, axis, dx, dy, affected)
      : translated(points, selection, camera, dx, dy, affected);
  }
  const angle = rotationAngle(mode, axis, camera, point);
  return axis
    ? rotatedAroundAxis(points, selection, camera, axis, angle, affected, center)
    : rotated(points, selection, camera, angle, affected, center);
}

function cursorAngle({ start, pivot }: TransformMode, point: Vec2): number {
  return Math.atan2(point.y - pivot.y, point.x - pivot.x) - Math.atan2(start.y - pivot.y, start.x - pivot.x);
}

// A typed angle means the same whichever way the view faces: clockwise on screen if free, as in
// Blender, and by the right hand about a locked axis, where the turn undoes worldRotation's flip.
function rotationAngle(mode: TransformMode, lock: AxisLock | null, camera: Camera, point: Vec2): number {
  return mode.typed
    ? typedValue(mode.typed, 0, 0) * Math.PI / 180 * worldRotation(camera, lock, 1).angle
    : cursorAngle(mode, point);
}

function scaleFactor(mode: TransformMode, point: Vec2): number {
  return mode.typed ? typedValue(mode.typed, 0, 1) : cursorScale(mode.start, point, mode.pivot);
}

// An object's scale can come near zero but not reach it, since its children need its inverse.
function objectFactor(factor: number): number {
  return Math.abs(factor) < MIN_OBJECT_FACTOR ? MIN_OBJECT_FACTOR : factor;
}

// A world direction as seen from inside a parent, as a unit vector.
function axisInParent(parentInverse: Matrix, { x, y, z }: Vec3): Vec3 {
  const [m0, m1, m2, , m4, m5, m6, , m8, m9, m10] = parentInverse;
  const axis = { x: m0 * x + m1 * y + m2 * z, y: m4 * x + m5 * y + m6 * z, z: m8 * x + m9 * y + m10 * z };
  const length = Math.hypot(axis.x, axis.y, axis.z);
  return { x: axis.x / length, y: axis.y / length, z: axis.z / length };
}

// An object's scale after scaling. An object scales along its own axes, so a locked global axis
// applies to whichever of them lines up with it best.
function scaledTransform({ rotation, scale }: Transform, parentInverse: Matrix, axis: Axis | null, factor: number): Vec3 {
  if (!axis) {
    return { x: scale.x * factor, y: scale.y * factor, z: scale.z * factor };
  }
  const direction = axisInParent(parentInverse, AXIS_VECTORS[axis]);
  const m = transformMatrix({ position: { x: 0, y: 0, z: 0 }, rotation, scale: { x: 1, y: 1, z: 1 } });
  const alignment = (i: number) => Math.abs(m[i] * direction.x + m[4 + i] * direction.y + m[8 + i] * direction.z);
  const local = (['x', 'y', 'z'] as const).reduce((best, name, i) => (alignment(i) > alignment(['x', 'y', 'z'].indexOf(best)) ? name : best));
  return { ...scale, [local]: scale[local] * factor };
}

// How large a world radius at a point appears in the image, centered where the transformation pivots.
function influenceCircle(center: Vec2, world: Vec3, radius: number, camera: Camera) {
  const depth = applyMatrix(viewMatrix(camera), world.x, world.y, world.z).z;
  return { center, radius: radius * camera.focalLength / Math.max(depth, 1) };
}

// What a transformation in progress leaves things as, at a pointer position.
function computeTransient(mode: TransformMode, camera: Camera, point: Vec2, proportionalRadius: number | null): Transient {
  const { target } = mode;
  if (target.kind === 'vertices') {
    const clipped = (world: Vec3[]) => clippedByMirrors(toLocal(target.matrix, world), toLocal(target.matrix, target.world), target.modifiers);
    const finished = (world: Vec3[], affected: Selection): Transient => {
      const local = clipped(world);
      return { kind: 'vertices', id: target.id, ...(target.mirrorJoints ? mirroredJoints(local, target.selection, affected, target.mirrorJoints) : { local, affected }) };
    };
    if (proportionalRadius === null || !target.distances) {
      const world = transformedPoints(mode, lockOf(mode, 0), target.world, target.selection, camera, point);
      return finished(world, target.selection);
    }
    const weights = falloffWeights(target.distances, proportionalRadius);
    const affected = new Set(weights.flatMap((weight, i) => (weight > 0 ? [i] : [])));
    const full = transformedPoints(mode, lockOf(mode, 0), target.world, target.selection, camera, point, affected);
    return finished(blendPoints(target.world, full, weights), affected);
  }

  const everything = new Set(target.worldPositions.map((_, i) => i));
  const isLocal = mode.axis !== null && mode.space === 'local';
  // Locked to a shared direction, things move as a group. Each to its own axis, each moves alone.
  const moved = isLocal ? [] : transformedPoints(mode, lockOf(mode, 0), target.worldPositions, everything, camera, point);
  const transforms = new Map<string, Transform>();
  target.ids.forEach((id, i) => {
    const original = target.transforms[i];
    const inverse = target.parentInverses[i];
    const lock = lockOf(mode, i);
    const place = isLocal ? transformedPoints(mode, lock, [target.worldPositions[i]], new Set([0]), camera, point)[0] : moved[i];
    const turn = mode.kind === 'rotate' ? worldRotation(camera, lock, rotationAngle(mode, lock, camera, point)) : null;
    const factor = objectFactor(scaleFactor(mode, point));
    const scale = isLocal
      ? { ...original.scale, [mode.axis!]: original.scale[mode.axis!] * factor }
      : scaledTransform(original, inverse, mode.axis, factor);
    transforms.set(id, {
      ...original,
      position: target.pinned?.[i] ? original.position : applyMatrix(inverse, place.x, place.y, place.z),
      rotation: turn ? rotateRotation(original.rotation, axisInParent(inverse, turn.axis), turn.angle) : original.rotation,
      scale: mode.kind === 'scale' ? scale : original.scale,
    });
  });
  target.mirrored?.forEach(({ source, id, transform }) => transforms.set(id, mirroredPose(transforms.get(source)!, transform)));
  return { kind: 'objects', transforms };
}

// Writes a finished transformation into the document, keying whatever is already animated.
function commitTransient(document: EditorDocument, transient: Transient, time: number): EditorDocument {
  if (transient.kind === 'vertices') {
    return updateObject(document, transient.id, object => ({
      ...object,
      vertices: commitEdit(object.vertices, transient.affected, transient.local, time),
    }));
  }
  let next = document;
  transient.transforms.forEach(({ position, rotation, scale }, id) => {
    next = updateTransform(next, id, transform => {
      const posable = { transform };
      return withTransformParts(posable, commitEdit(transformParts(posable), new Set([0, 1, 2]), [position, rotation, scale], time)).transform;
    });
  });
  return next;
}

// Which modes an object can be in, besides object mode.
function modeSupports(object: SceneObject, mode: EditorDocument['mode']): boolean {
  if (object.camera || object.ellipsoid) {
    return mode === 'object';
  }
  return mode !== (object.bones ? 'weight' : 'pose');
}

function selectBone(document: EditorDocument, id: string, additive: boolean): EditorDocument {
  if (!additive) {
    return { ...document, selectedBones: [id], activeBone: id };
  }
  return document.selectedBones.includes(id)
    ? { ...document, selectedBones: document.selectedBones.filter(other => other !== id) }
    : { ...document, selectedBones: [...document.selectedBones, id], activeBone: id };
}

// What Ctrl+P offers. An active armature adds its ways of bending meshes, and its active bone.
function parentKinds(document: EditorDocument, active: SceneObject | null): ParentKind[] {
  if (!active?.bones) {
    return ['object', 'withoutInverse'];
  }
  const hasBone = active.bones.some(bone => bone.id === document.activeBone);
  return ['object', 'withoutInverse', 'armature', 'armatureAuto', ...(hasBone ? ['bone' as const] : [])];
}

function initialDocument(): EditorDocument {
  return addObject(emptyDocument(), 'Cube', cubeMesh(100));
}

export const Editor = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [message, setMessage] = useState('Tab to edit the active object. Shift+A to add. Right click to select.');
  const [, setVersion] = useState(0);
  const [outlinerWidth, setOutlinerWidth] = useState(DEFAULT_LAYOUT.outlinerWidth);
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_LAYOUT.timelineHeight);
  const [objectPaneHeight, setObjectPaneHeight] = useState(DEFAULT_LAYOUT.objectPaneHeight);
  const [transformPanelOpen, setTransformPanelOpen] = useState(DEFAULT_LAYOUT.transformPanelOpen);
  const [propertiesTab, setPropertiesTab] = useState(DEFAULT_LAYOUT.propertiesTab);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [recoverable, setRecoverable] = useState<SessionRecord | null>(null);
  const rerender = () => setVersion(version => version + 1);

  const historyRef = useRef<History<EditorDocument>>(startHistory(initialDocument()));
  const orbitRef = useRef<OrbitCamera>(DEFAULT_ORBIT);
  const modeRef = useRef<Mode>({ kind: 'idle' });
  const transientRef = useRef<Transient | null>(null);
  const mouseRef = useRef<Vec2>({ x: 0, y: 0 });
  const dirtyRef = useRef(true);
  const timeRef = useRef(DEFAULT_FRAME_START / DEFAULT_FRAME_RATE);
  // Where playback really is between whole frames, while playing.
  const playClockRef = useRef<number | null>(null);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menu !== null;
  const playingRef = useRef(false);
  // Where new things appear and what Shift+S snaps to, in world space. This is a way of working, like
  // the view, so undo and the unsaved changes mark ignore it.
  const cursorRef = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  // The camera object being looked through, if any. This is a way of viewing, so undo ignores it.
  const viewedCameraRef = useRef<string | null>(null);
  const walkOrbitRef = useRef<OrbitCamera | null>(null);
  const walkKeysRef = useRef(new Set<string>());
  const walkSpeedRef = useRef(WALK_SPEED);
  const walkFastRef = useRef(false);
  const walkZoomRef = useRef<{ direction: Vec3; distance: number; covered: number; elapsed: number } | null>(null);
  const pointerWasLockedRef = useRef(false);
  const selectModeRef = useRef<SelectMode>('vertex');
  const showOverlaysRef = useRef(true);
  const xRayRef = useRef(false);
  const proportionalRef = useRef(false);
  const proportionalRadiusRef = useRef(DEFAULT_PROPORTIONAL_RADIUS);
  const proportionalConnectedRef = useRef(false);
  const pivotModeRef = useRef<PivotMode>('median');
  const keyingRef = useRef<KeyingSet>(DEFAULT_KEYING);
  const brushRef = useRef<Brush>(DEFAULT_BRUSH);
  const fileRef = useRef<ProjectFile | null>(null);
  // The snapshot that matches the file on disk. Undoing back to it means nothing is unsaved.
  const savedDocumentRef = useRef(historyRef.current.present);
  const layoutRef = useRef(DEFAULT_LAYOUT);
  layoutRef.current = { outlinerWidth, timelineHeight, objectPaneHeight, transformPanelOpen, propertiesTab };
  const currentProportionalRadius = () => (proportionalRef.current ? proportionalRadiusRef.current : null);

  const currentDocument = () => historyRef.current.present;
  // Bones along with their other sides, if the active armature mirrors its poses.
  const withPosePartners = (document: EditorDocument, ids: string[], time: number): string[] => {
    const armature = findObject(document, document.activeObject);
    if (!armature?.bones || !armature.mirrorPose) {
      return ids;
    }
    const partners = bonePartners(armature, poseAt(armature.vertices, time));
    return Array.from(new Set(ids.flatMap(id => [id, ...(partners.has(id) ? [partners.get(id)!] : [])])));
  };
  const hasUnsavedChanges = () => currentDocument() !== savedDocumentRef.current;
  const activeObject = () => findObject(currentDocument(), currentDocument().activeObject);
  const viewedCamera = () => {
    const viewed = findObject(currentDocument(), viewedCameraRef.current);
    return viewed?.camera ? viewed : null;
  };
  // Picking and transformations use the view as committed. If they followed a transformation of
  // the camera being looked through, its movement would feed back into itself.
  const camera = (): Camera => {
    const viewed = viewedCamera();
    return viewed ? viewFromObject(currentDocument(), viewed, timeRef.current, null) : toCamera(orbitRef.current);
  };
  const isTransforming = () => isTransformMode(modeRef.current) || modeRef.current.kind === 'walk';

  const refresh = () => {
    dirtyRef.current = true;
    rerender();
  };

  const apply = (next: EditorDocument, step: string | null = null) => {
    historyRef.current = commit(historyRef.current, next, step);
    refresh();
  };

  // Leaving a frame discards edits made there without a key. That is no step to undo, and if the
  // saved document held the same edits, nothing has been changed since saving.
  const moveTime = (time: number) => {
    if (Math.abs(time - timeRef.current) >= 1e-6) {
      const { present } = historyRef.current;
      const next = dropHeldDocumentEdits(present);
      if (next !== present) {
        historyRef.current = { ...historyRef.current, present: next };
        if (savedDocumentRef.current === present) {
          savedDocumentRef.current = next;
        }
      }
    }
    timeRef.current = time;
  };

  const seek = (time: number) => {
    if (!isTransforming()) {
      moveTime(time);
      playClockRef.current = null;
      refresh();
    }
  };

  const togglePlaying = () => {
    if (!isTransforming()) {
      playingRef.current = !playingRef.current;
      playClockRef.current = null;
      rerender();
    }
  };

  const insertKey = () => {
    const document = currentDocument();
    const time = timeRef.current;
    const keying = keyingRef.current;
    const partCoordinates = (part: number) => keyedCoordinates(keying, KEYING_PROPERTIES[part]);
    if (document.mode !== 'edit' ? KEYING_PROPERTIES.every((_, part) => partCoordinates(part).length === 0) : partCoordinates(0).length === 0) {
      setMessage(document.mode === 'edit' ? 'Vertices key their location, and no Location axis is on.' : 'No properties are on to key.');
      return;
    }
    if (document.mode === 'pose') {
      if (document.selectedBones.length === 0) {
        setMessage('Select bones to key.');
        return;
      }
      apply(withPosePartners(document, document.selectedBones, time).reduce((next, id) => updateTransform(next, id, transform => {
        const posable = { transform };
        const parts = transformParts(posable);
        return withTransformParts(posable, writeKeys(parts, [0, 1, 2], poseAt(parts, time), time, partCoordinates)).transform;
      }), document));
      setMessage(`Keyed ${document.selectedBones.length} bones at frame ${Math.round(time * document.frameRate)}.`);
      return;
    }
    if (document.mode === 'edit') {
      const object = activeObject();
      if (object?.bones) {
        setMessage('Bones rest in edit mode. Key them in pose mode.');
        return;
      }
      if (!object || object.selectedVertices.size === 0) {
        setMessage('Select vertices to key.');
        return;
      }
      const vertices = writeKeys(object.vertices, object.selectedVertices, poseAt(object.vertices, time), time, () => partCoordinates(0));
      apply(updateObject(document, object.id, current => ({ ...current, vertices })));
      setMessage(`Keyed ${object.selectedVertices.size} vertices at frame ${Math.round(time * document.frameRate)}.`);
      return;
    }
    const chosen = selectedVisible(document);
    if (chosen.length === 0) {
      setMessage('Select objects to key.');
      return;
    }
    let next = document;
    for (const id of chosen) {
      next = updateObject(next, id, object => {
        const parts = transformParts(object);
        return withTransformParts(object, writeKeys(parts, [0, 1, 2], poseAt(parts, time), time, partCoordinates));
      });
    }
    apply(next);
    setMessage(`Keyed ${chosen.length} objects at frame ${Math.round(time * document.frameRate)}.`);
  };

  // I with the pointer over a property keys it, whole and whatever the keying buttons say, or removes
  // the key if it is on one with no change to keep. Alt+I only removes. Returns whether it was over
  // one. Asking the page what is under the pointer means a field that has since gone away cannot be
  // left standing as the hovered one.
  const keyHoveredProperty = (onlyRemove: boolean): boolean => {
    const hovered = window.document.querySelector<HTMLElement>('[data-key-property]:hover');
    if (!hovered) {
      return false;
    }
    const property = JSON.parse(hovered.dataset.keyProperty!);
    const document = currentDocument();
    const time = timeRef.current;
    const numbersOf = (vertices: AnimatedVertex[]) => vertices.flatMap(vertex => coordinatesIn(vertex).map(coordinate => vertex[coordinate]));
    const node = property.id && (findBone(document, property.id)?.bone ?? findObject(document, property.id));
    const constraint = property.kind === 'influence' ? node?.constraints.find((candidate: { id: string }) => candidate.id === property.constraintId) : undefined;
    const object = activeObject();
    let numbers: ReturnType<typeof numbersOf> = [];
    if (property.kind === 'transform') {
      numbers = numbersOf([transformParts(node)[property.part]]);
    } else if (constraint) {
      numbers = [constraint.influence];
    } else if (object) {
      numbers = numbersOf(Array.from(object.selectedVertices).map(i => object.vertices[i]));
    }
    const remove = onlyRemove || keyState(numbers, time) === 'keyed';
    if (property.kind === 'transform') {
      const part: number = property.part;
      apply(updateTransform(document, property.id, transform => {
        const posable = { transform };
        const parts = transformParts(posable);
        return withTransformParts(posable, remove ? deleteKeys(parts, [part], time) : writeKeys(parts, [part], poseAt(parts, time), time)).transform;
      }));
    } else if (property.kind === 'influence') {
      // Parented is a switch, so its keys hold until the next.
      const isSwitch = constraint?.kind === 'childOf';
      apply(remove
        ? unkeyConstraintInfluence(document, property.id, property.constraintId, time)
        : keyConstraintInfluence(document, property.id, property.constraintId, time, undefined, isSwitch));
    } else {
      if (object) {
        apply(updateObject(document, object.id, current => ({
          ...current,
          vertices: remove ? deleteKeys(current.vertices, current.selectedVertices, time) : writeKeys(current.vertices, current.selectedVertices, poseAt(current.vertices, time), time),
        })));
      }
    }
    setMessage(`${remove ? 'Removed the key' : 'Keyed'} at frame ${Math.round(time * document.frameRate)}.`);
    return true;
  };

  // An edit of keys that follows the pointer. Each preview starts over from where it began, and the
  // whole of it is one undo step, or none if cancelled.
  const beginKeyEdit = (): KeyEdit => {
    historyRef.current = endStep(historyRef.current);
    const base = currentDocument();
    return {
      preview: change => apply(change(base), KEY_EDIT_STEP),
      confirm: () => {
        historyRef.current = endStep(historyRef.current);
        refresh();
      },
      cancel: () => {
        if (currentDocument() !== base) {
          historyRef.current = { ...undo(historyRef.current), future: [] };
        }
        refresh();
      },
    };
  };

  const changeStyle = (field: string, change: (object: SceneObject) => SceneObject) => {
    const object = activeObject();
    if (object) {
      apply(updateObject(currentDocument(), object.id, change), `style:${object.id}:${field}`);
    }
  };

  const addPrimitive = (label: string, make: () => MeshData) => {
    const document = currentDocument();
    const object = activeObject();
    setMenu(null);
    if (document.mode === 'object' || !object) {
      apply(addObject(document, label, make(), null, cursorRef.current));
      setMessage(`Added ${label}. G to move it.`);
      return;
    }
    // New geometry appears at the cursor, which is a world position.
    const added = make();
    const cursor = cursorRef.current;
    const matrix = worldMatrices(document, timeRef.current).get(object.id)!;
    const placed = toLocal(matrix, added.vertices.map(({ x, y, z }) => ({ x: x + cursor.x, y: y + cursor.y, z: z + cursor.z })));
    const { mesh, addedVertices } = appendMesh({ vertices: poseAt(object.vertices, timeRef.current), faces: object.faces, edges: object.edges }, { ...added, vertices: placed });
    apply(updateObject(document, object.id, current => ({
      ...current,
      vertices: [...current.vertices, ...mesh.vertices.slice(current.vertices.length)],
      faces: mesh.faces,
      edges: mesh.edges,
      selectedVertices: addedVertices,
    })));
    setMessage(`Added ${label} to ${object.name}. G to move it.`);
  };

  const pickFromOutliner = (id: string, additive: boolean) => {
    if (isTransforming()) {
      return;
    }
    const document = currentDocument();
    if (document.mode === 'object') {
      apply(clickObject(document, id, additive));
    } else {
      // Outside object mode, the outliner chooses which object the mode is working on, if it can.
      apply({ ...selectObjects(document, [id], id), mode: modeSupports(findObject(document, id)!, document.mode) ? document.mode : 'object', selectedBones: [] });
    }
  };

  const pickBoneFromOutliner = (armatureId: string, boneId: string, additive: boolean) => {
    if (isTransforming()) {
      return;
    }
    const document = currentDocument();
    const armature = findObject(document, armatureId)!;
    const bone = armature.bones!.find(candidate => candidate.id === boneId)!;
    if (document.activeObject === armatureId && document.mode === 'edit') {
      const joints = new Set(additive ? armature.selectedVertices : []);
      joints.add(bone.head);
      joints.add(bone.tail);
      apply({ ...updateObject(document, armatureId, current => ({ ...current, selectedVertices: joints })), activeBone: boneId });
    } else if (document.activeObject === armatureId && document.mode === 'pose') {
      apply(selectBone(document, boneId, additive));
    } else {
      apply({ ...selectObjects(document, [armatureId], armatureId), mode: 'object', activeBone: boneId, selectedBones: [boneId] });
    }
  };

  const toggleCameraView = () => {
    if (viewedCamera()) {
      viewedCameraRef.current = null;
      setMessage('Left camera view.');
    } else {
      const chosen = chooseCamera(currentDocument());
      if (!chosen) {
        setMessage('Add a camera first, with Shift+A in object mode.');
        return;
      }
      viewedCameraRef.current = chosen.id;
      setMessage(`Looking through ${chosen.name}. G, R and Shift+F move it. Numpad 0 to leave.`);
    }
    refresh();
  };

  const changeCursor = (axis: 'x' | 'y' | 'z', value: number) => {
    cursorRef.current = { ...cursorRef.current, [axis]: value };
    refresh();
  };

  const changeTransformField = (field: TransformField, axis: TransformAxis, value: number, dragging = false) => {
    const document = currentDocument();
    const object = activeObject();
    // In pose mode, the panel shows the active bone.
    const id = document.mode === 'pose' ? document.activeBone : object?.id;
    // Zero scale cannot be undone by any later transform, and has no inverse to edit vertices through.
    if (!id || (field === 'scale' && Math.abs(value) < MIN_SCALE)) {
      setMessage('Scale cannot be zero.');
      refresh();
      return;
    }
    const time = timeRef.current;
    const pose = nodeTransformAt(document, id, time);
    const next = { ...pose, [field]: { ...pose[field], [axis]: value } };
    const written = (current: EditorDocument, node: string, value: Transform) => updateTransform(current, node, transform => {
      const posable = { transform };
      return withTransformParts(posable, commitEdit(transformParts(posable), new Set([0, 1, 2]), [value.position, value.rotation, value.scale], time)).transform;
    });
    const others = document.mode === 'pose' ? withPosePartners(document, [id], time).filter(other => other !== id && !document.selectedBones.includes(other)) : [];
    apply(others.reduce(
      (current, other) => written(current, other, mirroredPose(next, nodeTransformAt(document, other, time))),
      written(document, id, next),
    ), dragging ? NUMBER_DRAG_STEP : null);
  };

  const endDragStep = () => {
    historyRef.current = endStep(historyRef.current);
  };

  const changeVertexMedian = (axis: 'x' | 'y' | 'z', value: number, dragging = false) => {
    const object = activeObject();
    if (!object || object.selectedVertices.size === 0) {
      return;
    }
    const time = timeRef.current;
    const pose = poseAt(object.vertices, time);
    const offset = value - selectionCenter(pose, object.selectedVertices)[axis];
    const next = pose.map((vertex, i) => (object.selectedVertices.has(i) ? { ...vertex, [axis]: vertex[axis] + offset } : vertex));
    const { local, affected } = object.bones && object.mirrorEdit
      ? mirroredJoints(next, object.selectedVertices, object.selectedVertices, jointPartners(object, pose))
      : { local: next, affected: object.selectedVertices };
    apply(updateObject(currentDocument(), object.id, current => ({
      ...current,
      vertices: commitEdit(current.vertices, affected, local, time),
    })), dragging ? NUMBER_DRAG_STEP : null);
  };

  // Keys keep their frames when the rate changes, so the current frame should too.
  const changeFrameRate = (value: number, dragging = false) => {
    const document = currentDocument();
    const next = setFrameRate(document, value);
    timeRef.current *= document.frameRate / next.frameRate;
    playClockRef.current = null;
    apply(next, dragging ? NUMBER_DRAG_STEP : null);
  };

  const changeFrameStart = (value: number, dragging = false) => apply(setFrameStart(currentDocument(), value), dragging ? NUMBER_DRAG_STEP : null);
  const changeFrameEnd = (value: number, dragging = false) => apply(setFrameEnd(currentDocument(), value), dragging ? NUMBER_DRAG_STEP : null);

  // Exports see what the scene's camera sees, or the viewport without one, at the viewport's size.
  const exportFrames = (keepHeldEdits = false) => {
    // An animation is what the keys say. An edit not keyed shows only in a picture of its own frame.
    const document = keepHeldEdits ? currentDocument() : dropHeldDocumentEdits(currentDocument());
    const canvas = canvasRef.current!;
    const size = { width: Math.round(canvas.clientWidth), height: Math.round(canvas.clientHeight) };
    const chosen = chooseCamera(document);
    const sceneAt = (time: number) => toScene(document, chosen ? viewFromObject(document, chosen, time, null) : toCamera(orbitRef.current), time, null);
    const times = frameTimes(document.frameStart, document.frameEnd, document.frameRate);
    const baseName = (fileRef.current?.name ?? UNTITLED).replace(new RegExp(`\\${FILE_EXTENSION}$`), '');
    return { document, size, sceneAt, times, baseName, viewSource: chosen ? chosen.name : 'the viewport' };
  };

  const exportFrameSvg = () => {
    setMenu(null);
    const { size, sceneAt, baseName, viewSource } = exportFrames(true);
    downloadFile(`${baseName}.svg`, svgFrame(sceneAt(timeRef.current), size), 'image/svg+xml');
    setMessage(`Exported this frame from ${viewSource}.`);
  };

  const exportAnimationSvg = () => {
    setMenu(null);
    const { document, size, sceneAt, times, baseName, viewSource } = exportFrames();
    downloadFile(`${baseName}-animation.svg`, svgAnimation(sceneAt, times, document.frameRate, size), 'image/svg+xml');
    setMessage(`Exported ${times.length} frames from ${viewSource} as one animated SVG.`);
  };

  // A recording runs on the clock, so this takes as long as the animation does.
  const exportVideo = () => {
    setMenu(null);
    const { document, size, sceneAt, times, baseName, viewSource } = exportFrames();
    const canvas = window.document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof MediaRecorder === 'undefined') {
      setMessage('This browser cannot record video.');
      return;
    }
    const view = { panX: size.width / 2, panY: size.height / 2, zoom: 1 };
    const recorder = new MediaRecorder(canvas.captureStream(document.frameRate), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    recorder.onstop = () => {
      downloadFile(`${baseName}.webm`, new Blob(chunks, { type: 'video/webm' }));
      setMessage(`Exported ${times.length} frames from ${viewSource} as video.`);
    };
    setMessage(`Recording ${times.length} frames from ${viewSource}. This takes as long as the animation.`);
    let frame = 0;
    const started = performance.now();
    renderScene(ctx, sceneAt(times[0]), view, 1);
    recorder.start();
    const step = () => {
      const due = Math.floor((performance.now() - started) / 1000 * document.frameRate);
      if (due >= times.length) {
        recorder.stop();
        return;
      }
      if (due !== frame) {
        frame = due;
        renderScene(ctx, sceneAt(times[frame]), view, 1);
      }
      window.setTimeout(step, 1000 / document.frameRate / 2);
    };
    step();
  };

  const snap = (action: SnapAction) => {
    setMenu(null);
    const document = currentDocument();
    const { document: next, cursor } = applySnap(document, action, timeRef.current, cursorRef.current);
    if (next === document && cursor === cursorRef.current) {
      setMessage('Nothing selected to snap.');
    } else {
      cursorRef.current = cursor;
      apply(next);
      setMessage(`${SNAP_LABELS[action]}.`);
      refresh();
    }
  };

  // Splits selected lines at their middles. New vertices follow their ends when those are animated.
  const subdivide = () => {
    setMenu(null);
    const document = currentDocument();
    const object = activeObject();
    if (document.mode !== 'edit' || !object || object.bones) {
      return;
    }
    const { faces, edges, splits, selection } = subdivideSelection({ vertices: poseAt(object.vertices, timeRef.current), faces: object.faces, edges: object.edges }, object.selectedVertices);
    if (splits.length === 0) {
      setMessage('Select at least one line, or two connected vertices, to subdivide.');
      return;
    }
    apply(updateObject(document, object.id, current => ({
      ...current,
      vertices: [...current.vertices, ...splits.map(([a, b]) => midpointVertex(current.vertices[a], current.vertices[b]))],
      faces,
      edges,
      selectedVertices: selection,
      vertexGroups: groupsAfterSubdivide(current.vertexGroups, splits, current.vertices.length),
    })));
    setMessage(`Subdivided ${splits.length} ${splits.length === 1 ? 'line' : 'lines'}.`);
  };

  // P in edit mode. The separated parts stay selected as objects, for when edit mode ends.
  const separate = (byLooseParts: boolean) => {
    setMenu(null);
    const document = currentDocument();
    const object = activeObject();
    if (document.mode !== 'edit' || !object || object.bones || object.camera) {
      return;
    }
    const next = byLooseParts ? separateLooseParts(document, object.id, timeRef.current) : separateSelection(document, object.id, timeRef.current);
    if (next === document) {
      setMessage(byLooseParts ? 'This mesh is all one piece.' : 'Select part of the mesh to separate, not none or all of it.');
      return;
    }
    apply(next);
    setMessage(`Separated ${next.objects.length - document.objects.length} ${next.objects.length - document.objects.length === 1 ? 'object' : 'objects'} from ${object.name}.`);
  };

  const modifierHandlers = (object: SceneObject) => {
    const changed = (change: (modifiers: Modifier[]) => Modifier[], step: string | null = null) => apply(
      updateObject(currentDocument(), object.id, current => ({ ...current, modifiers: change(current.modifiers ?? []) })), step
    );
    return {
      onAddMirror: () => {
        const document = currentDocument();
        apply({
          ...updateObject(document, object.id, current => ({ ...current, modifiers: [...(current.modifiers ?? []), newMirror(`modifier-${document.nextId}`)] })),
          nextId: document.nextId + 1,
        });
      },
      onChange: (id: string, change: Partial<Modifier>, dragging = false) => changed(modifiers => modifiers.map(modifier => (modifier.id === id ? { ...modifier, ...change } : modifier)), dragging ? NUMBER_DRAG_STEP : null),
      onApply: (id: string) => apply(applyMirror(currentDocument(), object.id, id, timeRef.current)),
      onRemove: (id: string) => changed(modifiers => modifiers.filter(modifier => modifier.id !== id)),
    };
  };

  const toggleEditMode = () => {
    const document = currentDocument();
    if (document.mode === 'edit') {
      apply({ ...document, mode: 'object' });
      setMessage('Object mode.');
    } else if (activeObject()?.camera) {
      setMessage('A camera has no mesh to edit.');
    } else if (activeObject()?.ellipsoid) {
      setMessage('An ellipsoid has no mesh to edit. Its radii and length are in the object pane.');
    } else if (activeObject() && !isVisible(document, activeObject()!)) {
      setMessage('Show the object to edit it.');
    } else if (activeObject()) {
      apply({ ...document, mode: 'edit', selectedObjects: Array.from(new Set([...document.selectedObjects, document.activeObject!])) });
      setMessage(`Editing ${activeObject()!.name}.`);
    } else {
      setMessage('Select an object to edit first.');
    }
    refresh();
  };

  // Pose mode is for armatures and weight painting for meshes. Tab goes to edit mode from either.
  const enterMode = (mode: EditorDocument['mode']) => {
    const document = currentDocument();
    const object = activeObject();
    if (object && mode !== 'object' && !isVisible(document, object)) {
      setMessage('Show the object first.');
    } else if (mode === 'object' || (object && modeSupports(object, mode))) {
      apply({ ...document, mode });
      setMessage({ object: 'Object mode.', edit: 'Edit mode.', pose: 'Pose mode.', weight: 'Weight paint: left drag paints, Ctrl subtracts, Shift smooths, F sets the radius, right click a bone picks its group.' }[mode]);
      refresh();
    } else {
      setMessage(mode === 'pose' ? 'Select an armature to pose.' : 'Select a mesh to paint.');
    }
  };

  // Blender's Ctrl+Tab, which browsers keep for themselves, so Shift+Tab does the same here.
  const togglePoseOrWeight = () => {
    const document = currentDocument();
    const object = activeObject();
    if (object?.camera || object?.ellipsoid || !object) {
      setMessage('Select an armature to pose or a mesh to paint.');
    } else {
      const special = object.bones ? 'pose' : 'weight';
      enterMode(document.mode === special ? 'object' : special);
    }
  };

  const constraintHandlers = (id: string): ConstraintHandlers => ({
    onAdd: kind => apply(addConstraint(currentDocument(), id, kind)),
    onSetTarget: (constraintId, target) => apply(setConstraintTarget(currentDocument(), id, constraintId, target, timeRef.current)),
    onSetInfluence: (constraintId, influence) => apply(setConstraintInfluence(currentDocument(), id, constraintId, influence, timeRef.current), `influence:${constraintId}`),
    onRemove: constraintId => apply(removeConstraint(currentDocument(), id, constraintId)),
    onSetInverse: constraintId => {
      const document = currentDocument();
      const node = findBone(document, id)?.bone ?? findObject(document, id);
      const target = node?.constraints.find(candidate => candidate.id === constraintId)?.target ?? null;
      apply(updateConstraint(document, id, constraintId, { inverse: childOfInverse(document, target, timeRef.current) }));
    },
    onClearInverse: constraintId => apply(updateConstraint(currentDocument(), id, constraintId, { inverse: undefined })),
    onSetOn: (constraintId, on) => apply(setChildOfOn(currentDocument(), id, constraintId, on, timeRef.current)),
    onChange: (constraintId, change, dragging) => apply(updateConstraint(currentDocument(), id, constraintId, change), dragging ? NUMBER_DRAG_STEP : null),
  });

  const chooseParent = (kind: ParentKind) => {
    setMenu(null);
    const { document, parented, refused } = parentSelected(currentDocument(), kind, timeRef.current);
    apply(document);
    const active = activeObject();
    setMessage(refused > 0 ? `Parented ${parented}. ${refused} refused: that would make a loop.` : `Parented ${parented} to ${active?.name}.`);
  };

  const chooseBoneParent = (connected: boolean) => {
    setMenu(null);
    const object = activeObject();
    if (object) {
      apply(parentBones(currentDocument(), object.id, connected));
      setMessage(connected ? 'Connected to the active bone.' : 'Parented to the active bone, keeping the offset.');
    }
  };

  const captureState = (): Omit<ProjectState, 'document'> => ({
    view: { orbit: orbitRef.current, viewedCamera: viewedCameraRef.current, time: timeRef.current, cursor: cursorRef.current },
    layout: layoutRef.current,
    settings: {
      selectMode: selectModeRef.current,
      showOverlays: showOverlaysRef.current,
      xRay: xRayRef.current,
      proportional: proportionalRef.current,
      proportionalRadius: proportionalRadiusRef.current,
      proportionalConnected: proportionalConnectedRef.current,
      pivot: pivotModeRef.current,
      keying: keyingRef.current,
      brush: brushRef.current,
    },
  });

  // Replaces everything being worked on. A layout from a larger window is fitted to this one.
  const restore = (state: Omit<ProjectState, 'document'>, stored: History<EditorDocument>, file: ProjectFile | null, saved: EditorDocument) => {
    // Sessions autosaved before a field existed need it filled in, in every undo step.
    const upgrade = (document: EditorDocument) => upgradeDocument(document, state.view.duration);
    historyRef.current = { ...stored, present: upgrade(stored.present), past: stored.past.map(upgrade), future: stored.future.map(upgrade) };
    fileRef.current = file;
    savedDocumentRef.current = upgrade(saved);
    modeRef.current = { kind: 'idle' };
    transientRef.current = null;
    playingRef.current = false;
    orbitRef.current = state.view.orbit;
    viewedCameraRef.current = state.view.viewedCamera;
    cursorRef.current = savedCursor(state.view, stored.present);
    timeRef.current = state.view.time;
    playClockRef.current = null;
    selectModeRef.current = state.settings.selectMode;
    showOverlaysRef.current = state.settings.showOverlays;
    xRayRef.current = state.settings.xRay;
    proportionalRef.current = state.settings.proportional;
    proportionalRadiusRef.current = state.settings.proportionalRadius;
    proportionalConnectedRef.current = state.settings.proportionalConnected;
    pivotModeRef.current = state.settings.pivot ?? 'median';
    keyingRef.current = state.settings.keying ?? DEFAULT_KEYING;
    brushRef.current = state.settings.brush;
    const fit = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
    const timeline = fit(state.layout.timelineHeight, MIN_TIMELINE_HEIGHT, window.innerHeight - MIN_VIEWPORT_SIZE - TOOLBAR_AND_STATUS_HEIGHT);
    setOutlinerWidth(fit(state.layout.outlinerWidth, MIN_OUTLINER_WIDTH, window.innerWidth - MIN_VIEWPORT_SIZE));
    setTimelineHeight(timeline);
    setObjectPaneHeight(fit(state.layout.objectPaneHeight, MIN_OBJECT_PANE_HEIGHT, window.innerHeight - timeline - MIN_OUTLINER_HEIGHT - 120));
    setTransformPanelOpen(state.layout.transformPanelOpen);
    setPropertiesTab(state.layout.propertiesTab);
    setMenu(null);
    refresh();
  };

  const loadProject = (text: string, file: ProjectFile) => {
    const { document, ...state } = parseProject(text);
    restore(state, startHistory(document), file, document);
    setMessage(`Opened ${file.name}.`);
  };

  const failed = (action: string, error: unknown) => setMessage(`Could not ${action}: ${error instanceof Error ? error.message : error}`);
  const confirmDiscard = () => !hasUnsavedChanges() || window.confirm('Discard unsaved changes?');

  const openFile = async () => {
    setMenu(null);
    if (!confirmDiscard()) {
      return;
    }
    try {
      const chosen = await pickFileToOpen();
      if (chosen) {
        loadProject(chosen.text, { name: chosen.name, handle: chosen.handle });
        if (chosen.handle) {
          await rememberRecent(chosen.handle, Date.now());
        }
      }
    } catch (error) {
      failed('open that file', error);
    }
  };

  const openRecent = async (handle: FileHandle) => {
    setMenu(null);
    if (!confirmDiscard()) {
      return;
    }
    try {
      const chosen = await readHandle(handle);
      loadProject(chosen.text, { name: chosen.name, handle });
      await rememberRecent(handle, Date.now());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        await forgetRecent(handle);
        setMessage(`${handle.name} is no longer there, so it was removed from the list.`);
      } else {
        failed(`open ${handle.name}`, error);
      }
    }
  };

  const saveFile = async (saveAs: boolean) => {
    setMenu(null);
    if (modeRef.current.kind !== 'idle') {
      return;
    }
    const current = fileRef.current;
    const suggested = current?.name ?? `${UNTITLED}${FILE_EXTENSION}`;
    try {
      let handle = saveAs ? null : current?.handle ?? null;
      if (!handle && canWriteFiles()) {
        handle = await pickFileToSave(suggested);
        if (!handle) {
          return;
        }
      }
      const document = currentDocument();
      const text = serializeProject({ document, ...captureState() });
      if (handle) {
        await writeHandle(handle, text);
        await rememberRecent(handle, Date.now());
      } else {
        // Without file access, saving can only hand over a copy.
        downloadFile(suggested, text);
      }
      fileRef.current = { name: handle?.name ?? suggested, handle };
      savedDocumentRef.current = document;
      setMessage(`Saved ${fileRef.current.name}.`);
      refresh();
    } catch (error) {
      failed('save', error);
    }
  };

  const newProject = () => {
    setMenu(null);
    if (confirmDiscard()) {
      const document = initialDocument();
      restore({
        view: { orbit: DEFAULT_ORBIT, viewedCamera: null, time: DEFAULT_FRAME_START / DEFAULT_FRAME_RATE },
        layout: layoutRef.current,
        settings: { ...captureState().settings, selectMode: 'vertex', proportional: false, proportionalConnected: false, proportionalRadius: DEFAULT_PROPORTIONAL_RADIUS, brush: DEFAULT_BRUSH },
      }, startHistory(document), null, document);
      setMessage('New project.');
    }
  };

  const recoverSession = async () => {
    setMenu(null);
    if (!recoverable || !confirmDiscard()) {
      return;
    }
    restore(recoverable.state, recoverable.history, recoverable.file, recoverable.savedDocument);
    setMessage(`Recovered the session from ${new Date(recoverable.savedAt).toLocaleString()}.`);
    // This tab's autosave now holds it.
    await deleteSession(recoverable.tabId).catch(() => undefined);
    setRecoverable(null);
  };

  const openFileMenu = (x: number, y: number) => {
    setMenu({ kind: 'file', x, y });
    recentFiles().then(setRecent).catch(() => setRecent([]));
    latestAbandonedSession().then(setRecoverable).catch(() => setRecoverable(null));
  };

  // Brings back this tab's work after a refresh, then keeps a copy of it, so a closed tab reverts
  // to the file but a refreshed one does not. Nothing is written until the restore has finished,
  // or the new scene would replace what there was to restore.
  useEffect(() => {
    let stopped = false;
    let tabId: string | null = null;
    let writing = false;
    let writtenSignature = '';
    let writtenHistory: History<EditorDocument> | null = null;

    const write = () => {
      if (!tabId || writing || modeRef.current.kind !== 'idle' || playingRef.current) {
        return;
      }
      const state = captureState();
      const signature = JSON.stringify(state);
      if (historyRef.current === writtenHistory && signature === writtenSignature) {
        return;
      }
      const history = historyRef.current;
      writing = true;
      writeSession({
        tabId,
        savedAt: Date.now(),
        pristine: !fileRef.current && !hasUnsavedChanges() && history.past.length === 0 && history.future.length === 0,
        state,
        history,
        file: fileRef.current,
        savedDocument: savedDocumentRef.current,
      }).then(() => {
        writtenHistory = history;
        writtenSignature = signature;
      }).catch(() => undefined).finally(() => {
        writing = false;
      });
    };

    (async () => {
      const id = await currentTabId();
      const session = await loadSession(id);
      if (stopped) {
        return;
      }
      if (session) {
        restore(session.state, session.history, session.file, session.savedDocument);
        setMessage('Restored after refresh.');
      }
      tabId = id;
      await pruneSessions(Date.now());
    })().catch(() => {
      // Without storage everything else still works, just without surviving a refresh.
    });

    const timer = window.setInterval(write, AUTOSAVE_INTERVAL_MS);
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      write();
      if (hasUnsavedChanges()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    // Everything used here reads current values through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const original = window.document.title;
    return () => {
      window.document.title = original;
    };
  }, []);

  const fileName = fileRef.current?.name.replace(new RegExp(`\\${FILE_EXTENSION}$`), '') ?? UNTITLED;
  const unsaved = hasUnsavedChanges();
  useEffect(() => {
    window.document.title = `${unsaved ? '* ' : ''}${fileName} - Slender`;
  }, [fileName, unsaved]);

  const toggleProportional = () => {
    proportionalRef.current = !proportionalRef.current;
    refresh();
  };

  const toggleProportionalConnected = () => {
    proportionalConnectedRef.current = !proportionalConnectedRef.current;
    setMessage(proportionalConnectedRef.current ? 'Proportional editing reaches connected vertices only.' : 'Proportional editing reaches all nearby vertices.');
    refresh();
  };

  const toggleXRay = () => {
    xRayRef.current = !xRayRef.current;
    refresh();
  };

  // What selection and the edit overlay must leave out, given the current X-Ray setting.
  const currentOcclusion = (view: Camera, transient: Transient | null = null) => (
    xRayRef.current ? undefined : occlusionTest(currentDocument(), timeRef.current, view, transient)
  );

  const addArmatureObject = () => {
    setMenu(null);
    apply(addArmature(currentDocument(), cursorRef.current));
    setMessage('Added Armature. Tab to edit its bones, Shift+Tab to pose them.');
  };

  const addBoneToArmature = () => {
    const object = activeObject();
    setMenu(null);
    if (object) {
      apply(addBone(currentDocument(), object.id));
      setMessage('Added a bone. G to move it, E to grow more from it.');
    }
  };

  const addEllipsoidObject = () => {
    setMenu(null);
    apply(addEllipsoid(currentDocument(), { radii: { x: 60, y: 60, z: 60 }, length: 60 }, cursorRef.current));
    setMessage('Added Ellipsoid. Set its radii and length in the object pane; equal radii make a capsule.');
  };

  const addCamera = () => {
    setMenu(null);
    apply(addObject(currentDocument(), 'Camera', cameraGizmoMesh(), { focalLength: DEFAULT_FOCAL_LENGTH }, cursorRef.current));
    setMessage('Added Camera. G and R to place it, Numpad 0 to look through it.');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }

    // Pointer positions are in image space, whose origin is the canvas center.
    const toImage = (event: MouseEvent): Vec2 => {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left - canvas.clientWidth / 2,
        y: event.clientY - bounds.top - canvas.clientHeight / 2,
      };
    };

    const setMode = (mode: Mode) => {
      modeRef.current = mode;
      canvas.style.cursor = mode.kind === 'boxArmed' || mode.kind === 'boxDragging' ? 'crosshair' : 'default';
      refresh();
    };

    const cancel = () => {
      const mode = modeRef.current;
      if (mode.kind === 'walk' && !mode.cameraId) {
        orbitRef.current = mode.original;
      }
      if (isTransforming()) {
        transientRef.current = null;
        setMessage('Cancelled.');
      }
      // A cancelled extrusion would leave a bone of no length.
      if (isTransformMode(mode) && mode.step === EXTRUDE_STEP) {
        historyRef.current = undo(historyRef.current);
      }
      if (mode.kind === 'brushResizing') {
        brushRef.current = { ...brushRef.current, radius: mode.original };
      }
      historyRef.current = endStep(historyRef.current);
      setMode({ kind: 'idle' });
      if (window.document.pointerLockElement === canvas) {
        window.document.exitPointerLock();
      }
    };

    // Puts the scene cursor on the surface under a point, or at its current depth if there is none.
    const placeCursor = (point: Vec2) => {
      const document = currentDocument();
      const view = camera();
      const { direction, onPlane } = viewRay(view, point, cursorRef.current);
      const hit = raycastSurface(document, timeRef.current, view.position, direction);
      cursorRef.current = hit === null ? onPlane : {
        x: view.position.x + direction.x * hit,
        y: view.position.y + direction.y * hit,
        z: view.position.z + direction.z * hit,
      };
      refresh();
    };

    const releasePointer = () => {
      if (window.document.pointerLockElement === canvas) {
        window.document.exitPointerLock();
      }
    };

    const beginWalk = () => {
      const viewed = viewedCamera();
      const document = currentDocument();
      const time = timeRef.current;
      const transform = viewed ? transformAt(viewed, time) : null;
      const view = viewed ? viewFromObject(document, viewed, time, null) : null;
      const original = viewed && view
        ? orbitAt(view.position, view.rotation, view.focalLength, WALK_ORBIT_DISTANCE)
        : orbitRef.current;
      const parentInverse = viewed ? invertMatrix(parentMatrix(document, viewed, time)) : null;
      walkOrbitRef.current = original;
      walkKeysRef.current = new Set();
      walkFastRef.current = false;
      walkZoomRef.current = null;
      walkSpeedRef.current = WALK_SPEED;
      playingRef.current = false;
      setMode({ kind: 'walk', original, cameraId: viewed?.id ?? null, transform, parentInverse });
      setMessage('Walking: the mouse looks around. WASD move, Q/E down and up, Shift faster, Space zooms to a surface, wheel sets speed. Left click to keep, Esc or right click to go back.');
      // Without the lock, as when the browser refuses it, the mouse still looks around until the
      // cursor reaches the edge of the screen.
      const locking = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      locking?.catch?.(() => undefined);
    };

    // Heads for the surface at the center of the view, stopping short so it stays in view.
    const beginWalkZoom = () => {
      const orbit = walkOrbitRef.current;
      if (!orbit) {
        return;
      }
      const view = toCamera(orbit);
      const direction = {
        x: (orbit.target.x - view.position.x) / orbit.distance,
        y: (orbit.target.y - view.position.y) / orbit.distance,
        z: (orbit.target.z - view.position.z) / orbit.distance,
      };
      const hit = raycastSurface(currentDocument(), timeRef.current, view.position, direction);
      if (hit === null) {
        setMessage('No surface at the center of the view.');
        return;
      }
      const distance = hit - Math.min(WALK_ZOOM_MAX_STANDOFF, hit * WALK_ZOOM_STANDOFF);
      walkZoomRef.current = { direction, distance, covered: 0, elapsed: 0 };
    };

    const confirmWalk = (mode: Extract<Mode, { kind: 'walk' }>) => {
      const transient = transientRef.current;
      transientRef.current = null;
      if (mode.cameraId && transient) {
        apply(commitTransient(currentDocument(), transient, timeRef.current));
      }
      setMode({ kind: 'idle' });
      setMessage('Walk ended.');
      releasePointer();
    };

    // Moves and turns the walking view, and writes it to whatever is being walked.
    const stepWalk = (mode: Extract<Mode, { kind: 'walk' }>, turnYaw: number, turnPitch: number, seconds: number) => {
      const orbit = walkOrbitRef.current;
      if (!orbit) {
        return;
      }
      const held = (code: string) => (walkKeysRef.current.has(code) ? 1 : 0);
      const distance = walkSpeedRef.current * (walkFastRef.current ? WALK_FAST_FACTOR : 1) * seconds;
      let next = walkStep(
        orbit,
        turnYaw,
        turnPitch,
        (held('KeyD') - held('KeyA')) * distance,
        (held('KeyE') - held('KeyQ')) * distance,
        (held('KeyW') - held('KeyS')) * distance
      );
      const zoom = walkZoomRef.current;
      if (zoom) {
        // Glides toward the surface, slowing as it arrives, while the mouse can still look around.
        zoom.elapsed = Math.min(WALK_ZOOM_SECONDS, zoom.elapsed + seconds);
        const progress = zoom.elapsed / WALK_ZOOM_SECONDS;
        const eased = 1 - (1 - progress) * (1 - progress);
        const covered = zoom.distance * eased;
        const step = covered - zoom.covered;
        zoom.covered = covered;
        next = {
          ...next,
          target: {
            x: next.target.x + zoom.direction.x * step,
            y: next.target.y + zoom.direction.y * step,
            z: next.target.z + zoom.direction.z * step,
          },
        };
        if (progress >= 1) {
          walkZoomRef.current = null;
        }
      }
      walkOrbitRef.current = next;
      if (mode.cameraId && mode.transform && mode.parentInverse) {
        const { position, rotation } = toCamera(next);
        const world = transformMatrix({ position, rotation, scale: { x: 1, y: 1, z: 1 } });
        const local = decompose(multiply(mode.parentInverse, world));
        transientRef.current = {
          kind: 'objects',
          transforms: new Map([[mode.cameraId, { ...mode.transform, position: local.position, rotation: rotationLike(local.rotation, mode.transform.rotation) }]]),
        };
      } else {
        orbitRef.current = next;
      }
      dirtyRef.current = true;
    };

    const beginTransform = (kind: TransformKind, step: string | null = null, normal: Vec3 | null = null) => {
      const document = currentDocument();
      const object = activeObject();
      const time = timeRef.current;
      let target: TransformTarget;
      let pivot: Vec2 | null;
      if (document.mode === 'weight') {
        return;
      }
      if (document.mode === 'edit' && object) {
        const world = worldVertices(document, object, time);
        const matrix = worldMatrices(document, time).get(object.id)!;
        let distances: number[] | null = null;
        if (proportionalRef.current) {
          distances = proportionalConnectedRef.current
            ? connectedDistances({ vertices: world, faces: object.faces, edges: object.edges }, object.selectedVertices)
            : straightDistances(world, object.selectedVertices);
        }
        target = { kind: 'vertices', id: object.id, matrix, world, selection: object.selectedVertices, distances, modifiers: object.modifiers ?? [], mirrorJoints: object.bones && object.mirrorEdit && step !== DUPLICATE_STEP ? jointPartners(object, poseAt(object.vertices, time)) : null };
        pivot = selectionPivot(world, object.selectedVertices, camera());
      } else if (document.mode === 'pose') {
        // A bone connected to its parent is held there, and can only turn.
        const free = (id: string) => {
          const { armature, bone } = findBone(document, id)!;
          return kind !== 'translate' || !armature.bones!.some(other => other.id === bone.parent && other.tail === bone.head);
        };
        const ids = topLevelOnly(document, document.selectedBones).filter(free);
        const matrices = worldMatrices(document, time);
        const worldPositions = ids.map(id => matrixOrigin(matrices.get(id)!));
        const partners = object ? bonePartners(object, poseAt(object.vertices, time)) : new Map<string, string>();
        target = {
          kind: 'objects',
          ids,
          transforms: ids.map(id => nodeTransformAt(document, id, time)),
          worldPositions,
          parentInverses: ids.map(id => invertMatrix(parentMatrix(document, findBone(document, id)!.bone, time))),
          matrices: ids.map(id => matrices.get(id)!),
          pinned: ids.map(id => {
            const { armature, bone } = findBone(document, id)!;
            return armature.bones!.some(other => other.id === bone.parent && other.tail === bone.head);
          }),
          mirrored: object?.bones && object.mirrorPose ? ids.flatMap(source => {
            const id = partners.get(source);
            return id && !document.selectedBones.includes(id) ? [{ source, id, transform: nodeTransformAt(document, id, time) }] : [];
          }) : undefined,
        };
        pivot = selectionPivot(worldPositions, new Set(worldPositions.map((_, i) => i)), camera());
      } else {
        const ids = topLevelOnly(document, selectedVisible(document));
        const chosen = ids.map(id => findObject(document, id)!);
        const matrices = worldMatrices(document, time);
        const worldPositions = chosen.map(candidate => matrixOrigin(matrices.get(candidate.id)!));
        target = {
          kind: 'objects',
          ids,
          transforms: chosen.map(candidate => transformAt(candidate, time)),
          worldPositions,
          parentInverses: chosen.map(candidate => invertMatrix(parentMatrix(document, candidate, time))),
          matrices: ids.map(id => matrices.get(id)!),
        };
        pivot = selectionPivot(worldPositions, new Set(worldPositions.map((_, i) => i)), camera());
      }
      if (!pivot) {
        setMessage(document.mode === 'pose' && kind === 'translate' && document.selectedBones.length > 0
          ? 'A connected bone cannot move away from its parent. R turns it.'
          : 'Select something first.');
        return;
      }
      // Moving has no center to choose. Only turning and scaling do.
      const center = pivotModeRef.current === 'cursor' && kind !== 'translate' ? cursorRef.current : null;
      if (center) {
        pivot = projectPoint(camera(), center);
        if (!pivot) {
          setMessage('The scene cursor is behind the view.');
          return;
        }
      }
      playingRef.current = false;
      const mode: TransformMode = { kind, target, start: mouseRef.current, pivot, center, axis: null, space: 'global', normal, step, typed: null };
      setMode(mode);
      setMessage(transformMessage(mode));
    };

    const confirmTransform = (mode: TransformMode) => {
      const transient = transientRef.current;
      transientRef.current = null;
      if (transient) {
        apply(commitTransient(currentDocument(), transient, timeRef.current), mode.step);
      }
      // The action is whole now, so the next one of its kind gets its own undo step.
      historyRef.current = endStep(historyRef.current);
      setMode({ kind: 'idle' });
      setMessage('Applied.');
    };

    const duplicate = () => {
      const document = currentDocument();
      const object = activeObject();
      if (document.mode === 'pose' || document.mode === 'weight') {
        return;
      }
      if (document.mode === 'object') {
        if (selectedVisible(document).length === 0) {
          setMessage('Select something first.');
          return;
        }
        apply(duplicateObjects(document), DUPLICATE_STEP);
      } else if (object) {
        if (object.selectedVertices.size === 0) {
          setMessage('Select something first.');
          return;
        }
        if (object.bones) {
          apply(duplicateBones(document, object.id), DUPLICATE_STEP);
          beginTransform('translate', DUPLICATE_STEP);
          return;
        }
        const pose = poseAt(object.vertices, timeRef.current);
        const { mesh, copiedFrom, copies } = duplicateSelection({ vertices: pose, faces: object.faces, edges: object.edges }, object.selectedVertices);
        apply(updateObject(document, object.id, current => ({
          ...current,
          vertices: [...current.vertices, ...copiedFrom.map(source => current.vertices[source])],
          faces: mesh.faces,
          edges: mesh.edges,
          selectedVertices: copies,
          vertexGroups: groupsAfterCopy(current.vertexGroups, copiedFrom, current.vertices.length),
        })), DUPLICATE_STEP);
      }
      beginTransform('translate', DUPLICATE_STEP);
    };

    const extrude = () => {
      const document = currentDocument();
      const object = activeObject();
      if (document.mode !== 'edit' || !object) {
        return;
      }
      if (object.selectedVertices.size === 0) {
        setMessage(object.bones ? 'Select a joint to grow a bone from.' : 'Select something to extrude.');
        return;
      }
      if (object.bones) {
        apply(extrudeBones(document, object.id, timeRef.current), EXTRUDE_STEP);
        beginTransform('translate', EXTRUDE_STEP);
        return;
      }
      // Faces lift along the way they face, and lines and vertices move freely until locked.
      const normal = regionNormal(worldVertices(document, object, timeRef.current), object.faces, object.selectedVertices);
      const { mesh, copiedFrom, kept, selection } = extrudeSelection(
        { vertices: poseAt(object.vertices, timeRef.current), faces: object.faces, edges: object.edges }, object.selectedVertices
      );
      apply(updateObject(document, object.id, current => {
        const grown = [...current.vertices, ...copiedFrom.map(source => current.vertices[source])];
        return {
          ...current,
          vertices: kept.map(i => grown[i]),
          faces: mesh.faces,
          edges: mesh.edges,
          selectedVertices: selection,
          vertexGroups: groupsAfterDelete(groupsAfterCopy(current.vertexGroups, copiedFrom, current.vertices.length), kept),
        };
      }), EXTRUDE_STEP);
      beginTransform('translate', EXTRUDE_STEP, normal);
    };

    const beginBrushResize = () => {
      setMode({ kind: 'brushResizing', center: mouseRef.current, original: brushRef.current.radius });
      setMessage('Move to set the brush radius. Left click to confirm, Esc to cancel.');
    };

    const fill = () => {
      const object = activeObject();
      if (currentDocument().mode === 'weight') {
        beginBrushResize();
        return;
      }
      if (currentDocument().mode !== 'edit' || !object) {
        setMessage('F works in edit mode. Press Tab.');
        return;
      }
      if (object.bones) {
        setMessage('F makes lines and faces on meshes. E grows a bone.');
        return;
      }
      const world = worldVertices(currentDocument(), object, timeRef.current);
      const result = fillSelection({ vertices: world, faces: object.faces, edges: object.edges }, object.selectedVertices, camera());
      apply(updateObject(currentDocument(), object.id, current => ({ ...current, faces: result.mesh.faces, edges: result.mesh.edges })));
      setMessage(result.message);
    };

    // Deletes the selected objects, or the selected vertices with what they hold up. Undo restores them.
    const deleteSelection = () => {
      const document = currentDocument();
      const object = activeObject();
      if (document.mode === 'pose' || document.mode === 'weight') {
        return;
      }
      if (document.mode === 'edit' && object?.bones) {
        if (object.selectedVertices.size === 0) {
          setMessage('Nothing selected to delete.');
        } else if (bonesToDelete(object, timeRef.current).length === object.bones.length) {
          setMessage('An armature keeps at least one bone. Delete the object instead.');
        } else {
          apply(deleteBones(document, object.id, timeRef.current));
          setMessage('Deleted bones.');
        }
        return;
      }
      if (document.mode === 'object') {
        const deleting = selectedVisible(document);
        if (deleting.length === 0) {
          setMessage('Nothing selected to delete.');
          return;
        }
        apply(deleteObjects(document, deleting, timeRef.current));
        setMessage(`Deleted ${deleting.length} ${deleting.length === 1 ? 'object' : 'objects'}.`);
      } else if (object) {
        if (object.selectedVertices.size === 0) {
          setMessage('Nothing selected to delete.');
          return;
        }
        const { mesh, kept } = deleteSelected(
          { vertices: poseAt(object.vertices, timeRef.current), faces: object.faces, edges: object.edges }, object.selectedVertices, selectModeRef.current
        );
        apply(updateObject(document, object.id, current => ({
          ...current,
          vertices: kept.map(i => current.vertices[i]),
          faces: mesh.faces,
          edges: mesh.edges,
          selectedVertices: new Set(),
          vertexGroups: groupsAfterDelete(current.vertexGroups, kept),
        })));
        setMessage('Deleted.');
      }
    };

    const deselectAll = () => {
      const document = currentDocument();
      const object = activeObject();
      if (document.mode === 'pose') {
        apply({ ...document, selectedBones: [] });
      } else if (document.mode === 'weight') {
        return;
      } else if (document.mode === 'object') {
        apply(clickObject(document, null, false));
      } else if (object && object.selectedVertices.size > 0) {
        apply(updateObject(document, object.id, current => ({ ...current, selectedVertices: new Set() })));
      }
    };

    const selectAll = () => {
      const document = currentDocument();
      const object = activeObject();
      if (document.mode === 'pose') {
        apply({ ...document, selectedBones: (object?.bones ?? []).map(bone => bone.id) });
      } else if (document.mode === 'object') {
        const chosen = document.objects.filter(candidate => isSelectable(document, candidate)).map(candidate => candidate.id);
        apply(selectObjects(document, Array.from(new Set([...document.selectedObjects, ...chosen]))));
      } else if (document.mode === 'edit' && object) {
        apply(updateObject(document, object.id, current => ({ ...current, selectedVertices: new Set(current.vertices.map((_, i) => i)) })));
      }
    };

    const stepHistory = (step: typeof undo) => {
      const before = historyRef.current;
      historyRef.current = step(before);
      setMessage(historyRef.current === before ? 'Nothing more to do there.' : step === undo ? 'Undid.' : 'Redid.');
      refresh();
    };

    const openMenu = (kind: MenuKind) => {
      const bounds = canvas.getBoundingClientRect();
      setMenu({
        kind,
        x: mouseRef.current.x + canvas.clientWidth / 2 + bounds.left,
        y: mouseRef.current.y + canvas.clientHeight / 2 + bounds.top,
      });
    };

    // Ctrl+P: which menu depends on what is being parented.
    const openParentMenu = () => {
      const document = currentDocument();
      const object = activeObject();
      if (document.mode === 'edit' && object?.bones) {
        if (selectedBonesOf(object).length < 2 || !document.activeBone) {
          setMessage('Select the bones to parent, then the parent last.');
        } else {
          openMenu('boneParent');
        }
      } else if (document.mode !== 'object' && !(document.mode === 'pose' && document.activeBone)) {
        setMessage('Parenting works in object mode, in pose mode with a bone active, or on bones in edit mode.');
      } else if (!object || !selectedVisible(document).includes(object.id) || selectedVisible(document).length < 2) {
        setMessage('Select the children, then the parent last.');
      } else {
        openMenu('parent');
      }
    };

    // Ctrl+J: joins the other selected meshes into the active one.
    const joinMeshes = () => {
      const document = currentDocument();
      if (document.mode !== 'object') {
        return;
      }
      const { document: next, joined } = joinSelected(document, timeRef.current);
      if (joined === 0) {
        setMessage('Select the meshes to join, then the one to join them into last.');
      } else {
        apply(next);
        setMessage(`Joined ${joined} ${joined === 1 ? 'mesh' : 'meshes'} into ${activeObject()?.name}.`);
      }
    };

    // Shift+I in pose mode: the active bone reaches for the other selected bone.
    const addBoneIk = () => {
      const document = currentDocument();
      const bone = document.activeBone;
      if (document.mode !== 'pose' || !bone) {
        setMessage('Shift+I adds inverse kinematics in pose mode: select the target bone, then the bone to reach for it last.');
        return;
      }
      const added = addConstraint(document, bone, 'ik');
      const constraints = findBone(added, bone)!.bone.constraints;
      const target = document.selectedBones.find(id => id !== bone) ?? null;
      apply(updateConstraint(added, bone, constraints[constraints.length - 1].id, { target }));
      setMessage(target ? 'Added inverse kinematics. Set a pole and the chain length in the object pane.' : 'Added inverse kinematics. Choose its target in the object pane.');
    };

    // Ctrl+Shift+P: parents without keeping the child's place, moving it to the parent.
    const parentWithoutInverse = () => {
      const document = currentDocument();
      const object = activeObject();
      if (document.mode !== 'object' || !object || !selectedVisible(document).includes(object.id) || selectedVisible(document).length < 2) {
        setMessage('Select the children, then the parent last.');
        return;
      }
      chooseParent('withoutInverse');
    };

    const clearSelected = (field: ClearField) => {
      const document = currentDocument();
      const ids = document.mode === 'pose' ? document.selectedBones : document.mode === 'object' ? selectedVisible(document) : [];
      if (ids.length === 0) {
        return;
      }
      apply(clearTransforms(document, document.mode === 'pose' ? withPosePartners(document, ids, timeRef.current) : ids, field, timeRef.current));
      setMessage(CLEAR_MESSAGES[field]);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Saving and opening work from anywhere, and the browser must never answer them itself. A
      // field being typed in commits first, so that what is saved includes it.
      if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyS' || event.code === 'KeyO')) {
        event.preventDefault();
        if (!event.repeat && modeRef.current.kind === 'idle') {
          (window.document.activeElement as HTMLElement | null)?.blur();
          if (event.code === 'KeyO') {
            openFile();
          } else {
            saveFile(event.shiftKey);
          }
        }
        return;
      }
      // Typing a name or a length, or choosing an easing, must not trigger shortcuts.
      const target = event.target as HTMLElement;
      if (target.tagName === 'SELECT' || (target.tagName === 'INPUT' && ['number', 'text'].includes((target as HTMLInputElement).type))) {
        return;
      }
      if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') {
        // Other controls take clicks only, so keys belong to the viewport.
        target.blur();
      }
      if (event.ctrlKey || event.metaKey) {
        // Ctrl+P would otherwise open the browser's print dialog, even in the middle of something.
        if (event.code === 'KeyP' || event.code === 'KeyJ') {
          event.preventDefault();
        }
        if (modeRef.current.kind !== 'idle' || event.repeat) {
          return;
        }
        if (event.code === 'KeyP') {
          if (event.shiftKey) {
            parentWithoutInverse();
          } else {
            openParentMenu();
          }
        } else if (event.code === 'KeyJ') {
          joinMeshes();
        } else if (event.code === 'Tab') {
          event.preventDefault();
          togglePoseOrWeight();
        } else if (event.code === 'KeyZ') {
          event.preventDefault();
          stepHistory(event.shiftKey ? redo : undo);
        } else if (event.code === 'KeyY') {
          event.preventDefault();
          stepHistory(redo);
        }
        return;
      }
      if (event.repeat) {
        return;
      }
      if (event.code === 'Escape') {
        setMenu(null);
        cancel();
        return;
      }
      const mode = modeRef.current;
      if (mode.kind === 'walk') {
        walkFastRef.current = event.shiftKey;
        if (event.code === 'Enter') {
          confirmWalk(mode);
        } else if (event.code === 'Space') {
          event.preventDefault();
          beginWalkZoom();
        } else {
          walkKeysRef.current.add(event.code);
        }
        return;
      }
      if (isTransformMode(mode)) {
        const retyped = (typed: TypedInput | null) => {
          const next = { ...mode, typed };
          transientRef.current = computeTransient(next, camera(), mouseRef.current, currentProportionalRadius());
          setMode(next);
          setMessage(transformMessage(next));
        };
        if (event.code === 'Enter' || event.code === 'NumpadEnter') {
          confirmTransform(mode);
        } else if (event.code === 'Tab') {
          event.preventDefault();
          if (mode.kind === 'translate' && !mode.axis && !mode.normal) {
            retyped(nextField(mode.typed));
          }
        } else if (isTypedKey(event.key) && !event.altKey) {
          retyped(typeKey(mode.typed, event.key));
        } else if (AXIS_KEYS[event.code] && !event.shiftKey && !event.altKey) {
          // Pressing a locked axis again goes from global to local, then releases it.
          const pressed = AXIS_KEYS[event.code];
          const typed = mode.typed && { ...mode.typed, index: 0 };
          const next: TransformMode = mode.axis !== pressed
            ? { ...mode, axis: pressed, space: 'global', normal: null, typed }
            : mode.space === 'global'
              ? { ...mode, space: 'local', normal: null, typed }
              : { ...mode, axis: null, space: 'global', normal: null, typed };
          transientRef.current = computeTransient(next, camera(), mouseRef.current, currentProportionalRadius());
          setMode(next);
          setMessage(transformMessage(next));
        }
        return;
      }
      if (mode.kind !== 'idle') {
        return;
      }

      if (event.code === 'KeyA' && event.altKey) {
        event.preventDefault();
        deselectAll();
      } else if (event.code === 'KeyZ' && event.altKey) {
        event.preventDefault();
        toggleXRay();
      } else if (event.code === 'KeyO' && event.altKey) {
        event.preventDefault();
        toggleProportionalConnected();
      } else if (event.code === 'KeyI' && event.altKey) {
        event.preventDefault();
        if (!keyHoveredProperty(true)) {
          setMessage('Alt+I removes a key from the property under the pointer.');
        }
      } else if (CLEAR_KEYS[event.code] && event.altKey) {
        event.preventDefault();
        clearSelected(CLEAR_KEYS[event.code]);
      } else if (event.altKey) {
        return;
      } else if (event.code === 'Tab') {
        event.preventDefault();
        if (event.shiftKey) {
          togglePoseOrWeight();
        } else {
          toggleEditMode();
        }
      } else if (event.code === 'KeyA' && event.shiftKey) {
        event.preventDefault();
        if (currentDocument().mode === 'object' || currentDocument().mode === 'edit') {
          openMenu('add');
        }
      } else if (event.code === 'KeyS' && event.shiftKey) {
        event.preventDefault();
        if (currentDocument().mode !== 'weight') {
          openMenu('snap');
        }
      } else if (event.code === 'KeyD' && event.shiftKey) {
        event.preventDefault();
        duplicate();
      } else if (event.code === 'KeyF' && event.shiftKey) {
        event.preventDefault();
        beginWalk();
      } else if (event.code === 'KeyI' && event.shiftKey) {
        event.preventDefault();
        addBoneIk();
      } else if (event.shiftKey) {
        return;
      } else if (event.code === 'KeyA') {
        selectAll();
      } else if (event.code === 'Numpad0') {
        toggleCameraView();
      } else if (event.code === 'KeyI') {
        if (!keyHoveredProperty(false)) {
          insertKey();
        }
      } else if (event.code === 'Space') {
        event.preventDefault();
        togglePlaying();
      } else if (event.code === 'Delete') {
        deleteSelection();
      } else if (event.code === 'KeyX') {
        deleteSelection();
      } else if (event.code === 'KeyE') {
        extrude();
      } else if (event.code === 'KeyW' && currentDocument().mode === 'edit' && !activeObject()?.bones) {
        openMenu('specials');
      } else if (event.code === 'KeyP' && currentDocument().mode === 'edit' && !activeObject()?.bones) {
        openMenu('separate');
      } else if (SELECT_MODE_KEYS[event.code] && currentDocument().mode === 'edit' && !activeObject()?.bones) {
        selectModeRef.current = SELECT_MODE_KEYS[event.code];
        refresh();
      } else if (event.code === 'KeyO') {
        toggleProportional();
      } else if (event.code === 'KeyN') {
        setTransformPanelOpen(open => !open);
      } else if (event.code === 'KeyG') {
        beginTransform('translate');
      } else if (event.code === 'KeyR') {
        beginTransform('rotate');
      } else if (event.code === 'KeyS') {
        beginTransform('scale');
      } else if (event.code === 'KeyB' && currentDocument().mode !== 'weight') {
        setMode({ kind: 'boxArmed' });
        setMessage('Box select: drag with the left button. Esc or right click to cancel.');
      } else if (event.code === 'KeyF') {
        fill();
      }
    };

    // In weight paint, right clicking a bone of the armature bending this mesh picks the group it moves.
    const pickPaintedBone = (point: Vec2) => {
      const document = currentDocument();
      const object = activeObject();
      const armature = findObject(document, object?.deformer ?? null);
      if (!object || !armature) {
        return;
      }
      const hit = pickBone(document, armature, camera(), timeRef.current, point, PICK_RADIUS);
      const bone = armature.bones?.find(candidate => candidate.id === hit);
      if (!bone) {
        return;
      }
      const group = object.vertexGroups.find(candidate => candidate.name === bone.name);
      const next = group
        ? updateObject(document, object.id, current => ({ ...current, activeGroup: group.id }))
        : addVertexGroup(document, object.id, bone.name);
      apply({ ...next, activeBone: bone.id });
      setMessage(`Painting ${bone.name}.`);
    };

    // One step of a stroke, spaced along the way so a fast drag leaves no gaps.
    const paintTo = (mode: Extract<Mode, { kind: 'painting' }>, point: Vec2) => {
      const document = currentDocument();
      const object = activeObject();
      if (!object?.activeGroup) {
        return;
      }
      const brush = brushRef.current;
      const time = timeRef.current;
      const matrices = worldMatrices(document, time);
      const world = toWorld(matrices.get(object.id)!, displayVertices(document, object, time, null, matrices));
      const projected = world.map(vertex => projectPoint(camera(), vertex));
      const occluded = currentOcclusion(camera());
      const steps = Math.max(1, Math.ceil(Math.hypot(point.x - mode.last.x, point.y - mode.last.y) / Math.max(1, brush.radius / 2)));
      let next = document;
      for (let step = 1; step <= steps; step++) {
        const center = { x: mode.last.x + (point.x - mode.last.x) * step / steps, y: mode.last.y + (point.y - mode.last.y) * step / steps };
        const factors = new Map<number, number>();
        projected.forEach((p, i) => {
          const reach = p ? 1 - Math.hypot(p.x - center.x, p.y - center.y) / brush.radius : 0;
          if (reach > 0 && !occluded?.(world[i])) {
            factors.set(i, reach * reach * (3 - 2 * reach) * brush.strength);
          }
        });
        next = paintWeights(next, object.id, object.activeGroup, factors, mode.tool, brush.weight, mode.neighbors);
      }
      apply(next, PAINT_STEP);
      modeRef.current = { ...mode, last: point };
    };

    const selectAt = (point: Vec2, additive: boolean) => {
      const document = currentDocument();
      const object = activeObject();
      if (document.mode === 'object') {
        apply(clickObject(document, pickObject(document, camera(), timeRef.current, point, PICK_RADIUS), additive));
      } else if (document.mode === 'pose') {
        if (object) {
          const bone = pickBone(document, object, camera(), timeRef.current, point, PICK_RADIUS);
          if (bone) {
            apply(selectBone(document, bone, additive));
          } else if (!additive && document.selectedBones.length > 0) {
            apply({ ...document, selectedBones: [] });
          }
        }
      } else if (document.mode === 'weight') {
        pickPaintedBone(point);
      } else if (object?.bones) {
        // A joint if the click is on one, otherwise both ends of the bone. Bones draw over surfaces,
        // so nothing hides them.
        const mesh = { vertices: worldVertices(document, object, timeRef.current), faces: object.faces, edges: object.edges };
        const picked = pickElement(mesh, camera(), point, PICK_RADIUS, 'vertex') ?? pickElement(mesh, camera(), point, PICK_RADIUS, 'line');
        const next = new Set(additive ? object.selectedVertices : []);
        picked?.forEach(i => next.add(i));
        apply({
          ...updateObject(document, object.id, current => ({ ...current, selectedVertices: next })),
          activeBone: picked ? boneFromJoints(object, picked) : document.activeBone,
        });
      } else if (object) {
        const world = worldVertices(document, object, timeRef.current);
        const picked = pickElement({ vertices: world, faces: object.faces, edges: object.edges }, camera(), point, PICK_RADIUS, selectModeRef.current, currentOcclusion(camera()));
        const next = new Set(additive ? object.selectedVertices : []);
        if (picked) {
          // Shift clicking something wholly selected deselects it.
          const remove = additive && picked.every(i => next.has(i));
          picked.forEach(i => (remove ? next.delete(i) : next.add(i)));
        }
        if (next.size > 0 || object.selectedVertices.size > 0) {
          apply(updateObject(document, object.id, current => ({ ...current, selectedVertices: next })));
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const mode = modeRef.current;
      const point = toImage(event);
      mouseRef.current = point;

      // The cursor can stray off the canvas during a transformation, so any click ends it.
      if (mode.kind === 'walk') {
        if (event.button === 0) {
          confirmWalk(mode);
        } else if (event.button === 2) {
          cancel();
        }
        return;
      }
      if (isTransformMode(mode)) {
        if (event.button === 0) {
          confirmTransform(mode);
        } else if (event.button === 2) {
          cancel();
        }
        return;
      }
      if (mode.kind === 'brushResizing') {
        if (event.button === 0) {
          setMode({ kind: 'idle' });
          setMessage('Brush radius set.');
        } else if (event.button === 2) {
          cancel();
        }
        return;
      }
      if (event.target !== canvas) {
        return;
      }
      const hadMenu = menuOpenRef.current;
      setMenu(null);

      if (mode.kind === 'boxArmed') {
        if (event.button === 0) {
          setMode({ kind: 'boxDragging', start: point });
        } else if (event.button === 2) {
          cancel();
        }
      } else if (mode.kind === 'idle') {
        if (event.button === 0 && currentDocument().mode === 'weight') {
          const object = activeObject();
          if (object) {
            if (!object.activeGroup) {
              apply(addVertexGroup(currentDocument(), object.id), PAINT_STEP);
            }
            const tool: PaintTool = event.ctrlKey ? 'subtract' : event.shiftKey ? 'smooth' : 'mix';
            const neighbors = vertexNeighbors({ vertices: poseAt(object.vertices, timeRef.current), faces: object.faces, edges: object.edges });
            const painting: Extract<Mode, { kind: 'painting' }> = { kind: 'painting', tool, neighbors, last: point };
            setMode(painting);
            paintTo(painting, point);
          }
        } else if (event.button === 0) {
          // A click that dismisses a menu does only that.
          if (!hadMenu) {
            placeCursor(point);
          }
        } else if (event.button === 2) {
          selectAt(point, event.shiftKey);
        } else if (event.button === 1) {
          event.preventDefault();
          // Orbiting moves the viewport, so it leaves any camera being looked through.
          viewedCameraRef.current = null;
          setMode({ kind: 'orbit', pan: event.shiftKey });
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const point = toImage(event);
      const previous = mouseRef.current;
      mouseRef.current = point;
      const mode = modeRef.current;

      if (mode.kind === 'walk') {
        // Under pointer lock the cursor does not move, so only the reported movement counts.
        stepWalk(mode, -event.movementX * WALK_LOOK_PER_PIXEL, -event.movementY * WALK_LOOK_PER_PIXEL, 0);
      } else if (isTransformMode(mode)) {
        transientRef.current = computeTransient(mode, camera(), point, currentProportionalRadius());
        dirtyRef.current = true;
      } else if (mode.kind === 'orbit') {
        const orbit = orbitRef.current;
        const [dx, dy] = [point.x - previous.x, point.y - previous.y];
        orbitRef.current = mode.pan
          ? panOrbit(orbit, dx, dy)
          : {
            ...orbit,
            yaw: orbit.yaw - dx * ORBIT_PER_PIXEL,
            pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, orbit.pitch - dy * ORBIT_PER_PIXEL)),
          };
        dirtyRef.current = true;
      } else if (mode.kind === 'boxDragging') {
        dirtyRef.current = true;
      } else if (mode.kind === 'painting') {
        paintTo(mode, point);
      } else if (mode.kind === 'brushResizing') {
        brushRef.current = { ...brushRef.current, radius: Math.max(MIN_BRUSH_RADIUS, Math.hypot(point.x - mode.center.x, point.y - mode.center.y)) };
        refresh();
      } else if (currentDocument().mode === 'weight') {
        dirtyRef.current = true;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const mode = modeRef.current;
      if (mode.kind === 'orbit' && event.button === 1) {
        setMode({ kind: 'idle' });
      } else if (mode.kind === 'painting' && event.button === 0) {
        historyRef.current = endStep(historyRef.current);
        setMode({ kind: 'idle' });
      } else if (mode.kind === 'boxDragging' && event.button === 0) {
        const document = currentDocument();
        const object = activeObject();
        const end = toImage(event);
        if (document.mode === 'pose') {
          if (object) {
            const inside = bonesInBox(document, object, camera(), timeRef.current, mode.start, end);
            const selectedBones = Array.from(new Set([...document.selectedBones, ...inside]));
            apply({ ...document, selectedBones, activeBone: inside[inside.length - 1] ?? document.activeBone });
            setMessage(`Box selected ${inside.length} bones.`);
          }
        } else if (document.mode === 'object') {
          const inside = objectsInBox(document, camera(), timeRef.current, mode.start, end, currentOcclusion(camera()));
          const ids = Array.from(new Set([...document.selectedObjects, ...inside]));
          if (ids.length !== document.selectedObjects.length) {
            apply(selectObjects(document, ids, document.activeObject ?? ids[ids.length - 1]));
          }
          setMessage(`Box selected ${inside.length} objects.`);
        } else if (object) {
          const world = worldVertices(document, object, timeRef.current);
          const inside = object.bones
            ? elementsInBox({ vertices: world, faces: [], edges: object.edges }, camera(), mode.start, end, 'vertex')
            : elementsInBox({ vertices: world, faces: object.faces, edges: object.edges }, camera(), mode.start, end, selectModeRef.current, currentOcclusion(camera()));
          const next = new Set([...Array.from(object.selectedVertices), ...Array.from(inside)]);
          if (next.size !== object.selectedVertices.size) {
            apply(updateObject(document, object.id, current => ({ ...current, selectedVertices: next })));
          }
          setMessage(`Box selected ${inside.size} vertices.`);
        }
        setMode({ kind: 'idle' });
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (modeRef.current.kind === 'walk') {
        walkSpeedRef.current *= Math.pow(WALK_SPEED_PER_WHEEL_PIXEL, -event.deltaY);
        return;
      }
      const mode = modeRef.current;
      if (isTransformMode(mode) && mode.target.kind === 'vertices' && proportionalRef.current) {
        proportionalRadiusRef.current = Math.max(1, proportionalRadiusRef.current * Math.pow(PROPORTIONAL_PER_WHEEL_PIXEL, event.deltaY));
        transientRef.current = computeTransient(mode, camera(), mouseRef.current, currentProportionalRadius());
        dirtyRef.current = true;
        return;
      }
      if (isTransformMode(mode)) {
        return;
      }
      if (viewedCamera()) {
        return;
      }
      const orbit = orbitRef.current;
      orbitRef.current = { ...orbit, distance: Math.max(20, orbit.distance * Math.pow(ZOOM_PER_WHEEL_PIXEL, event.deltaY)) };
      dirtyRef.current = true;
    };

    // Right click cancels a transformation anywhere, so the browser's menu must stay away everywhere.
    const onContextMenu = (event: Event) => {
      if (event.target === canvas || modeRef.current.kind !== 'idle') {
        event.preventDefault();
      }
    };

    const draw = (pixelRatio: number) => {
      const document = currentDocument();
      const time = timeRef.current;
      const transient = transientRef.current;
      const viewed = viewedCamera();
      const sceneCamera = viewed ? viewFromObject(document, viewed, time, transient) : camera();
      const view = { panX: canvas.clientWidth / 2, panY: canvas.clientHeight / 2, zoom: 1 };
      renderScene(ctx, toScene(document, sceneCamera, time, transient, showOverlaysRef.current), view, pixelRatio);
      const matrices = worldMatrices(document, time, transient);

      const mode = modeRef.current;
      const active = activeObject();
      const worldOf = (object: SceneObject) => {
        const matrix = matrices.get(object.id)!;
        return { vertices: toWorld(matrix, displayVertices(document, object, time, transient, matrices)), origin: matrixOrigin(matrix) };
      };

      let guide: AxisGuide | null = null;
      if (isTransformMode(mode) && (mode.axis || mode.normal)) {
        const { target } = mode;
        const center = target.kind === 'vertices'
          ? selectionCenter(target.world, target.selection)
          : selectionCenter(target.worldPositions, new Set(target.ids.map((_, i) => i)));
        guide = { center, direction: lockVector(lockOf(mode, 0)!), axis: mode.axis ?? 'z' };
      }

      const bones: BoneDraw[] = document.objects
        .filter(object => object.bones && isVisible(document, object))
        .flatMap(armature => {
          const local = resolveObject(armature, time, transient).local;
          const isActive = armature.id === document.activeObject;
          if (isActive && document.mode === 'edit') {
            const matrix = matrices.get(armature.id)!;
            return armature.bones!.map((bone): BoneDraw => ({
              head: applyMatrix(matrix, local[bone.head].x, local[bone.head].y, local[bone.head].z),
              tail: applyMatrix(matrix, local[bone.tail].x, local[bone.tail].y, local[bone.tail].z),
              state: bone.id === document.activeBone ? 'active' : armature.selectedVertices.has(bone.head) && armature.selectedVertices.has(bone.tail) ? 'selected' : 'plain',
              joints: { head: armature.selectedVertices.has(bone.head), tail: armature.selectedVertices.has(bone.tail) },
            }));
          }
          const chosen = (id: string) => {
            if (document.mode === 'pose' && isActive) {
              return !document.selectedBones.includes(id) ? 'plain' : id === document.activeBone ? 'active' : 'selected';
            }
            if (document.mode === 'weight') {
              return id === document.activeBone ? 'active' : 'plain';
            }
            return document.mode === 'object' && document.selectedObjects.includes(armature.id) ? 'object' : 'plain';
          };
          return boneSegments(armature, matrices, local).map(({ bone, head, tail }): BoneDraw => ({ head, tail, state: chosen(bone.id), joints: null }));
        });

      const activeGroup = active?.vertexGroups.find(group => group.id === active.activeGroup);

      drawOverlay(ctx, {
        camera: sceneCamera,
        sceneCursor: cursorRef.current,
        bones,
        weightPaint: document.mode === 'weight' && active
          ? { ...worldOf(active), faces: active.faces, weights: active.vertices.map((_, i) => activeGroup?.weights.get(i) ?? 0) }
          : null,
        brush: mode.kind === 'brushResizing'
          ? { center: mode.center, radius: brushRef.current.radius }
          : document.mode === 'weight' ? { center: mouseRef.current, radius: brushRef.current.radius } : null,
        showOverlays: showOverlaysRef.current,
        occluded: document.mode === 'edit' && showOverlaysRef.current ? currentOcclusion(sceneCamera, transient) : undefined,
        editing: document.mode === 'edit' && active && !active.bones
          ? { vertices: worldOf(active).vertices, faces: active.faces, edges: active.edges, selection: active.selectedVertices, selectMode: selectModeRef.current }
          : null,
        selected: document.mode === 'object'
          ? document.objects
            .filter(object => document.selectedObjects.includes(object.id) && object !== viewed && !object.bones && isVisible(document, object))
            // A mesh's outline comes with its rendering. Only a camera, which has none, needs its wires lit.
            .map(object => ({
              ...worldOf(object),
              faces: object.camera ? object.faces : [],
              edges: object.camera ? object.edges : [],
              active: object.id === document.activeObject,
            }))
          : [],
        cameras: document.objects
          .filter(object => object.camera && object !== viewed && isVisible(document, object))
          .map(object => ({ ...worldOf(object), faces: object.faces, edges: object.edges })),
        box: mode.kind === 'boxDragging' ? [mode.start, mouseRef.current] : null,
        guide,
        influence: isTransformMode(mode) && mode.target.kind === 'vertices' && proportionalRef.current
          ? influenceCircle(mode.pivot, selectionCenter(mode.target.world, mode.target.selection), proportionalRadiusRef.current, sceneCamera)
          : null,
        crosshair: mode.kind === 'walk',
      });
    };

    let frame = 0;
    let previousTimestamp: number | undefined;
    const tick = (timestamp: number) => {
      const elapsed = previousTimestamp === undefined ? 0 : (timestamp - previousTimestamp) / 1000;
      if (playingRef.current && elapsed > 0) {
        // Plays whole frames, looping within the play range. From outside it, play starts at its start.
        const { frameRate, frameStart, frameEnd } = currentDocument();
        const [start, end] = [frameStart / frameRate, (frameEnd + 1) / frameRate];
        let clock = (playClockRef.current ?? timeRef.current) + elapsed;
        if (clock < start) {
          clock = start;
        } else if (clock >= end) {
          clock = playClockRef.current === null ? start : start + (clock - end) % (end - start);
        }
        playClockRef.current = clock;
        const frameTime = Math.floor(clock * frameRate + 1e-6) / frameRate;
        if (frameTime !== timeRef.current) {
          moveTime(frameTime);
          refresh();
        }
      }
      if (modeRef.current.kind === 'walk' && (walkKeysRef.current.size > 0 || walkZoomRef.current)) {
        stepWalk(modeRef.current, 0, 0, elapsed);
      }
      previousTimestamp = timestamp;
      const pixelRatio = window.devicePixelRatio;
      const width = Math.round(canvas.clientWidth * pixelRatio);
      const height = Math.round(canvas.clientHeight * pixelRatio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        dirtyRef.current = true;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        draw(pixelRatio);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const onKeyUp = (event: KeyboardEvent) => {
      walkKeysRef.current.delete(event.code);
      walkFastRef.current = event.shiftKey;
    };
    const onBlur = () => walkKeysRef.current.clear();
    // The browser takes Esc for itself under pointer lock and only reports that the lock ended.
    const onPointerLockChange = () => {
      if (modeRef.current.kind === 'walk' && window.document.pointerLockElement !== canvas && pointerWasLockedRef.current) {
        cancel();
      }
      pointerWasLockedRef.current = window.document.pointerLockElement === canvas;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('contextmenu', onContextMenu);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
    };
    // Everything used here reads current values through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const document = currentDocument();
  const active = activeObject();
  const activeBone = active?.bones?.find(bone => bone.id === document.activeBone) ?? null;
  const isArmature = Boolean(active?.bones);
  const counts = document.mode === 'pose' && active?.bones
    ? `${active.name}: ${document.selectedBones.length}/${active.bones.length} bones selected`
    : document.mode === 'edit' && active?.bones
    ? `${active.name}: ${selectedBonesOf(active).length}/${active.bones.length} bones selected`
    : document.mode === 'weight' && active
    ? `${active.name}: painting ${active.vertexGroups.find(group => group.id === active.activeGroup)?.name ?? 'no group'}`
    : document.mode === 'edit' && active
    ? `${active.name}: ${active.selectedVertices.size}/${active.vertices.length} vertices selected, ${active.edges.length} lines, ${active.faces.length} triangles`
    : `${document.selectedObjects.length}/${document.objects.length} objects selected`;

  const renderTransformPanel = () => {
    const shared = { time: timeRef.current, cursor: cursorRef.current, onCursorChange: changeCursor, onDragEnd: endDragStep };
    if (!active) {
      return <TransformPanel {...shared} message='No active object.' />;
    }
    const transformOf = (id: string, name: string, posable: Parameters<typeof transformAt>[0]) => ({
      id,
      name,
      animated: posable.transform,
      ...transformAt(posable, timeRef.current),
      onChange: changeTransformField,
      onRotationMode: (quaternion: boolean) => apply(setRotationMode(currentDocument(), id, quaternion)),
    });
    if (document.mode === 'pose') {
      return activeBone
        ? <TransformPanel {...shared} transform={transformOf(activeBone.id, activeBone.name, activeBone)} />
        : <TransformPanel {...shared} message='No active bone.' />;
    }
    const transform = transformOf(active.id, active.name, active);
    if (document.mode === 'edit') {
      return active.selectedVertices.size === 0 ? <TransformPanel {...shared} message='No vertices selected.' transform={transform} /> : (
        <TransformPanel
          {...shared}
          vertices={{
            name: 'Selection',
            count: active.selectedVertices.size,
            median: selectionCenter(poseAt(active.vertices, timeRef.current), active.selectedVertices),
            animated: Array.from(active.selectedVertices).map(i => active.vertices[i]),
            onChange: changeVertexMedian,
          }}
          transform={transform}
        />
      );
    }
    return <TransformPanel {...shared} transform={transform} />;
  };

  const renderRigPanes = (object: SceneObject) => {
    if (object.bones) {
      return (
        <>
          <ArmaturePane
            armature={object}
            pairs={bonePartners(object, poseAt(object.vertices, timeRef.current)).size / 2}
            canSymmetrize={document.mode === 'edit' && selectedBonesOf(object).length > 0}
            onChange={change => apply(updateObject(currentDocument(), object.id, current => ({ ...current, ...change })))}
            onSymmetrize={() => apply(symmetrizeBones(currentDocument(), object.id, timeRef.current))}
          />
          {activeBone && (
            <BonePane
              document={document}
              armature={object}
              bone={activeBone}
              time={timeRef.current}
              canChangeParent={document.mode === 'edit'}
              onRename={name => apply(renameBone(currentDocument(), activeBone.id, name))}
              onSetParent={parent => apply(setBoneParent(currentDocument(), object.id, activeBone.id, parent))}
              constraintHandlers={constraintHandlers(activeBone.id)}
            />
          )}
        </>
      );
    }
    if (object.camera) {
      return null;
    }
    const brush = brushRef.current;
    const groupId = object.activeGroup;
    return (
      <>
        <ModifiersPane modifiers={object.modifiers ?? []} handlers={modifierHandlers(object)} />
        {document.mode === 'weight' && <BrushPane brush={brush} onChange={next => { brushRef.current = next; refresh(); }} />}
        <VertexGroupsPane
          document={document}
          mesh={object}
          weight={brush.weight}
          onSetDeformer={deformer => apply(updateObject(currentDocument(), object.id, current => ({ ...current, deformer })))}
          onAdd={() => apply(addVertexGroup(currentDocument(), object.id))}
          onRemove={id => apply(removeVertexGroup(currentDocument(), object.id, id))}
          onRename={(id, name) => apply(renameVertexGroup(currentDocument(), object.id, id, name))}
          onActivate={id => apply(updateObject(currentDocument(), object.id, current => ({ ...current, activeGroup: id })))}
          onWeightChange={weight => { brushRef.current = { ...brushRef.current, weight }; refresh(); }}
          onAssign={() => groupId && apply(assignToGroup(currentDocument(), object.id, groupId, object.selectedVertices, brush.weight))}
          onUnassign={() => groupId && apply(removeFromGroup(currentDocument(), object.id, groupId, object.selectedVertices))}
          onSelectMembers={selected => {
            const members = Array.from(object.vertexGroups.find(group => group.id === groupId)?.weights.keys() ?? []);
            const next = new Set(object.selectedVertices);
            members.forEach(i => (selected ? next.add(i) : next.delete(i)));
            apply(updateObject(currentDocument(), object.id, current => ({ ...current, selectedVertices: next })));
          }}
        />
      </>
    );
  };

  return (
    <div className='slender-panel' style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#16181f', color: '#e6e8ef', fontSize: 14 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 12px', flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className='slender-transport-button'
            aria-haspopup='menu'
            onMouseDown={event => event.preventDefault()}
            onClick={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (menu?.kind === 'file') {
                setMenu(null);
              } else {
                openFileMenu(bounds.left, bounds.bottom + 2);
              }
            }}
          >
            File
          </button>
          <span data-testid='file-name' style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>{unsaved ? '* ' : ''}{fileName}</span>
        </div>
        <div className='slender-segments' role='group' aria-label='Mode' data-testid='mode'>
          {(isArmature ? ['object', 'edit', 'pose'] as const : ['object', 'edit', 'weight'] as const).map(mode => (
            <button
              key={mode}
              aria-label={{ object: 'Object', edit: 'Edit', pose: 'Pose', weight: 'Weight Paint' }[mode]}
              title={{ object: 'Object mode', edit: 'Edit mode (Tab)', pose: 'Pose mode (Shift+Tab)', weight: 'Weight paint (Shift+Tab)' }[mode]}
              aria-pressed={document.mode === mode}
              disabled={mode !== 'object' && (!active || active.camera !== null)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                if (document.mode !== mode && !isTransforming()) {
                  enterMode(mode);
                }
              }}
            >
              {{ object: <ObjectModeIcon />, edit: <EditModeIcon />, pose: <PoseModeIcon />, weight: <WeightModeIcon /> }[mode]}
            </button>
          ))}
        </div>
        {document.mode === 'edit' && !isArmature && (
          <div className='slender-segments' role='group' aria-label='Select mode' data-testid='select-mode'>
            {SELECT_MODES.map(({ mode, label, icon }, i) => (
              <button
                key={mode}
                aria-label={label}
                title={`${label} select (${i + 1})`}
                aria-pressed={selectModeRef.current === mode}
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  selectModeRef.current = mode;
                  refresh();
                }}
              >
                {icon}
              </button>
            ))}
          </div>
        )}
        <button
          className='slender-transport-button'
          aria-label='Camera view'
          title='Camera view (Numpad 0)'
          aria-pressed={viewedCamera() !== null}
          onMouseDown={event => event.preventDefault()}
          onClick={toggleCameraView}
        >
          <CameraIcon />
        </button>
        <div style={{ flex: 1 }} />
        <div className='slender-segments' role='group' aria-label='Pivot' data-testid='pivot'>
          {(['median', 'cursor'] as const).map(pivot => (
            <button
              key={pivot}
              title={pivot === 'median' ? 'Rotate and scale about the median of the selection' : 'Rotate and scale about the scene cursor'}
              aria-pressed={pivotModeRef.current === pivot}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                pivotModeRef.current = pivot;
                refresh();
              }}
            >
              {pivot === 'median' ? 'Median' : 'Cursor'}
            </button>
          ))}
        </div>
        <button
          className='slender-transport-button'
          aria-label='Proportional editing'
          title='Proportional editing: nearby vertices follow (O), wheel sets the radius during a transform'
          aria-pressed={proportionalRef.current}
          onMouseDown={event => event.preventDefault()}
          onClick={toggleProportional}
        >
          <ProportionalIcon />
        </button>
        {proportionalRef.current && (
          <button
            className='slender-transport-button'
            aria-label='Connected only'
            title='Connected only: reach follows the mesh, not the air between parts (Alt+O)'
            aria-pressed={proportionalConnectedRef.current}
            onMouseDown={event => event.preventDefault()}
            onClick={toggleProportionalConnected}
          >
            <ConnectedIcon />
          </button>
        )}
        <button
          className='slender-transport-button'
          aria-label='Overlays'
          title='Overlays'
          aria-pressed={showOverlaysRef.current}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            showOverlaysRef.current = !showOverlaysRef.current;
            refresh();
          }}
        >
          <OverlaysIcon />
        </button>
        <button
          className='slender-transport-button'
          aria-label='X-Ray'
          title='X-Ray: see and select through surfaces (Alt+Z)'
          aria-pressed={xRayRef.current}
          onMouseDown={event => event.preventDefault()}
          onClick={toggleXRay}
        >
          <XRayIcon />
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />
          {transformPanelOpen && renderTransformPanel()}
        </div>
        <PaneDivider
          orientation='vertical'
          label='Resize side panes'
          value={outlinerWidth}
          min={MIN_OUTLINER_WIDTH}
          max={Math.max(MIN_OUTLINER_WIDTH, window.innerWidth - MIN_VIEWPORT_SIZE)}
          inverted
          onChange={setOutlinerWidth}
        />
        <div data-testid='outliner-pane' style={{ display: 'flex', flexDirection: 'column', width: outlinerWidth, flexShrink: 0, minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Outliner
              document={document}
              onPick={pickFromOutliner}
              onPickBone={pickBoneFromOutliner}
              onRenameBone={(id, name) => apply(renameBone(currentDocument(), id, name))}
              onRenameObject={(id, name) => apply(renameObject(currentDocument(), id, name))}
              onRenameFolder={(id, name) => apply(renameFolder(currentDocument(), id, name))}
              onToggleObject={id => apply(toggleObjectVisible(currentDocument(), id))}
              onToggleFolder={id => apply(toggleFolderVisible(currentDocument(), id))}
              onToggleObjectSelectable={id => apply(toggleObjectSelectable(currentDocument(), id))}
              onToggleFolderSelectable={id => apply(toggleFolderSelectable(currentDocument(), id))}
              onAddFolder={() => apply(addFolder(currentDocument()))}
              onDeleteFolder={id => apply(deleteFolder(currentDocument(), id))}
              onMove={(items, folder) => apply(moveToFolder(currentDocument(), items, folder))}
            />
          </div>
          <PaneDivider
            orientation='horizontal'
            label='Resize object pane'
            value={objectPaneHeight}
            min={MIN_OBJECT_PANE_HEIGHT}
            max={Math.max(MIN_OBJECT_PANE_HEIGHT, window.innerHeight - timelineHeight - MIN_OUTLINER_HEIGHT - 120)}
            inverted
            onChange={setObjectPaneHeight}
          />
          <div style={{ display: 'flex', flexDirection: 'column', height: objectPaneHeight, flexShrink: 0, background: '#1c1f27' }}>
            <div role='tablist' style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #2a2e39' }}>
              {(['object', 'world', 'render'] as const).map(tab => (
                <button
                  key={tab}
                  role='tab'
                  aria-selected={propertiesTab === tab}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => setPropertiesTab(tab)}
                  className='slender-tab'
                  aria-label={{ object: 'Object', world: 'World', render: 'Render' }[tab]}
                  title={{ object: 'Object', world: 'World', render: 'Render' }[tab]}
                >
                  {{ object: <ObjectModeIcon />, world: <WorldIcon />, render: <RenderIcon /> }[tab]}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
            {propertiesTab === 'render' ? (
              <div data-testid='render-pane' onPointerDown={endDragStep}>
                <Section title='Frames'>
                  <Row label='Frame rate'>
                    <NumberField label='Frame rate' value={document.frameRate} dragStep={1} onCommit={changeFrameRate} onDragEnd={endDragStep} />
                  </Row>
                  <Row label='Start'>
                    <NumberField label='Render start frame' value={document.frameStart} dragStep={1} onCommit={changeFrameStart} onDragEnd={endDragStep} />
                  </Row>
                  <Row label='End'>
                    <NumberField label='Render end frame' value={document.frameEnd} dragStep={1} onCommit={changeFrameEnd} onDragEnd={endDragStep} />
                  </Row>
                  <div style={{ opacity: 0.6, fontSize: 12 }}>
                    {document.frameEnd - document.frameStart + 1} frames, {((document.frameEnd - document.frameStart + 1) / document.frameRate).toFixed(2)} seconds
                  </div>
                </Section>
              </div>
            ) : propertiesTab === 'world' ? (
              <div
                data-testid='world-pane'
                onPointerDown={() => { historyRef.current = endStep(historyRef.current); }}
                style={{ padding: '6px 10px' }}
              >
                <label style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 6 }}>
                  <span>Sky</span>
                  <input
                    type='color'
                    aria-label='Sky color'
                    value={rgbToHex(document.skyColor)}
                    onChange={event => {
                      const skyColor = hexToRgb(event.target.value);
                      apply({ ...currentDocument(), skyColor }, 'sky-color');
                    }}
                  />
                </label>
              </div>
            ) : (
            <ObjectPane
              document={document}
              object={active}
              time={timeRef.current}
              onEndStep={() => { historyRef.current = endStep(historyRef.current); }}
              onChangeStyle={changeStyle}
              onSetParent={parent => active && apply(setParent(currentDocument(), active.id, parent, timeRef.current))}
              constraintHandlers={constraintHandlers(active?.id ?? '')}
              rig={active && !active.ellipsoid && renderRigPanes(active)}
            />
            )}
            </div>
          </div>
        </div>
      </div>
      <PaneDivider
        orientation='horizontal'
        label='Resize animation pane'
        value={timelineHeight}
        min={MIN_TIMELINE_HEIGHT}
        max={Math.max(MIN_TIMELINE_HEIGHT, window.innerHeight - MIN_VIEWPORT_SIZE - TOOLBAR_AND_STATUS_HEIGHT)}
        inverted
        onChange={setTimelineHeight}
      />
      <div data-testid='timeline-pane' style={{ height: timelineHeight, flexShrink: 0 }}>
        <Timeline
          locked={isTransforming()}
          document={document}
          time={timeRef.current}
          onFrameStartChange={changeFrameStart}
          onFrameEndChange={changeFrameEnd}
          onDragEnd={endDragStep}
          onEdit={change => apply(change(currentDocument()))}
          onBeginKeyEdit={beginKeyEdit}
          onMessage={setMessage}
          keying={keyingRef.current}
          onKeyingChange={keying => {
            keyingRef.current = keying;
            refresh();
          }}
          onModeChange={curves => {
            if (curves) {
              setTimelineHeight(height => Math.max(height, Math.min(CURVES_MIN_HEIGHT, window.innerHeight - MIN_VIEWPORT_SIZE - TOOLBAR_AND_STATUS_HEIGHT)));
            }
          }}
          playing={playingRef.current}
          onSeek={seek}
          onTogglePlaying={togglePlaying}
          onInsertKey={insertKey}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 12px' }}>
        <span data-testid='message'>{message}</span>
        <span data-testid='counts'>{counts}</span>
      </div>
      {menu && (
        <div
          role='menu'
          aria-label={{ add: 'Add', parent: 'Set Parent To', boneParent: 'Make Parent', file: 'File', snap: 'Snap', specials: 'Specials', separate: 'Separate' }[menu.kind]}
          style={{ position: 'fixed', left: menu.x, top: menu.y, background: '#262a35', border: '1px solid #4a5060', borderRadius: 4, padding: 4, minWidth: 120 }}
        >
          {menu.kind === 'snap' && (
            <>
              <div style={{ padding: '2px 8px', opacity: 0.6 }}>Snap</div>
              {(Object.keys(SNAP_LABELS) as SnapAction[]).map(action => (
                <button key={action} role='menuitem' onClick={() => snap(action)} className='slender-menu-item'>{SNAP_LABELS[action]}</button>
              ))}
            </>
          )}
          {menu.kind === 'specials' && (
            <>
              <div style={{ padding: '2px 8px', opacity: 0.6 }}>Specials</div>
              <button role='menuitem' onClick={subdivide} className='slender-menu-item'>Subdivide</button>
            </>
          )}
          {menu.kind === 'separate' && (
            <>
              <div style={{ padding: '2px 8px', opacity: 0.6 }}>Separate</div>
              <button role='menuitem' onClick={() => separate(false)} className='slender-menu-item'>Selection</button>
              <button role='menuitem' onClick={() => separate(true)} className='slender-menu-item'>By Loose Parts</button>
            </>
          )}
          {menu.kind === 'file' && (
            <>
              <button role='menuitem' onClick={newProject} className='slender-menu-item'>New</button>
              <button role='menuitem' onClick={openFile} className='slender-menu-item'>Open…</button>
              {recent.length > 0 && <div style={{ padding: '2px 8px', opacity: 0.6 }}>Open Recent</div>}
              {recent.map(({ name, handle, openedAt }) => (
                <button key={`${name}:${openedAt}`} role='menuitem' onClick={() => openRecent(handle)} className='slender-menu-item' style={{ paddingLeft: 16 }}>{name}</button>
              ))}
              <button role='menuitem' onClick={() => saveFile(false)} className='slender-menu-item'>Save</button>
              <button role='menuitem' onClick={() => saveFile(true)} className='slender-menu-item'>Save As…</button>
              <button role='menuitem' onClick={exportFrameSvg} className='slender-menu-item'>Export Frame (SVG)</button>
              <button role='menuitem' onClick={exportAnimationSvg} className='slender-menu-item'>Export Animation (SVG)</button>
              <button role='menuitem' onClick={exportVideo} className='slender-menu-item'>Export Video (WebM)</button>
              {recoverable && (
                <button role='menuitem' title={`From ${new Date(recoverable.savedAt).toLocaleString()}`} onClick={recoverSession} className='slender-menu-item'>Recover Last Session</button>
              )}
            </>
          )}
          {menu.kind === 'parent' && (
            <>
              <div style={{ padding: '2px 8px', opacity: 0.6 }}>Set Parent To</div>
              {parentKinds(document, active).map(kind => (
                <button key={kind} role='menuitem' onClick={() => chooseParent(kind)} className='slender-menu-item'>{PARENT_MENU_LABELS[kind]}</button>
              ))}
            </>
          )}
          {menu.kind === 'boneParent' && (
            <>
              <div style={{ padding: '2px 8px', opacity: 0.6 }}>Make Parent</div>
              <button role='menuitem' onClick={() => chooseBoneParent(true)} className='slender-menu-item'>Connected</button>
              <button role='menuitem' onClick={() => chooseBoneParent(false)} className='slender-menu-item'>Keep Offset</button>
            </>
          )}
          {menu.kind === 'add' && (
            <>
              <div style={{ padding: '2px 8px', opacity: 0.6 }}>{document.mode === 'edit' ? (isArmature ? 'Add to armature' : 'Add to mesh') : 'Add object'}</div>
              {isArmature && document.mode === 'edit' ? (
                <button role='menuitem' onClick={addBoneToArmature} className='slender-menu-item'><BoneIcon />Bone</button>
              ) : CREATE_ITEMS.map(({ label, icon, make }) => (
                <button
                  key={label}
                  role='menuitem'
                  onClick={() => addPrimitive(label, make)}
                  className='slender-menu-item'
                >
                  {icon}{label}
                </button>
              ))}
              {document.mode === 'object' && (
                <>
                  <button role='menuitem' onClick={addEllipsoidObject} className='slender-menu-item'><EllipsoidIcon />Ellipsoid</button>
                  <button role='menuitem' onClick={addCamera} className='slender-menu-item'><CameraIcon />Camera</button>
                  <button role='menuitem' onClick={addArmatureObject} className='slender-menu-item'><BoneIcon />Armature</button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
