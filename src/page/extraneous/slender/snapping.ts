import {
  EditorDocument, findBone, findObject, isVisible, nodeParent, objectOrigin, parentMatrix, selectedVisible, SceneObject, toLocal, topLevelOnly, transformParts, updateObject,
  updateTransform, withTransformParts, worldMatrices, worldVertices,
} from './document';
import { selectionCenter } from './editing';
import { commitEdit } from './keyframes';
import { applyMatrix, invertMatrix, matrixOrigin } from './matrix';
import { Vec3 } from './model';

// The grid the overlay draws, which snapping lines up with.
export const GRID_SPACING = 100;

export type SnapAction =
  | 'selectionToCursor' | 'selectionToCursorOffset' | 'selectionToActive' | 'selectionToGrid'
  | 'cursorToSelected' | 'cursorToActive' | 'cursorToOrigin' | 'cursorToGrid';

export const SNAP_LABELS: Record<SnapAction, string> = {
  selectionToCursor: 'Selection to Cursor',
  selectionToCursorOffset: 'Selection to Cursor (Keep Offset)',
  selectionToActive: 'Selection to Active',
  selectionToGrid: 'Selection to Grid',
  cursorToSelected: 'Cursor to Selected',
  cursorToActive: 'Cursor to Active',
  cursorToOrigin: 'Cursor to World Origin',
  cursorToGrid: 'Cursor to Grid',
};

function toGrid({ x, y, z }: Vec3): Vec3 {
  const snap = (value: number) => Math.round(value / GRID_SPACING) * GRID_SPACING;
  return { x: snap(x), y: snap(y), z: snap(z) };
}

function editing(document: EditorDocument): SceneObject | null {
  const active = findObject(document, document.activeObject);
  return document.mode === 'edit' && active ? active : null;
}

// What Shift+S moves in object or pose mode. A bone connected to its parent cannot leave it.
function movableNodes(document: EditorDocument): string[] {
  if (document.mode !== 'pose') {
    return selectedVisible(document);
  }
  return document.selectedBones.filter(id => {
    const { armature, bone } = findBone(document, id)!;
    return !armature.bones!.some(other => other.id === bone.parent && other.tail === bone.head);
  });
}

function nodeDepth(document: EditorDocument, id: string): number {
  let depth = 0;
  for (let current = nodeParent(document, id); current; current = nodeParent(document, current)) {
    depth++;
  }
  return depth;
}

// Places an object or bone's origin at a world point, by changing its position only.
function moveNodeTo(document: EditorDocument, id: string, point: Vec3, time: number): EditorDocument {
  const node = findBone(document, id)?.bone ?? findObject(document, id)!;
  const position = applyMatrix(invertMatrix(parentMatrix(document, node, time)), point.x, point.y, point.z);
  return updateTransform(document, id, transform => {
    const posable = { transform };
    const pose: Vec3[] = [];
    pose[0] = position;
    return withTransformParts(posable, commitEdit(transformParts(posable), new Set([0]), pose, time)).transform;
  });
}

function moveSelectedVertices(document: EditorDocument, object: SceneObject, time: number, place: (world: Vec3) => Vec3): EditorDocument {
  const world = worldVertices(document, object, time);
  const moved = world.map((point, i) => (object.selectedVertices.has(i) ? place(point) : point));
  const local = toLocal(worldMatrices(document, time).get(object.id)!, moved);
  return updateObject(document, object.id, current => ({
    ...current,
    vertices: commitEdit(current.vertices, current.selectedVertices, local, time),
  }));
}

// Moves each thing to wherever place says, parents first, since moving one carries its children.
function moveNodes(document: EditorDocument, ids: string[], time: number, place: (world: Vec3) => Vec3): EditorDocument {
  return [...ids]
    .sort((a, b) => nodeDepth(document, a) - nodeDepth(document, b))
    .reduce((next, id) => moveNodeTo(next, id, place(matrixOrigin(worldMatrices(next, time).get(id)!)), time), document);
}

function selectionMedian(document: EditorDocument, time: number): Vec3 | null {
  const object = editing(document);
  if (object) {
    return object.selectedVertices.size > 0 ? selectionCenter(worldVertices(document, object, time), object.selectedVertices) : null;
  }
  const ids = document.mode === 'pose' ? document.selectedBones : selectedVisible(document);
  if (ids.length === 0) {
    return null;
  }
  const matrices = worldMatrices(document, time);
  const origins = ids.map(id => matrixOrigin(matrices.get(id)!));
  return selectionCenter(origins, new Set(origins.map((_, i) => i)));
}

function activePoint(document: EditorDocument, time: number): Vec3 | null {
  if (editing(document)) {
    return selectionMedian(document, time);
  }
  if (document.mode === 'pose' && document.activeBone) {
    return matrixOrigin(worldMatrices(document, time).get(document.activeBone)!);
  }
  const active = findObject(document, document.activeObject);
  return active && isVisible(document, active) ? objectOrigin(document, active.id, time) : null;
}

function withoutActive(document: EditorDocument, ids: string[]): string[] {
  const active = document.mode === 'pose' ? document.activeBone : document.activeObject;
  return ids.filter(id => id !== active);
}

// Carries out a Shift+S choice, which changes either the document or the scene cursor. Returns the
// same document and cursor if there was nothing to act on.
export function applySnap(document: EditorDocument, action: SnapAction, time: number, cursor: Vec3): { document: EditorDocument; cursor: Vec3 } {
  return action.startsWith('cursor')
    ? { document, cursor: snappedCursor(document, action, time, cursor) }
    : { document: snappedSelection(document, action, time, cursor), cursor };
}

function snappedCursor(document: EditorDocument, action: SnapAction, time: number, cursor: Vec3): Vec3 {
  switch (action) {
    case 'cursorToOrigin':
      return { x: 0, y: 0, z: 0 };
    case 'cursorToGrid':
      return toGrid(cursor);
    case 'cursorToSelected':
      return selectionMedian(document, time) ?? cursor;
    case 'cursorToActive':
      return activePoint(document, time) ?? cursor;
    default:
      return cursor;
  }
}

function snappedSelection(document: EditorDocument, action: SnapAction, time: number, cursor: Vec3): EditorDocument {
  const object = editing(document);
  const ids = object ? [] : movableNodes(document);
  const move = (place: (world: Vec3) => Vec3, nodes = ids) => (object
    ? moveSelectedVertices(document, object, time, place)
    : moveNodes(document, nodes, time, place));
  const hasSelection = selectionMedian(document, time) !== null;

  switch (action) {
    case 'selectionToGrid':
      return hasSelection ? move(toGrid) : document;
    case 'selectionToCursor':
      return hasSelection ? move(() => cursor) : document;
    case 'selectionToCursorOffset': {
      const median = selectionMedian(document, time);
      if (!median) {
        return document;
      }
      const offset = { x: cursor.x - median.x, y: cursor.y - median.y, z: cursor.z - median.z };
      return move(({ x, y, z }) => ({ x: x + offset.x, y: y + offset.y, z: z + offset.z }), topLevelOnly(document, ids));
    }
    case 'selectionToActive': {
      const target = activePoint(document, time);
      return target && hasSelection ? move(() => target, withoutActive(document, ids)) : document;
    }
    default:
      return document;
  }
}
