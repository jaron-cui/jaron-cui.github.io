import {
  addConstraint, addFolder, addObject, changeRowKeys, chooseCamera, clickObject, deleteFolder, deleteObjects,
  duplicateObjects, EditorDocument, emptyDocument, findObject, isVisible, moveToFolder, objectOrigin, objectsInBox,
  occlusionTest, pickObject, raycastSurface, removeConstraint, renameFolder, renameObject, rowKeyTimes, selectedVisible, selectObjects, setParent, toggleFolderVisible,
  toggleObjectVisible, toLocal, topLevelOnly, toScene, toWorld, transformAt, transformParts, updateConstraint,
  updateObject, validParents, viewFromObject, withTransformParts, worldMatrices, worldVertices,
} from './document';
import { ConstraintKind } from './constraints';
import { commit, endStep, redo, startHistory, undo } from './history';
import { retimeKeys, writeKeys } from './keyframes';
import { applyMatrix, decompose, invertMatrix, multiply, rotateEuler, transformMatrix } from './matrix';
import { Camera, Transform, Vec3 } from './model';
import { cameraGizmoMesh, cubeMesh, MeshData, planeMesh, vertexMesh } from './primitives';
import { projectPoint } from './project';

// Looks along +z with +y toward the bottom of the image.
const FRONT: Camera = { position: { x: 0, y: 0, z: -500 }, rotation: { x: Math.PI / 2, y: 0, z: 0 }, focalLength: 500 };

const SQUARE: MeshData = {
  vertices: [{ x: -50, y: -50, z: 0 }, { x: 50, y: -50, z: 0 }, { x: 50, y: 50, z: 0 }, { x: -50, y: 50, z: 0 }],
  faces: [[0, 1, 2], [0, 2, 3]],
  edges: [],
};

function withObjects(...names: string[]): EditorDocument {
  return names.reduce((document, name) => addObject(document, name, SQUARE), emptyDocument());
}

function moved(document: EditorDocument, id: string, position: Vec3): EditorDocument {
  return updateObject(document, id, object => {
    const [, rotation, scale] = transformParts(object);
    return withTransformParts(object, [position, rotation, scale]);
  });
}

describe('history', () => {
  it('undoes and redoes in order, and a new commit clears redo', () => {
    let history = startHistory(1);
    history = commit(history, 2);
    history = commit(history, 3);
    history = undo(history);
    expect(history.present).toBe(2);
    history = undo(history);
    expect(history.present).toBe(1);
    history = redo(history);
    expect(history.present).toBe(2);
    history = commit(history, 9);
    expect(redo(history).present).toBe(9);
    expect(undo(history).present).toBe(2);
  });

  it('stops at both ends', () => {
    const history = startHistory(1);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it('merges commits with the same key into one step, until the step ends', () => {
    let history = commit(startHistory(0), 1, 'drag');
    history = commit(history, 2, 'drag');
    expect(undo(history).present).toBe(0);
    history = commit(endStep(history), 3, 'drag');
    expect(undo(history).present).toBe(2);
  });

  it('ignores committing the present, so no-ops make no undo step', () => {
    const history = commit(startHistory(0), 1);
    expect(commit(history, 1)).toBe(history);
  });

  it('restores a whole document, selection included', () => {
    const before = withObjects('Cube');
    const id = before.objects[0].id;
    const after = clickObject(before, null, false);
    expect(undo(commit(startHistory(before), after)).present.selectedObjects).toEqual([id]);
  });
});

describe('objects', () => {
  it('gives copies new ids and numbered names, and selects them', () => {
    const document = duplicateObjects(duplicateObjects(withObjects('Cube')));
    expect(document.objects.map(object => object.name)).toEqual(['Cube', 'Cube.001', 'Cube.002']);
    expect(new Set(document.objects.map(object => object.id)).size).toBe(3);
    expect(document.selectedObjects).toEqual([document.objects[2].id]);
  });

  it('copies animation along with the object', () => {
    let document = withObjects('Cube');
    const id = document.objects[0].id;
    document = updateObject(document, id, object => ({ ...object, vertices: writeKeys(object.vertices as Vec3[], [0], object.vertices as Vec3[], 1) }));
    expect(rowKeyTimes(duplicateObjects(document), 'selected')).toEqual([1]);
  });

  it('keeps ids stable through rename, and names unique', () => {
    const document = withObjects('Cube', 'Plane');
    const plane = document.objects[1];
    const renamed = renameObject(document, plane.id, 'Cube');
    expect(findObject(renamed, plane.id)?.name).toBe('Cube.001');
    expect(renameObject(document, plane.id, '   ')).toBe(document);
    expect(renameObject(document, plane.id, 'Plane')).toBe(document);
  });

  it('selects one, toggles with additive, and clears only without it', () => {
    const document = withObjects('A', 'B');
    const [a, b] = document.objects.map(object => object.id);
    const one = clickObject(document, a, false);
    expect(one.selectedObjects).toEqual([a]);
    const both = clickObject(one, b, true);
    expect(both.selectedObjects).toEqual([a, b]);
    expect(both.activeObject).toBe(b);
    expect(clickObject(both, a, true).selectedObjects).toEqual([b]);
    expect(clickObject(both, null, true)).toBe(both);
    expect(clickObject(both, null, false).selectedObjects).toEqual([]);
  });

  it('builds a scene with each object placed by its own transform', () => {
    const start = withObjects('A');
    const document = moved(start, start.objects[0].id, { x: 40, y: 0, z: 0 });
    const [node] = toScene(document, FRONT, 0, null).nodes;
    expect(node.transform.position.x).toBe(40);
    expect(worldVertices(document, document.objects[0], 0)[0].x).toBe(-10);
  });

  it('draws a transformation in progress without changing the document', () => {
    const document = withObjects('A');
    const { id } = document.objects[0];
    const transform: Transform = { position: { x: 7, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    const [node] = toScene(document, FRONT, 0, { kind: 'objects', transforms: new Map([[id, transform]]) }).nodes;
    expect(node.transform.position.x).toBe(7);
    expect(worldVertices(document, document.objects[0], 0)[0].x).toBe(-50);
  });
});

describe('camera objects', () => {
  const withCamera = () => addObject(withObjects('Cube'), 'Camera', cameraGizmoMesh(), { focalLength: 600 });

  it('are not rendered, but can be picked and box selected by their wire shape', () => {
    const document = moved(withCamera(), 'object-2', { x: 0, y: 0, z: -200 });
    expect(toScene(document, FRONT, 0, null).nodes.map(node => node.name)).toEqual(['Cube']);
    // A corner of the wire shape: 40 across, 60 ahead along +y, 28 up along +z from z = -200.
    const corner = { x: 40 * 500 / 328, y: 60 * 500 / 328 };
    expect(pickObject({ ...document, objects: [document.objects[1]] }, FRONT, 0, corner, 5)).toBe('object-2');
  });

  it('give a view from their own animated position and rotation', () => {
    const document = withCamera();
    const keyed = updateObject(document, 'object-2', current => {
      const parts = transformParts(current);
      const placed = writeKeys(parts, [0, 1, 2], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }], 0);
      return withTransformParts(current, writeKeys(placed, [0], [{ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }], 2));
    });
    const view = viewFromObject(keyed, keyed.objects[1], 2, null);
    expect(view.position.x).toBe(100);
    expect(view.focalLength).toBe(600);
  });

  it('prefer the active camera, then any camera, then none', () => {
    expect(chooseCamera(withObjects('Cube'))).toBeNull();
    const document = withCamera();
    expect(chooseCamera(document)?.id).toBe('object-2');
    expect(chooseCamera(clickObject(document, 'object-1', false))?.id).toBe('object-2');
    const two = addObject(document, 'Camera', cameraGizmoMesh(), { focalLength: 300 });
    expect(chooseCamera(two)?.name).toBe('Camera.001');
    expect(chooseCamera(clickObject(two, 'object-1', false))?.name).toBe('Camera');
  });

  it('stay cameras when duplicated', () => {
    const copy = duplicateObjects(withCamera());
    expect(copy.objects[2].camera?.focalLength).toBe(600);
  });
});

describe('raycastSurface', () => {
  const down = { x: 0, y: 0, z: -1 };

  it('finds the nearest face along a ray, wherever its object is placed', () => {
    const start = addObject(withObjects('Low'), 'High', planeMesh(50));
    const [low, high] = start.objects.map(object => object.id);
    const document = moved(moved(start, low, { x: 0, y: 0, z: 0 }), high, { x: 0, y: 0, z: 40 });
    expect(raycastSurface(document, 0, { x: 0, y: 0, z: 100 }, down)).toBeCloseTo(60);
    expect(raycastSurface(toggleObjectVisible(document, high), 0, { x: 0, y: 0, z: 100 }, down)).toBeCloseTo(100);
  });

  it('misses beside a face, and behind the ray', () => {
    const document = addObject(emptyDocument(), 'Plane', planeMesh(50));
    expect(raycastSurface(document, 0, { x: 80, y: 0, z: 100 }, down)).toBeNull();
    expect(raycastSurface(document, 0, { x: 0, y: 0, z: -100 }, down)).toBeNull();
  });

  it('ignores cameras and lines', () => {
    const line: MeshData = { vertices: [{ x: -9, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }], faces: [], edges: [[0, 1]] };
    const document = addObject(addObject(emptyDocument(), 'Line', line), 'Camera', cameraGizmoMesh(), { focalLength: 800 });
    expect(raycastSurface(document, 0, { x: 0, y: 0, z: 100 }, down)).toBeNull();
  });
});

describe('occlusionTest', () => {
  it('hides what is behind a face but not what is on or in front of it', () => {
    const start = addObject(emptyDocument(), 'Plane', planeMesh(50));
    const hidden = occlusionTest(start, 0, FRONT);
    expect(hidden({ x: 0, y: 0, z: 100 })).toBe(true);
    expect(hidden({ x: 50, y: 50, z: 0 })).toBe(false);
    expect(hidden({ x: 10, y: 10, z: 0 })).toBe(false);
    expect(hidden({ x: 0, y: 0, z: -100 })).toBe(false);
    expect(hidden({ x: 90, y: 0, z: 100 })).toBe(false);
  });

  it('shows a cube only its near vertices', () => {
    const document = addObject(emptyDocument(), 'Cube', cubeMesh(50));
    const view = { position: { x: 300, y: -350, z: 400 }, rotation: { x: -0.7, y: 0, z: 0.7 }, focalLength: 500 };
    const hidden = occlusionTest(document, 0, view);
    expect(worldVertices(document, document.objects[0], 0).filter(hidden)).toHaveLength(1);
  });

  it('leaves objects out of a box when all their vertices are hidden', () => {
    const start = addObject(addObject(emptyDocument(), 'Small', cubeMesh(5)), 'Wall', planeMesh(50));
    const wall = start.objects[1].id;
    const document = moved(start, wall, { x: 0, y: 0, z: -100 });
    const box = [{ x: -70, y: -70 }, { x: 70, y: 70 }] as const;
    expect(objectsInBox(document, FRONT, 0, box[0], box[1]).sort()).toEqual([start.objects[0].id, wall].sort());
    expect(objectsInBox(document, FRONT, 0, box[0], box[1], occlusionTest(document, 0, FRONT))).toEqual([wall]);
  });
});

describe('world', () => {
  it('uses the sky color as the opaque background', () => {
    const document = { ...withObjects('A'), skyColor: { r: 0.5, g: 0.25, b: 1 } };
    expect(toScene(document, FRONT, 0, null).background).toEqual({ r: 0.5, g: 0.25, b: 1, a: 1 });
  });
});

describe('deleting', () => {
  it('removes objects, keeps children in place in the world, and clears constraints on them', () => {
    const start = withObjects('Parent', 'Child', 'Follower');
    const [parent, child, follower] = start.objects.map(object => object.id);
    let document = setParent(moved(start, parent, { x: 100, y: 0, z: 0 }), child, parent, 0);
    document = addConstraint(document, follower, 'copyLocation');
    const constraint = findObject(document, follower)!.constraints[0].id;
    document = updateConstraint(document, follower, constraint, { target: parent });
    const before = objectOrigin(document, child, 0);
    document = deleteObjects(document, [parent], 0);
    expect(document.objects.map(object => object.id)).toEqual([child, follower]);
    expect(findObject(document, child)!.parent).toBeNull();
    expect(objectOrigin(document, child, 0).x).toBeCloseTo(before.x);
    expect(findObject(document, follower)!.constraints[0].target).toBeNull();
  });

  it('clears the active object and leaves edit mode when it goes', () => {
    const start = withObjects('A');
    const document = deleteObjects({ ...start, mode: 'edit' }, [start.objects[0].id], 0);
    expect(document.activeObject).toBeNull();
    expect(document.mode).toBe('object');
  });
});

describe('folders and visibility', () => {
  it('moves items in and out, keeps folders from containing themselves, and is a no-op when unchanged', () => {
    let document = addFolder(addFolder(withObjects('A')));
    const [outer, inner] = document.folders.map(folder => folder.id);
    const a = document.objects[0].id;
    document = moveToFolder(document, [{ kind: 'folder', id: inner }], outer);
    expect(document.folders[1].parent).toBe(outer);
    expect(moveToFolder(document, [{ kind: 'folder', id: outer }], inner)).toBe(document);
    expect(moveToFolder(document, [{ kind: 'folder', id: outer }], outer)).toBe(document);
    document = moveToFolder(document, [{ kind: 'object', id: a }], inner);
    expect(document.objects[0].folder).toBe(inner);
    expect(moveToFolder(document, [{ kind: 'object', id: a }], inner)).toBe(document);
    document = moveToFolder(document, [{ kind: 'object', id: a }], null);
    expect(document.objects[0].folder).toBeNull();
  });

  it('names folders uniquely, and refuses blank names', () => {
    const document = addFolder(addFolder(emptyDocument()));
    expect(document.folders.map(folder => folder.name)).toEqual(['Folder', 'Folder.001']);
    expect(renameFolder(document, document.folders[1].id, 'Folder').folders[1].name).toBe('Folder.001');
    expect(renameFolder(document, document.folders[1].id, '  ')).toBe(document);
  });

  it('deleting a folder moves its contents up rather than deleting them', () => {
    let document = addFolder(addFolder(withObjects('A')));
    const [outer, inner] = document.folders.map(folder => folder.id);
    document = moveToFolder(moveToFolder(document, [{ kind: 'folder', id: inner }], outer), [{ kind: 'object', id: document.objects[0].id }], inner);
    document = deleteFolder(document, inner);
    expect(document.objects[0].folder).toBe(outer);
    expect(document.folders.map(folder => folder.id)).toEqual([outer]);
  });

  it('hides objects from rendering, picking and selection, directly or through any folder level', () => {
    let document = addFolder(addFolder(withObjects('A')));
    const [outer, inner] = document.folders.map(folder => folder.id);
    const { id } = document.objects[0];
    document = moveToFolder(moveToFolder(document, [{ kind: 'folder', id: inner }], outer), [{ kind: 'object', id }], inner);
    expect(pickObject(document, FRONT, 0, { x: 0, y: 0 }, 5)).toBe(id);

    const hidden = toggleFolderVisible(document, outer);
    expect(isVisible(hidden, hidden.objects[0])).toBe(false);
    expect(toScene(hidden, FRONT, 0, null).nodes).toEqual([]);
    expect(pickObject(hidden, FRONT, 0, { x: 0, y: 0 }, 5)).toBeNull();
    expect(objectsInBox(hidden, FRONT, 0, { x: -100, y: -100 }, { x: 100, y: 100 })).toEqual([]);
    // Hiding leaves the selection alone. Actions go through selectedVisible instead.
    expect(hidden.selectedObjects).toEqual([id]);
    expect(hidden.activeObject).toBe(id);
    expect(selectedVisible(hidden)).toEqual([]);

    const shown = toggleFolderVisible(hidden, outer);
    expect(isVisible(shown, shown.objects[0])).toBe(true);
    const hiddenObject = toggleObjectVisible(shown, id);
    expect(isVisible(hiddenObject, hiddenObject.objects[0])).toBe(false);
  });

  it('leaves edit mode when the object being edited is hidden', () => {
    const start = withObjects('A');
    expect(toggleObjectVisible({ ...start, mode: 'edit' }, start.objects[0].id).mode).toBe('object');
  });
});

describe('parenting', () => {
  it('moves children with their parent, through several levels', () => {
    const start = withObjects('A', 'B', 'C');
    const [a, b, c] = start.objects.map(object => object.id);
    let document = setParent(setParent(start, b, a, 0), c, b, 0);
    document = moved(document, a, { x: 50, y: 0, z: 0 });
    expect(objectOrigin(document, c, 0).x).toBeCloseTo(50);
    expect(worldVertices(document, findObject(document, c)!, 0)[0].x).toBeCloseTo(0);
  });

  it('keeps an unanimated object in place when parented and unparented', () => {
    const start = withObjects('Parent', 'Child');
    const [parent, child] = start.objects.map(object => object.id);
    let document = updateObject(moved(start, child, { x: 30, y: 10, z: -5 }), parent, object => withTransformParts(
      object, [{ x: 100, y: -20, z: 40 }, { x: 0.3, y: 0.8, z: -0.4 }, { x: 2, y: 2, z: 2 }]
    ));
    document = setParent(document, child, parent, 0);
    const near = (p: Vec3) => {
      expect(p.x).toBeCloseTo(30);
      expect(p.y).toBeCloseTo(10);
      expect(p.z).toBeCloseTo(-5);
    };
    near(objectOrigin(document, child, 0));
    expect(transformAt(findObject(document, child)!, 0).position.x).not.toBeCloseTo(30);
    near(objectOrigin(setParent(document, child, null, 0), child, 0));
  });

  it('leaves an animated transform as keyed', () => {
    const start = withObjects('Parent', 'Child');
    const [parent, child] = start.objects.map(object => object.id);
    const keyed = updateObject(moved(start, parent, { x: 100, y: 0, z: 0 }), child, object => {
      const parts = transformParts(object);
      return withTransformParts(object, writeKeys(parts, [0, 1, 2], parts as Vec3[], 0));
    });
    const document = setParent(keyed, child, parent, 0);
    expect(rowKeyTimes(document, 'all')).toEqual([0]);
    expect(objectOrigin(document, child, 0).x).toBeCloseTo(100);
  });

  it('refuses loops', () => {
    const start = withObjects('A', 'B', 'C');
    const [a, b, c] = start.objects.map(object => object.id);
    const document = setParent(setParent(start, b, a, 0), c, b, 0);
    expect(setParent(document, a, c, 0)).toBe(document);
    expect(setParent(document, a, a, 0)).toBe(document);
    expect(validParents(document, findObject(document, a)!)).toEqual([]);
    expect(validParents(document, findObject(document, c)!).map(object => object.id)).toEqual([a, b]);
  });

  it('skips children of selected parents, which already move along', () => {
    const start = withObjects('A', 'B', 'C');
    const [a, b, c] = start.objects.map(object => object.id);
    const document = setParent(start, b, a, 0);
    expect(topLevelOnly(document, [a, b, c])).toEqual([a, c]);
  });
});

describe('constraints', () => {
  const pair = () => {
    const start = withObjects('Subject', 'Target');
    const [subject, target] = start.objects.map(object => object.id);
    return { document: moved(start, target, { x: 100, y: 0, z: 0 }), subject, target };
  };
  const withConstraint = (kind: ConstraintKind, influence = 1) => {
    const { document, subject, target } = pair();
    const added = addConstraint(document, subject, kind);
    const { id } = findObject(added, subject)!.constraints[0];
    return { document: updateConstraint(added, subject, id, { target, influence }), subject, target, id };
  };

  it('does nothing without a target', () => {
    const { document, subject } = pair();
    const added = addConstraint(document, subject, 'copyLocation');
    expect(objectOrigin(added, subject, 0).x).toBe(0);
  });

  it('copies location, and follows the target', () => {
    const { document, subject, target } = withConstraint('copyLocation');
    expect(objectOrigin(document, subject, 0).x).toBe(100);
    expect(objectOrigin(moved(document, target, { x: 7, y: 8, z: 9 }), subject, 0)).toEqual({ x: 7, y: 8, z: 9 });
  });

  it('blends by influence', () => {
    expect(objectOrigin(withConstraint('copyLocation', 0.25).document, 'object-1', 0).x).toBeCloseTo(25);
    expect(objectOrigin(withConstraint('copyLocation', 0).document, 'object-1', 0).x).toBe(0);
  });

  it('copies rotation without changing scale or position', () => {
    const { document, subject, target } = withConstraint('copyRotation');
    const turned = updateObject(document, target, object => withTransformParts(object, [{ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 0.5 }, { x: 3, y: 3, z: 3 }]));
    const { rotation, scale, position } = decompose(worldMatrices(turned, 0).get(subject)!);
    expect(rotation.z).toBeCloseTo(0.5);
    expect(scale.x).toBeCloseTo(1);
    expect(position.x).toBeCloseTo(0);
  });

  it('aims local +y at the target with no roll, so a camera sees it dead center', () => {
    const { document, subject } = withConstraint('lookAt');
    const placed = moved(document, subject, { x: 0, y: -40, z: -300 });
    const view = viewFromObject(placed, findObject(placed, subject)!, 0, null);
    const seen = projectPoint(view, { x: 100, y: 0, z: 0 })!;
    expect(seen.x).toBeCloseTo(0);
    expect(seen.y).toBeCloseTo(0);
    const above = applyMatrix(worldMatrices(placed, 0).get(subject)!, 0, 0, 1);
    expect(above.z).toBeGreaterThan(-300);
  });

  it('survives looking straight along the world vertical, and at its own position', () => {
    const { document, subject, target } = withConstraint('lookAt');
    const straight = moved(document, target, { x: 0, y: 0, z: 100 });
    worldMatrices(straight, 0).get(subject)!.forEach(value => expect(Number.isFinite(value)).toBe(true));
    const same = moved(document, target, { x: 0, y: 0, z: 0 });
    worldMatrices(same, 0).get(subject)!.forEach(value => expect(Number.isFinite(value)).toBe(true));
  });

  it('does not hang on a constraint loop, or on a parent chain closed by a constraint', () => {
    const { document, subject, target } = withConstraint('copyLocation');
    const added = addConstraint(document, target, 'copyLocation');
    const looped = updateConstraint(added, target, findObject(added, target)!.constraints[0].id, { target: subject });
    expect(worldMatrices(looped, 0).size).toBe(2);
    expect(worldMatrices(setParent(looped, subject, target, 0), 0).size).toBe(2);
  });

  it('points constraints at the copied target', () => {
    const { document, subject, target, id } = withConstraint('copyLocation');
    const both = duplicateObjects(selectObjects(document, [subject, target], subject));
    const copies = both.objects.slice(2);
    const subjectCopy = copies.find(object => object.constraints.some(constraint => constraint.id === id))!;
    expect(subjectCopy.constraints[0].target).toBe(copies.find(object => object !== subjectCopy)!.id);
  });

  it('can be removed, and copy with a duplicated object', () => {
    const { document, subject, id } = withConstraint('copyLocation');
    expect(objectOrigin(removeConstraint(document, subject, id), subject, 0).x).toBe(0);
    const copy = duplicateObjects(selectObjects(document, [subject], subject));
    expect(copy.objects[2].constraints).toHaveLength(1);
  });
});

describe('duplicating related objects', () => {
  const related = () => {
    const base = withObjects('Parent', 'Child', 'Other');
    const [parent, child, other] = base.objects.map(object => object.id);
    return { document: setParent(base, child, parent, 0), parent, child, other };
  };
  const copyOf = (document: EditorDocument, name: string) => document.objects.find(object => object.name === `${name}.001`)!;

  it('parents a copied child to the copied parent, in either selection order', () => {
    const { document, parent, child } = related();
    [[parent, child], [child, parent]].forEach(order => {
      const copied = duplicateObjects(selectObjects(document, order, order[1]));
      expect(copyOf(copied, 'Child').parent).toBe(copyOf(copied, 'Parent').id);
      expect(copyOf(copied, 'Parent').parent).toBeNull();
      expect(findObject(copied, child)!.parent).toBe(parent);
      expect(topLevelOnly(copied, copied.selectedObjects)).toEqual([copyOf(copied, 'Parent').id]);
    });
  });

  it('keeps a copied child on the original parent when the parent is not copied', () => {
    const { document, parent, child } = related();
    expect(copyOf(duplicateObjects(selectObjects(document, [child], child)), 'Child').parent).toBe(parent);
  });

  it('makes the copy of the active object active', () => {
    const { document, parent, child } = related();
    const copied = duplicateObjects(selectObjects(document, [parent, child], parent));
    expect(copied.activeObject).toBe(copyOf(copied, 'Parent').id);
  });
});

describe('local and world space', () => {
  const transform: Transform = {
    position: { x: 10, y: -20, z: 30 },
    rotation: { x: 0.4, y: -0.7, z: 1.1 },
    scale: { x: 2, y: 0.5, z: 3 },
  };

  it('round trips through rotation and uneven scale', () => {
    const local = [{ x: 1, y: 2, z: 3 }, { x: -4, y: 5, z: -6 }];
    const matrix = transformMatrix(transform);
    toLocal(matrix, toWorld(matrix, local)).forEach((point, i) => {
      expect(point.x).toBeCloseTo(local[i].x);
      expect(point.y).toBeCloseTo(local[i].y);
      expect(point.z).toBeCloseTo(local[i].z);
    });
  });

  it('inverts a matrix to the identity', () => {
    const m = transformMatrix(transform);
    multiply(m, invertMatrix(m)).forEach((value, i) => expect(value).toBeCloseTo([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0][i]));
  });
});

describe('rotateEuler', () => {
  const unit: Vec3 = { x: 1, y: 1, z: 1 };
  const matrixOf = (rotation: Vec3) => transformMatrix({ position: { x: 0, y: 0, z: 0 }, rotation, scale: unit });

  it('applies a global rotation after the existing one', () => {
    const start = { x: 0.3, y: 0.5, z: -0.2 };
    const axis = { x: 0, y: 1, z: 0 };
    const next = matrixOf(rotateEuler(start, axis, 0.8));
    const expected = multiply(matrixOf({ x: 0, y: 0.8, z: 0 }), matrixOf(start));
    next.forEach((value, i) => expect(value).toBeCloseTo(expected[i]));
  });

  it('works about an arbitrary unit axis', () => {
    const axis = { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 };
    const m = matrixOf(rotateEuler({ x: 0, y: 0, z: 0 }, axis, Math.PI));
    const point = applyMatrix(m, 1, 0, 0);
    expect(point.x).toBeCloseTo(0);
    expect(point.z).toBeCloseTo(1);
  });

  it('survives the gimbal-locked pose', () => {
    const next = rotateEuler({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, Math.PI / 2);
    const m = matrixOf(next);
    const expected = matrixOf({ x: 0, y: Math.PI / 2, z: 0 });
    m.forEach((value, i) => expect(value).toBeCloseTo(expected[i]));
  });

  it('stays near the previous angles, so keys interpolate the short way', () => {
    const next = rotateEuler({ x: 0, y: 0, z: 6 * Math.PI + 0.1 }, { x: 0, y: 0, z: 1 }, 0.2);
    expect(next.z).toBeCloseTo(6 * Math.PI + 0.3);
  });
});

describe('picking objects', () => {
  it('finds the nearer object where two overlap, and nothing elsewhere', () => {
    const start = withObjects('Far', 'Near');
    const [far, near] = start.objects.map(object => object.id);
    const document = moved(moved(start, far, { x: 0, y: 0, z: 100 }), near, { x: 0, y: 0, z: -100 });
    expect(pickObject(document, FRONT, 0, { x: 0, y: 0 }, 5)).toBe(near);
    expect(pickObject(document, FRONT, 0, { x: 300, y: 300 }, 5)).toBeNull();
  });

  it('finds objects with no faces by their vertices and lines', () => {
    const line: MeshData = { vertices: [{ x: -50, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }], faces: [], edges: [[0, 1]] };
    const lone = addObject(emptyDocument(), 'Vertex', vertexMesh());
    expect(pickObject(lone, FRONT, 0, { x: 3, y: 0 }, 5)).toBe(lone.objects[0].id);
    const document = addObject(emptyDocument(), 'Line', line);
    expect(pickObject(document, FRONT, 0, { x: 10, y: 4 }, 5)).toBe(document.objects[0].id);
    expect(pickObject(document, FRONT, 0, { x: 10, y: 40 }, 5)).toBeNull();
  });

  it('box selects objects with a vertex inside', () => {
    const start = addObject(addObject(emptyDocument(), 'Plane', planeMesh(10)), 'Cube', cubeMesh(10));
    const [plane, cube] = start.objects.map(object => object.id);
    const document = moved(start, cube, { x: 200, y: 0, z: 0 });
    expect(objectsInBox(document, FRONT, 0, { x: -50, y: -50 }, { x: 50, y: 50 })).toEqual([plane]);
  });
});

describe('animation rows', () => {
  it('covers transforms and vertices in object mode, but only the selection in the selected row', () => {
    const start = withObjects('A', 'B');
    const [a, b] = start.objects.map(object => object.id);
    let document = updateObject(start, a, object => {
      const parts = transformParts(object);
      return withTransformParts(object, writeKeys(parts, [0, 1, 2], parts as Vec3[], 1));
    });
    document = updateObject(document, b, object => ({ ...object, vertices: writeKeys(object.vertices, [0], object.vertices as Vec3[], 2) }));
    document = clickObject(document, a, false);
    expect(rowKeyTimes(document, 'all')).toEqual([1, 2]);
    expect(rowKeyTimes(document, 'selected')).toEqual([1]);
  });

  it('covers only the active mesh in edit mode', () => {
    const start = withObjects('A', 'B');
    const [a, b] = start.objects.map(object => object.id);
    let document = updateObject(start, a, object => ({ ...object, vertices: writeKeys(object.vertices, [0], object.vertices as Vec3[], 1) }));
    document = updateObject(document, b, object => ({ ...object, vertices: writeKeys(object.vertices, [1], object.vertices as Vec3[], 2), selectedVertices: new Set([1]) }));
    document = { ...document, mode: 'edit', activeObject: b };
    expect(rowKeyTimes(document, 'all')).toEqual([2]);
    expect(rowKeyTimes(document, 'selected')).toEqual([2]);
  });

  it('changes keys across everything a row covers', () => {
    const start = withObjects('A');
    const { id } = start.objects[0];
    const keyed = updateObject(start, id, object => {
      const parts = transformParts(object);
      return { ...withTransformParts(object, writeKeys(parts, [0, 1, 2], parts as Vec3[], 1)), vertices: writeKeys(object.vertices, [0], object.vertices as Vec3[], 1) };
    });
    const retimed = changeRowKeys(keyed, 'all', (part, indices) => retimeKeys(part, indices, 1, 3));
    expect(rowKeyTimes(retimed, 'all')).toEqual([3]);
  });
});
