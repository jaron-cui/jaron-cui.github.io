import { automaticWeights, deformVertices, restMatrix, weightColor } from './armature';
import {
  addConstraint, addObject, deleteObjects, displayVertices, duplicateObjects, EditorDocument, emptyDocument, findBone, findObject, objectOrigin, parentMatrix,
  rowKeyTimes, setParent, topLevelOnly, transformAt, toWorld, updateBone, updateConstraint, updateObject, updateTransform, worldMatrices,
} from './document';
import { connectedDistances, falloffWeights } from './editing';
import { writeKeys } from './keyframes';
import { applyMatrix, invertMatrix, multiply } from '../../../lib/vrender/matrix';
import { Vec3 } from '../../../lib/vrender/model';
import { cubeMesh, MeshData } from './primitives';
import {
  addArmature, addBone, addVertexGroup, assignToGroup, clearTransforms, deleteBones, duplicateBones, extrudeBones, groupsAfterCopy, groupsAfterDelete, paintWeights, parentBones,
  parentSelected, renameBone, removeVertexGroup, selectedBonesOf,
} from './rigging';

const QUARTER = Math.PI / 2;

const STRIP: MeshData = {
  vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 200 }],
  faces: [],
  edges: [[0, 1], [1, 2]],
};

function near(actual: Vec3, expected: Vec3) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.z).toBeCloseTo(expected.z);
}

// An armature with two upright bones in a chain: 0 to 100, then 100 to 200.
function chain() {
  let document = addArmature(emptyDocument());
  const armature = document.activeObject!;
  document = updateObject(document, armature, object => ({ ...object, selectedVertices: new Set([1]) }));
  document = extrudeBones(document, armature, 0);
  document = updateObject(document, armature, object => ({
    ...object,
    vertices: object.vertices.map((vertex, i) => (i === 2 ? { x: 0, y: 0, z: 200 } : vertex)),
  }));
  const [root, child] = findObject(document, armature)!.bones!.map(bone => bone.id);
  return { document, armature, root, child };
}

function turned(document: EditorDocument, id: string, rotation: Vec3): EditorDocument {
  return updateTransform(document, id, transform => ({ ...transform, rotation }));
}

function worldOf(document: EditorDocument, id: string, time = 0): Vec3[] {
  const matrices = worldMatrices(document, time);
  return toWorld(matrices.get(id)!, displayVertices(document, findObject(document, id)!, time, null, matrices));
}

describe('bones', () => {
  it('aim their local +y from head to tail', () => {
    const rest = restMatrix({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 13 });
    near(applyMatrix(rest, 0, 10, 0), { x: 1, y: 2, z: 13 });
    near(applyMatrix(rest, 0, 0, 0), { x: 1, y: 2, z: 3 });
    const sideways = restMatrix({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    near(applyMatrix(sideways, 0, 10, 0), { x: 10, y: 0, z: 0 });
  });

  it('have a usable frame with no length', () => {
    expect(() => invertMatrix(restMatrix({ x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }))).not.toThrow();
    expect(invertMatrix(restMatrix({ x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 })).every(Number.isFinite)).toBe(true);
  });

  it('rest where their joints are', () => {
    const { document, armature } = chain();
    const joints = worldOf(document, armature);
    near(joints[1], { x: 0, y: 0, z: 100 });
    near(joints[2], { x: 0, y: 0, z: 200 });
  });

  it('carry their children when posed, keeping the joint shared', () => {
    const { document, armature, root } = chain();
    const joints = worldOf(turned(document, root, { x: 0, y: 0, z: QUARTER }), armature);
    near(joints[0], { x: 0, y: 0, z: 0 });
    // Local +z on an upright bone's frame, turned by a pose, moves its tail.
    const posedTail = joints[1];
    expect(Math.hypot(posedTail.x, posedTail.y, posedTail.z)).toBeCloseTo(100);
    expect(posedTail.z).toBeCloseTo(0);
    expect(Math.hypot(joints[2].x - posedTail.x, joints[2].y - posedTail.y, joints[2].z - posedTail.z)).toBeCloseTo(100);
  });

  it('follow their armature object', () => {
    const { document, armature } = chain();
    const moved = updateTransform(document, armature, transform => ({ ...transform, position: { x: 50, y: 0, z: 0 } }));
    near(worldOf(moved, armature)[2], { x: 50, y: 0, z: 200 });
  });

  it('take constraints, and objects can target them', () => {
    const { document, armature, child } = chain();
    let next = addObject(document, 'Target', cubeMesh(1));
    const target = next.activeObject!;
    next = updateTransform(next, target, transform => ({ ...transform, position: { x: 30, y: 40, z: 50 } }));
    next = addConstraint(next, child, 'copyLocation');
    const constraint = findBone(next, child)!.bone.constraints[0].id;
    next = updateConstraint(next, child, constraint, { target });
    near(worldOf(next, armature)[1], { x: 30, y: 40, z: 50 });
    expect(worldMatrices(next, 0).get(child)![3]).toBeCloseTo(30);

    let follower = addObject(next, 'Follower', cubeMesh(1));
    const id = follower.activeObject!;
    follower = addConstraint(follower, id, 'copyLocation');
    follower = updateConstraint(follower, id, findObject(follower, id)!.constraints[0].id, { target: child });
    expect(objectOrigin(follower, id, 0).x).toBeCloseTo(30);
  });

  it('survive constraint loops between them', () => {
    const { document, root, child } = chain();
    let next = addConstraint(addConstraint(document, root, 'copyLocation'), child, 'copyLocation');
    next = updateConstraint(next, root, findBone(next, root)!.bone.constraints[0].id, { target: child });
    next = updateConstraint(next, child, findBone(next, child)!.bone.constraints[0].id, { target: root });
    expect(() => worldMatrices(next, 0)).not.toThrow();
  });

  it('express pose moves through their own frame', () => {
    const { document, child } = chain();
    const bone = findBone(document, child)!.bone;
    const frame = parentMatrix(document, bone, 0);
    near(applyMatrix(frame, 0, 0, 0), { x: 0, y: 0, z: 100 });
    expect(frame).toEqual(worldMatrices(document, 0).get(child));
  });

  it('skip children of selected parents when transforming', () => {
    const { document, root, child } = chain();
    expect(topLevelOnly(document, [root, child])).toEqual([root]);
  });

  it('animate, showing in the animation rows', () => {
    const { document, child } = chain();
    const keyed = updateBone(document, child, bone => {
      const parts = [bone.transform.position, bone.transform.rotation, bone.transform.scale];
      const [position, rotation, scale] = writeKeys(parts, [0, 1, 2], parts as Vec3[], 1);
      return { ...bone, transform: { position, rotation, scale } };
    });
    expect(rowKeyTimes(keyed, 'all')).toEqual([1]);
    expect(rowKeyTimes({ ...keyed, mode: 'pose', selectedBones: [] }, 'selected')).toEqual([]);
    expect(rowKeyTimes({ ...keyed, mode: 'pose', selectedBones: [child] }, 'selected')).toEqual([1]);
  });
});

describe('editing bones', () => {
  it('extrudes a connected child from a tail, and a sibling from a head', () => {
    const { document, armature, root, child } = chain();
    const object = findObject(document, armature)!;
    const [rootBone, childBone] = object.bones!;
    expect(childBone.parent).toBe(root);
    expect(childBone.head).toBe(rootBone.tail);
    const fromHead = extrudeBones(updateObject(document, armature, current => ({ ...current, selectedVertices: new Set([1]) })), armature, 0);
    const added = findObject(fromHead, armature)!.bones![2];
    expect(added.parent).toBe(root);
    const sibling = extrudeBones(updateObject(document, armature, current => ({ ...current, selectedVertices: new Set([0]) })), armature, 0);
    expect(findObject(sibling, armature)!.bones![2].parent).toBe(null);
    expect(findObject(sibling, armature)!.bones![2].head).toBe(0);
    expect(child).toBeTruthy();
  });

  it('adds separate bones with unique names', () => {
    const { document, armature } = chain();
    const bones = findObject(addBone(document, armature), armature)!.bones!;
    expect(bones.map(bone => bone.name)).toEqual(['Bone', 'Bone.001', 'Bone.002']);
    expect(findObject(addBone(document, armature), armature)!.edges).toHaveLength(3);
  });

  it('duplicates bones and how they connect, with new ids', () => {
    const { document, armature, root, child } = chain();
    const selected = updateObject(document, armature, object => ({ ...object, selectedVertices: new Set([0, 1, 2]) }));
    const object = findObject(duplicateBones(selected, armature), armature)!;
    const [, , copyRoot, copyChild] = object.bones!;
    expect(object.vertices).toHaveLength(6);
    expect(copyRoot.id).not.toBe(root);
    expect(copyChild.id).not.toBe(child);
    expect(copyChild.parent).toBe(copyRoot.id);
    expect(copyChild.head).toBe(copyRoot.tail);
  });

  it('counts a bone as selected by its tail, so a shared joint means the upper bone', () => {
    const { document, armature, root } = chain();
    const object = findObject(updateObject(document, armature, current => ({ ...current, selectedVertices: new Set([1]) })), armature)!;
    expect(selectedBonesOf(object).map(bone => bone.id)).toEqual([root]);
  });

  it('deletes bones, attaching children upward and dropping unused joints', () => {
    const { document, armature, child } = chain();
    let next = extrudeBones(updateObject(document, armature, object => ({ ...object, selectedVertices: new Set([2]) })), armature, 0);
    next = updateObject(next, armature, object => ({ ...object, selectedVertices: new Set([2]) }));
    const object = findObject(deleteBones(next, armature, 0), armature)!;
    expect(object.bones!.map(bone => bone.id)).not.toContain(child);
    expect(object.bones![1].parent).toBe(object.bones![0].id);
    expect(object.edges).toHaveLength(2);
    expect(object.bones!.every(bone => bone.head < object.vertices.length && bone.tail < object.vertices.length)).toBe(true);
  });

  it('parents bones, optionally connecting them', () => {
    const { document, armature } = chain();
    const added = addBone(document, armature);
    const [root] = findObject(added, armature)!.bones!;
    const extra = findObject(added, armature)!.bones![2];
    const selected = { ...updateObject(added, armature, object => ({ ...object, selectedVertices: new Set([extra.tail, root.tail]) })), activeBone: root.id };
    const kept = findObject(parentBones(selected, armature, false), armature)!;
    expect(kept.bones![2].parent).toBe(root.id);
    expect(kept.vertices).toHaveLength(findObject(added, armature)!.vertices.length);
    const connected = findObject(parentBones(selected, armature, true), armature)!;
    expect(connected.bones![2].head).toBe(connected.bones![0].tail);
    expect(connected.vertices).toHaveLength(findObject(added, armature)!.vertices.length - 1);
  });

  it('refuses to parent a bone under its own child', () => {
    const { document, armature, root, child } = chain();
    const selected = { ...updateObject(document, armature, object => ({ ...object, selectedVertices: new Set([0, 1, 2]) })), activeBone: child };
    const object = findObject(parentBones(selected, armature, false), armature)!;
    expect(object.bones!.find(bone => bone.id === root)!.parent).toBe(null);
  });
});

describe('deforming', () => {
  // A strip weighted fully to the lower bone at the bottom and fully to the upper at the top.
  const rigged = () => {
    const { document, armature, root, child } = chain();
    let next = addObject(document, 'Strip', STRIP);
    const mesh = next.activeObject!;
    next = { ...next, selectedObjects: [mesh, armature], activeObject: armature };
    next = parentSelected(next, 'armature', 0).document;
    const [lower, upper] = findObject(next, mesh)!.vertexGroups.map(group => group.id);
    next = assignToGroup(assignToGroup(next, mesh, lower, new Set([0, 1]), 1), mesh, upper, new Set([1, 2]), 1);
    return { document: next, armature, mesh, root, child, lower, upper };
  };

  it('leaves a mesh alone at rest', () => {
    const { document, mesh } = rigged();
    near(worldOf(document, mesh)[2], { x: 0, y: 0, z: 200 });
  });

  it('moves weighted vertices with their bone, and blends where bones share', () => {
    const { document, mesh, armature, child } = rigged();
    const posed = turned(document, child, { x: QUARTER, y: 0, z: 0 });
    const joints = worldOf(posed, armature);
    const strip = worldOf(posed, mesh);
    near(strip[2], joints[2]);
    near(strip[0], { x: 0, y: 0, z: 0 });
    // The middle vertex sits on the joint, which the upper bone turns about, so it stays.
    near(strip[1], { x: 0, y: 0, z: 100 });
  });

  it('leaves unweighted vertices alone', () => {
    const { document, mesh, root, lower, upper } = rigged();
    const emptied = removeVertexGroup(removeVertexGroup(document, mesh, lower), mesh, upper);
    near(worldOf(turned(emptied, root, { x: QUARTER, y: 0, z: 0 }), mesh)[2], { x: 0, y: 0, z: 200 });
  });

  it('divides by total weight, so weights need not add up to one', () => {
    const skins = new Map([['a', [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, 0]], ['b', [1, 0, 0, 30, 0, 1, 0, 0, 0, 0, 1, 0]]]);
    const groups = [
      { id: '1', name: 'a', weights: new Map([[0, 0.2]]) },
      { id: '2', name: 'b', weights: new Map([[0, 0.2]]) },
    ];
    expect(deformVertices([{ x: 0, y: 0, z: 0 }], groups, skins)[0].x).toBeCloseTo(20);
  });

  it('moves a mesh only once when both it and its armature move', () => {
    const { document, mesh, armature, child } = rigged();
    const moved = updateTransform(turned(document, child, { x: QUARTER, y: 0, z: 0 }), armature, transform => ({ ...transform, position: { x: 500, y: 0, z: 0 } }));
    near(worldOf(moved, mesh)[2], worldOf(moved, armature)[2]);
    near(worldOf(moved, mesh)[0], { x: 500, y: 0, z: 0 });
  });

  it('works when the mesh is placed differently from the armature and has no parent', () => {
    const { document, mesh, armature, child } = rigged();
    const apart = updateObject(updateTransform(document, mesh, transform => ({ ...transform, position: { x: 100, y: 0, z: 0 } })), mesh, object => ({ ...object, parent: null }));
    const posed = turned(apart, child, { x: QUARTER, y: 0, z: 0 });
    // Bends about the same bone wherever it sits, so a vertex keeps its offset from the joint turned.
    const bent = worldOf(posed, mesh)[2];
    const joint = worldOf(posed, armature)[1];
    expect(Math.hypot(bent.x - joint.x, bent.y - joint.y, bent.z - joint.z)).toBeCloseTo(Math.hypot(100, 100));
  });

  it('shows plain vertices while the mesh itself is being edited', () => {
    const { document, mesh, child } = rigged();
    const posed = turned(document, child, { x: QUARTER, y: 0, z: 0 });
    expect(worldOf(posed, mesh)[2].z).not.toBeCloseTo(200);
    near(worldOf({ ...posed, mode: 'edit', activeObject: mesh }, mesh)[2], { x: 0, y: 0, z: 200 });
  });

  it('keeps group names matched when a bone is renamed', () => {
    const { document, mesh, root } = rigged();
    const renamed = renameBone(document, root, 'Thigh');
    expect(findBone(renamed, root)!.bone.name).toBe('Thigh');
    expect(findObject(renamed, mesh)!.vertexGroups[0].name).toBe('Thigh');
  });

  it('forgets its armature when the armature is deleted, keeping the mesh in place', () => {
    const { document, mesh, armature } = rigged();
    const next = deleteObjects(document, [armature], 0);
    expect(findObject(next, mesh)!.deformer).toBe(null);
    expect(findObject(next, mesh)!.parent).toBe(null);
    near(worldOf(next, mesh)[2], { x: 0, y: 0, z: 200 });
  });

  it('gives a copied armature its own bones', () => {
    const { document, armature, root } = rigged();
    const copied = duplicateObjects({ ...document, selectedObjects: [armature] });
    const bones = findObject(copied, copied.activeObject)!.bones!;
    expect(bones.map(bone => bone.id)).not.toContain(root);
    expect(bones[1].parent).toBe(bones[0].id);
    expect(() => worldMatrices(copied, 0)).not.toThrow();
  });
});

describe('parenting from the menu', () => {
  const pair = () => {
    const base = addObject(emptyDocument(), 'Child', cubeMesh(10));
    const child = base.activeObject!;
    const withParent = addObject(updateTransform(base, child, transform => ({ ...transform, position: { x: 7, y: 8, z: 9 } })), 'Parent', cubeMesh(10));
    const parent = withParent.activeObject!;
    const document = updateTransform(withParent, parent, transform => ({ ...transform, position: { x: 100, y: 0, z: 0 } }));
    return { document: { ...document, selectedObjects: [child, parent] }, child, parent };
  };

  it('keeps the child in place with Object', () => {
    const { document, child } = pair();
    const result = parentSelected(document, 'object', 0);
    expect(result.parented).toBe(1);
    near(objectOrigin(result.document, child, 0), { x: 7, y: 8, z: 9 });
  });

  it('moves the child to the parent without the inverse', () => {
    const { document, child, parent } = pair();
    const next = parentSelected(document, 'withoutInverse', 0).document;
    expect(findObject(next, child)!.parent).toBe(parent);
    near(objectOrigin(next, child, 0), { x: 100, y: 0, z: 0 });
  });

  it('reports what would make a loop', () => {
    const { document, child, parent } = pair();
    const parented = parentSelected(document, 'object', 0).document;
    const result = parentSelected({ ...parented, selectedObjects: [child, parent], activeObject: child }, 'object', 0);
    expect(result.refused).toBe(1);
    expect(result.parented).toBe(0);
  });

  it('attaches to the tail of a bone, staying in place until the bone moves', () => {
    const { document, armature, child: bone } = chain();
    let next = addObject(document, 'Hat', cubeMesh(10));
    const hat = next.activeObject!;
    next = { ...next, selectedObjects: [hat, armature], activeObject: armature, activeBone: bone };
    next = parentSelected(next, 'bone', 0).document;
    expect(findObject(next, hat)!.parent).toBe(bone);
    near(objectOrigin(next, hat, 0), { x: 0, y: 0, z: 0 });
    const local = transformAt(findObject(next, hat)!, 0).position;
    near(applyMatrix(multiply(worldMatrices(next, 0).get(bone)!, [1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1, 0]), local.x, local.y, local.z), { x: 0, y: 0, z: 0 });
    const posed = turned(next, bone, { x: QUARTER, y: 0, z: 0 });
    expect(objectOrigin(posed, hat, 0).z).not.toBeCloseTo(0);
  });

  it('weights automatically by nearness when deforming', () => {
    const { document, armature } = chain();
    let next = addObject(document, 'Strip', STRIP);
    const mesh = next.activeObject!;
    next = parentSelected({ ...next, selectedObjects: [mesh, armature], activeObject: armature }, 'armatureAuto', 0).document;
    const [lower, upper] = findObject(next, mesh)!.vertexGroups;
    expect(findObject(next, mesh)!.deformer).toBe(armature);
    expect(lower.weights.get(0)).toBeCloseTo(1);
    expect(upper.weights.get(2)).toBeCloseTo(1);
    expect((lower.weights.get(1) ?? 0) + (upper.weights.get(1) ?? 0)).toBeCloseTo(1);
    expect(lower.weights.get(1)).toBeCloseTo(0.5);
  });

  it('does not bend a camera or armature child', () => {
    const { document, armature } = chain();
    let next = addObject(document, 'Camera', cubeMesh(1), { focalLength: 800 });
    const camera = next.activeObject!;
    next = parentSelected({ ...next, selectedObjects: [camera, armature], activeObject: armature }, 'armature', 0).document;
    expect(findObject(next, camera)!.parent).toBe(armature);
    expect(findObject(next, camera)!.deformer).toBe(null);
  });
});

describe('clearing transforms', () => {
  it('resets one part of an object or a bone', () => {
    const { document, armature, child } = chain();
    let next = updateTransform(document, armature, () => ({ position: { x: 1, y: 2, z: 3 }, rotation: { x: 1, y: 1, z: 1 }, scale: { x: 2, y: 2, z: 2 } }));
    next = clearTransforms(next, [armature], 'position', 0);
    const object = transformAt(findObject(next, armature)!, 0);
    near(object.position, { x: 0, y: 0, z: 0 });
    near(object.rotation, { x: 1, y: 1, z: 1 });
    near(transformAt(findObject(clearTransforms(next, [armature], 'scale', 0), armature)!, 0).scale, { x: 1, y: 1, z: 1 });
    near(transformAt(findObject(clearTransforms(next, [armature], 'rotation', 0), armature)!, 0).rotation, { x: 0, y: 0, z: 0 });
    const posed = turned(document, child, { x: 1, y: 0, z: 0 });
    near(transformAt(findBone(clearTransforms(posed, [child], 'rotation', 0), child)!.bone, 0).rotation, { x: 0, y: 0, z: 0 });
  });

  it('holds the cleared value on what is animated, without a key', () => {
    const { document, child } = chain();
    const keyed = updateBone(document, child, bone => {
      const parts = [bone.transform.position, bone.transform.rotation, bone.transform.scale];
      const [position, rotation, scale] = writeKeys(parts, [0, 1, 2], [{ x: 5, y: 5, z: 5 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }], 0);
      return { ...bone, transform: { position, rotation, scale } };
    });
    const cleared = clearTransforms(keyed, [child], 'position', 2);
    expect(rowKeyTimes(cleared, 'all')).toEqual([0]);
    near(transformAt(findBone(cleared, child)!.bone, 2).position, { x: 0, y: 0, z: 0 });
    near(transformAt(findBone(cleared, child)!.bone, 0).position, { x: 5, y: 5, z: 5 });
  });
});

describe('vertex groups', () => {
  const withGroup = () => {
    let document = addObject(emptyDocument(), 'Strip', STRIP);
    const mesh = document.activeObject!;
    document = addVertexGroup(document, mesh);
    return { document, mesh, group: findObject(document, mesh)!.activeGroup! };
  };

  it('keeps names unique and picks a new active group on removal', () => {
    const { document, mesh, group } = withGroup();
    const twice = addVertexGroup(document, mesh);
    expect(findObject(twice, mesh)!.vertexGroups.map(item => item.name)).toEqual(['Group', 'Group.001']);
    const removed = removeVertexGroup(twice, mesh, findObject(twice, mesh)!.activeGroup!);
    expect(findObject(removed, mesh)!.activeGroup).toBe(group);
  });

  it('paints toward the brush weight by each vertex factor', () => {
    const { document, mesh, group } = withGroup();
    const painted = paintWeights(document, mesh, group, new Map([[0, 0.5], [1, 1]]), 'mix', 1, [[1], [0, 2], [1]]);
    const { weights } = findObject(painted, mesh)!.vertexGroups[0];
    expect(weights.get(0)).toBeCloseTo(0.5);
    expect(weights.get(1)).toBeCloseTo(1);
    expect(weights.has(2)).toBe(false);
    const again = paintWeights(painted, mesh, group, new Map([[1, 0.25]]), 'subtract', 1, [[1], [0, 2], [1]]);
    expect(findObject(again, mesh)!.vertexGroups[0].weights.get(1)).toBeCloseTo(0.75);
  });

  it('smooths toward neighboring weights', () => {
    const { document, mesh, group } = withGroup();
    const start = assignToGroup(document, mesh, group, new Set([0, 2]), 1);
    const smoothed = paintWeights(start, mesh, group, new Map([[1, 1]]), 'smooth', 1, [[1], [0, 2], [1]]);
    expect(findObject(smoothed, mesh)!.vertexGroups[0].weights.get(1)).toBeCloseTo(1);
    const lowered = paintWeights(start, mesh, group, new Map([[0, 1]]), 'smooth', 1, [[1], [0, 2], [1]]);
    expect(findObject(lowered, mesh)!.vertexGroups[0].weights.has(0)).toBe(false);
  });

  it('does not change earlier documents, so undo works', () => {
    const { document, mesh, group } = withGroup();
    assignToGroup(document, mesh, group, new Set([0]), 1);
    expect(findObject(document, mesh)!.vertexGroups[0].weights.size).toBe(0);
  });

  it('keeps weights with their vertices through delete and duplicate', () => {
    const groups = [{ id: 'g', name: 'G', weights: new Map([[0, 0.1], [1, 0.2], [2, 0.3]]) }];
    expect(Array.from(groupsAfterDelete(groups, [0, 2])[0].weights)).toEqual([[0, 0.1], [1, 0.3]]);
    expect(groupsAfterCopy(groups, [2], 3)[0].weights.get(3)).toBeCloseTo(0.3);
  });
});

describe('automatic weights', () => {
  it('total one per vertex, with the nearest bone dominating', () => {
    const [a, b] = automaticWeights([{ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 90 }], [
      { head: { x: 0, y: 0, z: 0 }, tail: { x: 0, y: 0, z: 20 } },
      { head: { x: 0, y: 0, z: 80 }, tail: { x: 0, y: 0, z: 100 } },
    ]);
    expect(a.get(0)).toBeCloseTo(1);
    expect(b.get(1)).toBeCloseTo(1);
    expect(b.has(0)).toBe(false);
  });
});

describe('weight colors', () => {
  it('run from blue through green to red', () => {
    expect(weightColor(0)).toEqual([0, 0, 255]);
    expect(weightColor(0.5)).toEqual([0, 255, 0]);
    expect(weightColor(1)).toEqual([255, 0, 0]);
  });
});

describe('connected proportional editing', () => {
  it('measures along the mesh and never reaches a separate part', () => {
    const mesh: MeshData = {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }, { x: 0, y: 5, z: 0 }],
      faces: [],
      edges: [[0, 1], [1, 2], [2, 3]],
    };
    const distances = connectedDistances(mesh, new Set([0]));
    expect(distances).toEqual([0, 100, 110, 210, Infinity]);
    const weights = falloffWeights(distances, 50);
    expect(weights[3]).toBe(0);
    expect(weights[4]).toBe(0);
  });
});

describe('setParent with bones', () => {
  it('refuses a loop through a bone', () => {
    const { document, armature, root } = chain();
    let next = addObject(document, 'Hat', cubeMesh(1));
    const hat = next.activeObject!;
    next = setParent(next, hat, root, 0);
    expect(findObject(next, hat)!.parent).toBe(root);
    expect(setParent(next, armature, hat, 0)).toBe(next);
  });
});
