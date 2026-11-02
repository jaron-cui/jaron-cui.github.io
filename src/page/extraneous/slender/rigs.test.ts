import { Bone } from './armature';
import {
  addConstraint, addObject, boneSegments, curveChannels, deleteObjects, displayVertices, dropHeldDocumentEdits, duplicateObjects, EditorDocument, emptyDocument, findBone, findObject, keyConstraintInfluence,
  objectOrigin, parentMatrix, renderedMesh, rowKeyTimes, SceneObject, setChildOfOn, setConstraintInfluence, setConstraintTarget, setFrameRate, setParent, setRotationMode, toWorld, transformAt, transformParts,
  updateConstraint, updateObject, updateTransform, withTransformParts, worldMatrices,
} from './document';
import { applyMirror, joinSelected, separateLooseParts, separateSelection } from './joining';
import { track } from './animation';
import { isKeyed, keyState, poseAt, setKeyEase, writeKeys } from './keyframes';
import { rotateRotation, transformMatrix } from './matrix';
import { Vec3 } from './model';
import { clippedByMirrors, flippedName, newMirror } from './modifiers';
import { cubeMesh, planeMesh } from './primitives';
import { parseProject, savedCursor, serializeProject } from './projectFile';
import { clearTransforms, parentSelected } from './rigging';

function near(actual: Vec3, expected: Vec3, digits = 3) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

function transform() {
  return { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
}

function bone(id: string, parent: string | null, head: number, tail: number): Bone {
  return { id, name: id, parent, head, tail, transform: transform(), constraints: [] };
}

// A straight leg along -z, with a foot control and a knee control standing free of it, as a rig has.
function leg() {
  const vertices = [
    { x: 0, y: 0, z: 200 }, { x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -30 },
    { x: 0, y: 100, z: 100 }, { x: 0, y: 100, z: 130 },
  ];
  const added = addObject(emptyDocument(), 'Rig', { vertices, faces: [], edges: [] });
  const id = added.activeObject!;
  const bones = [bone('thigh', null, 0, 1), bone('shin', 'thigh', 1, 2), bone('foot', null, 3, 4), bone('kneeControl', null, 5, 6)];
  let document = updateObject(added, id, object => ({ ...object, bones, edges: bones.map(({ head, tail }) => [head, tail]) }));
  document = addConstraint(document, 'shin', 'ik');
  const constraint = findBone(document, 'shin')!.bone.constraints[0].id;
  document = updateConstraint(document, 'shin', constraint, { target: 'foot' });
  return { document, id, constraint };
}

const moved = (document: EditorDocument, id: string, position: Vec3) => updateTransform(document, id, current => ({ ...current, position }));

function joints(document: EditorDocument, id: string, time = 0) {
  const armature = findObject(document, id)!;
  const segments = boneSegments(armature, worldMatrices(document, time), poseAt(armature.vertices, time));
  return Object.fromEntries(segments.map(({ bone: { id: name }, head, tail }) => [name, { head, tail }]));
}

function length(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe('inverse kinematics', () => {
  // Bone transforms are relative to rest. A rest frame along -z has its local x, y, z at -x... so the
  // tests read the world result rather than work these out: the control is moved by its world offset.
  const placedFoot = (document: EditorDocument, id: string, world: Vec3) => {
    const parent = parentMatrix(document, findBone(document, 'foot')!.bone, 0);
    const inverse = [parent[0], parent[4], parent[8], parent[1], parent[5], parent[9], parent[2], parent[6], parent[10]];
    const offset = { x: world.x - parent[3], y: world.y - parent[7], z: world.z - parent[11] };
    return moved(document, 'foot', {
      x: inverse[0] * offset.x + inverse[1] * offset.y + inverse[2] * offset.z,
      y: inverse[3] * offset.x + inverse[4] * offset.y + inverse[5] * offset.z,
      z: inverse[6] * offset.x + inverse[7] * offset.y + inverse[8] * offset.z,
    });
  };

  it('puts the foot on its target, keeping the hip where it is and the bones their lengths', () => {
    const { document, id } = leg();
    const raised = placedFoot(document, id, { x: 60, y: 20, z: 60 });
    const { thigh, shin } = joints(raised, id);
    near(shin.tail, { x: 60, y: 20, z: 60 }, 0);
    near(thigh.head, { x: 0, y: 0, z: 200 });
    expect(length(thigh.head, thigh.tail)).toBeCloseTo(100, 3);
    expect(length(shin.head, shin.tail)).toBeCloseTo(100, 3);
    near(thigh.tail, shin.head);
  });

  it('bends a chain lying straight, rather than sticking', () => {
    const { document, id } = leg();
    const raised = placedFoot(document, id, { x: 0, y: 0, z: 50 });
    near(joints(raised, id).shin.tail, { x: 0, y: 0, z: 50 }, 0);
  });

  it('points straight at a target out of reach', () => {
    const { document, id } = leg();
    const { shin, thigh } = joints(placedFoot(document, id, { x: 500, y: 0, z: 200 }), id);
    near(shin.tail, { x: 200, y: 0, z: 200 });
    near(thigh.tail, { x: 100, y: 0, z: 200 });
  });

  it('aims the knee at a pole wherever the pole is', () => {
    const { document, id, constraint } = leg();
    const raised = placedFoot(document, id, { x: 0, y: 0, z: 60 });
    const posed = updateConstraint(raised, 'shin', constraint, { pole: 'kneeControl' });
    const forward = joints(posed, id).thigh.tail;
    expect(forward.y).toBeGreaterThan(30);
    expect(forward.x).toBeCloseTo(0, 3);
    near(joints(posed, id).shin.tail, { x: 0, y: 0, z: 60 }, 0);
    // The same knee control, taken around to the side.
    const parent = parentMatrix(posed, findBone(posed, 'kneeControl')!.bone, 0);
    const toSide = { x: 200, y: -100, z: 0 };
    const local = { x: parent[0] * toSide.x + parent[4] * toSide.y + parent[8] * toSide.z, y: parent[1] * toSide.x + parent[5] * toSide.y + parent[9] * toSide.z, z: parent[2] * toSide.x + parent[6] * toSide.y + parent[10] * toSide.z };
    const sideways = joints(moved(posed, 'kneeControl', local), id).thigh.tail;
    expect(sideways.x).toBeGreaterThan(30);
    expect(sideways.y).toBeCloseTo(0, 3);
  });

  it('swings the knee further by the pole angle', () => {
    const { document, id, constraint } = leg();
    const posed = updateConstraint(placedFoot(document, id, { x: 0, y: 0, z: 60 }), 'shin', constraint, { pole: 'kneeControl', poleAngle: Math.PI / 2 });
    const knee = joints(posed, id).thigh.tail;
    expect(Math.abs(knee.x)).toBeGreaterThan(30);
    expect(knee.y).toBeCloseTo(0, 1);
  });

  it('counts the chain from the bone upward, leaving what is above it alone', () => {
    const { document, id, constraint } = leg();
    const short = updateConstraint(placedFoot(document, id, { x: 60, y: 0, z: 60 }), 'shin', constraint, { chainLength: 1 });
    const { thigh, shin } = joints(short, id);
    near(thigh.tail, { x: 0, y: 0, z: 100 });
    expect(length(shin.head, shin.tail)).toBeCloseTo(100, 3);
  });

  it('blends with influence, and at zero is the pose', () => {
    const { document, id, constraint } = leg();
    const raised = placedFoot(document, id, { x: 60, y: 0, z: 60 });
    const off = setConstraintInfluence(raised, 'shin', constraint, 0, 0);
    near(joints(off, id).shin.tail, { x: 0, y: 0, z: 0 });
    const half = joints(setConstraintInfluence(raised, 'shin', constraint, 0.5, 0), id).shin.tail;
    expect(half.x).toBeGreaterThan(1);
    expect(half.x).toBeLessThan(59);
  });

  it('survives a target hanging from its own chain', () => {
    const { document, id, constraint } = leg();
    const looped = updateConstraint(document, 'shin', constraint, { target: 'thigh' });
    expect(() => worldMatrices(looped, 0)).not.toThrow();
    const childOfShin = updateObject(document, id, object => ({ ...object, bones: object.bones!.map(other => (other.id === 'foot' ? { ...other, parent: 'shin' } : other)) }));
    expect(() => worldMatrices(childOfShin, 0)).not.toThrow();
    expect(Number.isFinite(worldMatrices(childOfShin, 0).get('shin')![3])).toBe(true);
  });

  it('carries a child of the chain along, and what is parented to it', () => {
    const { document, id } = leg();
    const withChild = updateObject(document, id, object => ({ ...object, bones: object.bones!.map(other => (other.id === 'kneeControl' ? { ...other, parent: 'shin' } : other)) }));
    const raised = placedFoot(withChild, id, { x: 60, y: 0, z: 60 });
    const { shin, kneeControl } = joints(raised, id);
    const before = joints(withChild, id);
    expect(length(kneeControl.head, shin.tail)).toBeCloseTo(length(before.kneeControl.head, before.shin.tail), 3);
  });

  it('copies its target and pole with a duplicated rig, and clears them when they go', () => {
    const { document, id, constraint } = leg();
    const posed = updateConstraint(document, 'shin', constraint, { pole: 'kneeControl' });
    const copy = duplicateObjects({ ...posed, selectedObjects: [id] });
    const copied = findObject(copy, copy.activeObject!)!.bones!;
    const ik = copied[1].constraints[0];
    expect(ik.target).toBe(copied[2].id);
    expect(ik.pole).toBe(copied[3].id);
    const other = addObject(posed, 'Other', cubeMesh(10));
    expect(deleteObjects(other, [id], 0).objects.map(object => object.name)).toEqual(['Other']);
  });
});

describe('parenting to a bone', () => {
  it('makes an object follow the bone wherever the bone goes, including through IK', () => {
    const { document, id } = leg();
    const added = addObject(document, 'Sword', cubeMesh(10));
    const sword = added.activeObject!;
    const placed = moved(added, sword, { x: 0, y: 0, z: 0 });
    const parented = parentSelected({ ...placed, selectedObjects: [sword, id], activeObject: id, activeBone: 'shin' }, 'bone', 0).document;
    expect(findObject(parented, sword)!.parent).toBe('shin');
    near(objectOrigin(parented, sword, 0), { x: 0, y: 0, z: 0 });
    const parent = parentMatrix(parented, findBone(parented, 'foot')!.bone, 0);
    const offset = { x: 60, y: 0, z: 60 };
    const local = { x: parent[0] * offset.x + parent[4] * offset.y + parent[8] * offset.z, y: parent[1] * offset.x + parent[5] * offset.y + parent[9] * offset.z, z: parent[2] * offset.x + parent[6] * offset.y + parent[10] * offset.z };
    near(objectOrigin(moved(parented, 'foot', local), sword, 0), joints(moved(parented, 'foot', local), id).shin.tail);
  });
});

describe('Child Of', () => {
  const scene = () => {
    let document = addObject(addObject(emptyDocument(), 'Hand', cubeMesh(10)), 'Cup', cubeMesh(10));
    const [hand, cup] = document.objects.map(object => object.id);
    document = moved(moved(document, hand, { x: 100, y: 0, z: 0 }), cup, { x: 0, y: 50, z: 0 });
    document = addConstraint(document, cup, 'childOf');
    const constraint = findObject(document, cup)!.constraints[0].id;
    return { document, hand, cup, constraint };
  };
  const keyedAt = (document: EditorDocument, id: string, keys: [number, Vec3][]) => keys.reduce((next, [time, position]) => updateObject(next, id, object => {
    const parts = transformParts(object);
    return withTransformParts(object, setKeyEase(writeKeys(parts, [0], [position], time), [0], time, 'linear'));
  }), document);

  const switched = (document: EditorDocument, id: string, constraint: string, keys: [number, boolean][]) => keys.reduce(
    (next, [time, on]) => keyConstraintInfluence(next, id, constraint, time, on ? 1 : 0, true), document
  );

  it('does not jump when its target is set, then follows the target', () => {
    const { document, hand, cup, constraint } = scene();
    const set = setConstraintTarget(document, cup, constraint, hand, 0);
    near(objectOrigin(set, cup, 0), { x: 0, y: 50, z: 0 });
    near(objectOrigin(moved(set, hand, { x: 100, y: 0, z: 40 }), cup, 0), { x: 0, y: 50, z: 40 });
  });

  it('jumps to the target without an inverse', () => {
    const { document, hand, cup, constraint } = scene();
    const set = updateConstraint(document, cup, constraint, { target: hand });
    near(objectOrigin(set, cup, 0), { x: 100, y: 50, z: 0 });
  });

  it('parents and lets go at frames, with nothing jumping at either', () => {
    const { document: start, hand, cup, constraint } = scene();
    // The hand travels up from frame 0 to frame 100.
    let document = keyedAt(start, hand, [[0, { x: 100, y: 0, z: 0 }], [10, { x: 100, y: 0, z: 1000 }]]);
    document = setConstraintTarget(document, cup, constraint, hand, 0);
    document = setConstraintInfluence(document, cup, constraint, 0, 0);
    near(objectOrigin(document, cup, 2), { x: 0, y: 50, z: 0 });

    document = switched(document, cup, constraint, [[0, false], [2, true]]);
    near(objectOrigin(document, cup, 1.9), { x: 0, y: 50, z: 0 });
    near(objectOrigin(document, cup, 2), { x: 0, y: 50, z: 0 });
    // Carried along with the hand from there.
    near(objectOrigin(document, cup, 4), { x: 0, y: 50, z: 200 }, 1);

    document = switched(document, cup, constraint, [[6, false]]);
    near(objectOrigin(document, cup, 5.9), { x: 0, y: 50, z: 390 }, 0);
    near(objectOrigin(document, cup, 6), { x: 0, y: 50, z: 400 }, 1);
    // Left behind at the height it was dropped, while the hand goes on rising.
    near(objectOrigin(document, cup, 9), { x: 0, y: 50, z: 400 }, 1);
    near(objectOrigin(document, cup, 1), { x: 0, y: 50, z: 0 });
    // Its keys are the only ones it took.
    expect(transformParts(findObject(document, cup)!).some(isKeyed)).toBe(false);
  });

  it('keeps its place through a target that turns, and shows a toggle before it is keyed', () => {
    const { document: start, hand, cup, constraint } = scene();
    let document = updateObject(start, hand, object => {
      const parts = transformParts(object);
      const pose = (z: number) => [{ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z }, { x: 1, y: 1, z: 1 }];
      return withTransformParts(object, setKeyEase(writeKeys(setKeyEase(writeKeys(parts, [1], pose(0), 0), [1], 0, 'linear'), [1], pose(Math.PI), 10), [1], 10, 'linear'));
    });
    document = setConstraintTarget(document, cup, constraint, hand, 0);
    document = switched(document, cup, constraint, [[0, false]]);
    const onAtFive = setChildOfOn(document, cup, constraint, true, 5);
    expect(keyState([findObject(onAtFive, cup)!.constraints[0].influence], 5)).toBe('held');
    near(objectOrigin(onAtFive, cup, 5), { x: 0, y: 50, z: 0 });
    near(objectOrigin(onAtFive, cup, 4), { x: 0, y: 50, z: 0 });
    const keyed = switched(document, cup, constraint, [[5, true]]);
    near(objectOrigin(keyed, cup, 5), { x: 0, y: 50, z: 0 });
    // A quarter turn of the hand on from there, about the hand at x = 100.
    const later = objectOrigin(keyed, cup, 5 + 5);
    expect(length(later, { x: 100, y: 0, z: 0 })).toBeCloseTo(length({ x: 0, y: 50, z: 0 }, { x: 100, y: 0, z: 0 }), 3);
    expect(length(later, { x: 0, y: 50, z: 0 })).toBeGreaterThan(50);
  });

  it('can be picked up a second time, somewhere else', () => {
    const { document: start, hand, cup, constraint } = scene();
    let document = keyedAt(start, hand, [[0, { x: 100, y: 0, z: 0 }], [10, { x: 100, y: 0, z: 1000 }]]);
    document = setConstraintTarget(document, cup, constraint, hand, 0);
    document = setConstraintInfluence(document, cup, constraint, 0, 0);
    document = switched(document, cup, constraint, [[0, false], [2, true], [4, false], [7, true]]);
    near(objectOrigin(document, cup, 6), { x: 0, y: 50, z: 200 }, 1);
    near(objectOrigin(document, cup, 7), { x: 0, y: 50, z: 200 }, 1);
    near(objectOrigin(document, cup, 9), { x: 0, y: 50, z: 400 }, 1);
  });

  it('moves the child by the world axes while attached, through parentMatrix', () => {
    const { document, hand, cup, constraint } = scene();
    const turned = updateTransform(document, hand, current => ({ ...current, rotation: { x: 0, y: 0, z: Math.PI / 2 } }));
    const set = setConstraintTarget(turned, cup, constraint, hand, 0);
    const parent = parentMatrix(set, findObject(set, cup)!, 0);
    near(objectOrigin(set, cup, 0), { x: parent[1] * 50 + parent[3], y: parent[5] * 50 + parent[7], z: parent[9] * 50 + parent[11] });
  });

  it('animates its influence: keys show in the timeline and curves, and move with the frame rate', () => {
    const { document, hand, cup, constraint } = scene();
    const set = setConstraintTarget(document, cup, constraint, hand, 0);
    let keyed = keyConstraintInfluence(set, cup, constraint, 1, 1);
    keyed = keyConstraintInfluence(keyed, cup, constraint, 2, 0);
    expect(rowKeyTimes({ ...keyed, selectedObjects: [cup] }, 'selected')).toEqual([1, 2]);
    expect(curveChannels({ ...keyed, selectedObjects: [cup] }).map(channel => channel.label)).toEqual(['Cup Child Of Influence']);
    const halved = setFrameRate({ ...keyed, frameRate: 24 }, 48);
    expect(rowKeyTimes(halved, 'all')).toEqual([0.5, 1]);
  });

  it('holds an edit of animated influence until the frame changes', () => {
    const { document, hand, cup, constraint } = scene();
    const set = keyConstraintInfluence(setConstraintTarget(document, cup, constraint, hand, 0), cup, constraint, 0, 1);
    const edited = setConstraintInfluence(set, cup, constraint, 0.25, 0);
    expect(findObject(edited, cup)!.constraints[0].influence).toMatchObject({ held: { value: 0.25 } });
    expect(findObject(dropHeldDocumentEdits(edited), cup)!.constraints[0].influence).not.toHaveProperty('held');
  });
});

describe('how a property stands at a time', () => {
  it('is on a key, keyed elsewhere, changed without a key, or not animated', () => {
    const keyed = track({ time: 1, value: 0 }, { time: 2, value: 1 });
    expect(keyState([5], 1)).toBe('none');
    expect(keyState([keyed], 1)).toBe('keyed');
    expect(keyState([keyed], 1.5)).toBe('animated');
    expect(keyState([{ ...keyed, held: { time: 1.5, value: 9 } }], 1.5)).toBe('held');
    expect(keyState([{ ...keyed, held: { time: 1.5, value: 9 } }], 1)).toBe('keyed');
    expect(keyState([undefined, 0, keyed], 2)).toBe('keyed');
  });
});

describe('rotation modes', () => {
  const spun = () => {
    const document = addObject(emptyDocument(), 'A', cubeMesh(10));
    return { document, id: document.activeObject! };
  };
  const matrixOf = (object: SceneObject, time: number) => transformMatrix(transformAt(object, time));

  it('converts a value without moving anything', () => {
    const { document, id } = spun();
    const turned = updateTransform(document, id, current => ({ ...current, rotation: { x: 0.3, y: -0.7, z: 1.1 } }));
    const quaternion = setRotationMode(turned, id, true);
    expect(transformAt(findObject(quaternion, id)!, 0).rotation.w).toBeDefined();
    matrixOf(findObject(turned, id)!, 0).forEach((value, i) => expect(matrixOf(findObject(quaternion, id)!, 0)[i]).toBeCloseTo(value, 6));
    const back = setRotationMode(quaternion, id, false);
    expect(transformAt(findObject(back, id)!, 0).rotation.w).toBeUndefined();
    matrixOf(findObject(turned, id)!, 0).forEach((value, i) => expect(matrixOf(findObject(back, id)!, 0)[i]).toBeCloseTo(value, 6));
  });

  it('converts keys, keeping what each does and its easing', () => {
    const { document, id } = spun();
    const keyed = updateObject(document, id, object => {
      let parts = transformParts(object);
      parts = writeKeys(parts, [1], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }].map((_, i) => ({ x: 0, y: 0, z: 0, i })) as Vec3[], 0);
      parts = writeKeys(parts, [1], [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0.5, z: 0.2 }, { x: 0, y: 0, z: 0 }], 2);
      return withTransformParts(object, parts);
    });
    const quaternion = findObject(setRotationMode(keyed, id, true), id)!;
    expect(typeof quaternion.transform.rotation.w).toBe('object');
    matrixOf(findObject(keyed, id)!, 2).forEach((value, i) => expect(matrixOf(quaternion, 2)[i]).toBeCloseTo(value, 6));
  });

  it('turns about the same axis in either mode', () => {
    const axis = { x: 0, y: 0, z: 1 };
    const euler = rotateRotation({ x: 0, y: 0, z: 0 }, axis, 1);
    const quaternion = rotateRotation({ w: 1, x: 0, y: 0, z: 0 }, axis, 1);
    const scale = { x: 1, y: 1, z: 1 };
    const position = { x: 0, y: 0, z: 0 };
    transformMatrix({ position, scale, rotation: euler }).forEach((value, i) => expect(transformMatrix({ position, scale, rotation: quaternion })[i]).toBeCloseTo(value, 6));
  });

  it('blends quaternion keys the short way, even across the sign flip', () => {
    const { document, id } = spun();
    const quaternion = setRotationMode(document, id, true);
    const keyed = updateObject(quaternion, id, object => {
      let parts = transformParts(object);
      const pose = (rotation: Vec3 & { w: number }) => [{ x: 0, y: 0, z: 0 }, rotation, { x: 1, y: 1, z: 1 }];
      const half = Math.sqrt(0.5);
      parts = writeKeys(parts, [1], pose({ w: half, x: 0, y: 0, z: half }), 0);
      // The same 170 degrees written with its negative sign, as a key at the far side would be.
      parts = writeKeys(parts, [1], pose({ w: -Math.cos(2.5), x: 0, y: 0, z: -Math.sin(2.5) }), 2);
      return withTransformParts(object, parts);
    });
    const [, rotation] = transformParts(findObject(keyed, id)!);
    const [start, end] = poseAt([rotation], 0).concat(poseAt([rotation], 2));
    expect(start.w! * end.w! + start.z * end.z).toBeGreaterThan(0);
  });

  it('clears a quaternion to no turn, and bones start as quaternions', () => {
    const { document, id } = leg();
    expect(findBone(document, 'shin')!.bone.transform.rotation.w).toBe(1);
    const turned = updateTransform(document, 'shin', current => ({ ...current, rotation: { w: 0, x: 1, y: 0, z: 0 } }));
    expect(transformAt(findBone(clearTransforms(turned, ['shin'], 'rotation', 0), 'shin')!.bone, 0).rotation).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    expect(id).toBeDefined();
  });

  it('keeps a quaternion through reparenting, and labels its channels', () => {
    const { document, id } = spun();
    const withParent = addObject(document, 'Parent', cubeMesh(10));
    const parent = withParent.activeObject!;
    const quaternion = setRotationMode(withParent, id, true);
    const parented = setParent(moved(quaternion, parent, { x: 5, y: 0, z: 0 }), id, parent, 0);
    expect(transformAt(findObject(parented, id)!, 0).rotation.w).toBeDefined();
    near(objectOrigin(parented, id, 0), { x: 0, y: 0, z: 0 });
    const keyed = updateObject(quaternion, id, object => {
      const parts = transformParts(object);
      return withTransformParts(object, writeKeys(parts, [1], poseAt(parts, 0), 0));
    });
    expect(curveChannels({ ...keyed, selectedObjects: [id] }).map(channel => channel.label)).toEqual(['A Rotation W', 'A Rotation X', 'A Rotation Y', 'A Rotation Z']);
    expect(curveChannels({ ...keyed, selectedObjects: [id] })[0].scale).toBe(1);
  });
});

describe('joining and separating', () => {
  const two = () => {
    let document = addObject(addObject(emptyDocument(), 'A', cubeMesh(10)), 'B', cubeMesh(10));
    const [a, b] = document.objects.map(object => object.id);
    document = moved(moved(document, a, { x: 100, y: 0, z: 0 }), b, { x: 0, y: 200, z: 0 });
    document = updateTransform(document, b, current => ({ ...current, scale: { x: 2, y: 2, z: 2 } }));
    return { document: { ...document, selectedObjects: [b, a], activeObject: a }, a, b };
  };
  const worldOf = (document: EditorDocument, id: string) => {
    const matrices = worldMatrices(document, 0);
    return toWorld(matrices.get(id)!, displayVertices(document, findObject(document, id)!, 0, null, matrices));
  };

  it('joins into the active mesh, with everything staying where it appears', () => {
    const { document, a, b } = two();
    const before = [...worldOf(document, a), ...worldOf(document, b)];
    const { document: joined, joined: count } = joinSelected(document, 0);
    expect(count).toBe(1);
    expect(joined.objects.map(object => object.id)).toEqual([a]);
    const after = worldOf(joined, a);
    expect(after).toHaveLength(before.length);
    after.forEach((vertex, i) => near(vertex, before[i]));
    expect(findObject(joined, a)!.faces).toHaveLength(findObject(document, a)!.faces.length * 2);
    expect(joined.selectedObjects).toEqual([a]);
  });

  it('merges vertex groups by name, and leaves non-meshes out', () => {
    const { document, a, b } = two();
    const grouped = updateObject(updateObject(document, a, object => ({ ...object, vertexGroups: [{ id: 'g1', name: 'Arm', weights: new Map([[0, 0.5]]) }] })), b, object => ({ ...object, vertexGroups: [{ id: 'g2', name: 'Arm', weights: new Map([[1, 1]]) }, { id: 'g3', name: 'Leg', weights: new Map([[0, 1]]) }] }));
    const groups = findObject(joinSelected(grouped, 0).document, a)!.vertexGroups;
    const count = findObject(document, a)!.vertices.length;
    expect(groups.map(group => group.name)).toEqual(['Arm', 'Leg']);
    expect(Array.from(groups[0].weights)).toEqual([[0, 0.5], [1 + count, 1]]);
    expect(Array.from(groups[1].weights)).toEqual([[count, 1]]);
    const alone = addObject(emptyDocument(), 'C', cubeMesh(1));
    expect(joinSelected(alone, 0).joined).toBe(0);
  });

  it('joins animated vertices by carrying their keys', () => {
    const { document, a, b } = two();
    const animated = updateObject(document, b, object => ({ ...object, vertices: writeKeys(writeKeys(object.vertices, [0], poseAt(object.vertices, 0), 0), [0], [{ x: 1, y: 2, z: 3 }], 1) }));
    const { document: joined } = joinSelected(animated, 0);
    const count = findObject(document, a)!.vertices.length;
    const moved1 = poseAt(findObject(joined, a)!.vertices, 1)[count];
    near(moved1, { x: 2 - 100, y: 4 + 200, z: 6 });
  });

  it('separates a selection, which leaves its object and appears as its own, in place', () => {
    const document = addObject(emptyDocument(), 'A', cubeMesh(10));
    const id = document.activeObject!;
    const before = worldOf(document, id);
    const original = findObject(document, id)!;
    const chosen = new Set(original.faces[0]);
    const selected = updateObject({ ...document, mode: 'edit' }, id, object => ({ ...object, selectedVertices: chosen }));
    const next = separateSelection(selected, id, 0);
    expect(next.objects).toHaveLength(2);
    const [left, split] = next.objects;
    expect(split.faces).toEqual([[0, 1, 2]].map(() => expect.any(Array)));
    expect(split.vertices).toHaveLength(3);
    expect(left.faces).toHaveLength(original.faces.length - 1);
    // A cube's vertices are all still used by the faces left behind.
    expect(left.vertices).toHaveLength(original.vertices.length);
    worldOf(next, split.id).forEach(vertex => expect(before.some(other => length(other, vertex) < 1e-6)).toBe(true));
    expect(left.selectedVertices.size).toBe(0);
    expect(next.selectedObjects).toContain(split.id);
    expect(split.id).not.toBe(left.id);
  });

  it('removes vertices that nothing is left using, and refuses to take everything', () => {
    const document = addObject(emptyDocument(), 'A', planeMesh(10));
    const id = document.activeObject!;
    const all = updateObject(document, id, object => ({ ...object, selectedVertices: new Set(object.vertices.map((_, i) => i)) }));
    expect(separateSelection(all, id, 0)).toBe(all);
    const none = updateObject(document, id, object => ({ ...object, selectedVertices: new Set() }));
    expect(separateSelection(none, id, 0)).toBe(none);
  });

  it('separates by loose parts', () => {
    const { document, a, b } = two();
    const { document: joined } = joinSelected(document, 0);
    const parts = separateLooseParts(joined, a, 0);
    expect(parts.objects).toHaveLength(2);
    const count = findObject(document, a)!.vertices.length;
    expect(parts.objects[0].vertices).toHaveLength(count);
    expect(parts.objects[1].vertices).toHaveLength(findObject(document, b)!.vertices.length);
    expect(parts.objects[1].id).not.toBe(a);
    const whole = addObject(emptyDocument(), 'C', cubeMesh(1));
    expect(separateLooseParts(whole, whole.activeObject!, 0)).toBe(whole);
  });
});

describe('the mirror modifier', () => {
  // A square off to the +x side, sharing a seam along x = 0.
  const half = () => {
    const document = addObject(emptyDocument(), 'A', {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }],
      faces: [[0, 1, 2], [0, 2, 3]],
      edges: [],
    });
    const id = document.activeObject!;
    return { document: updateObject(document, id, object => ({ ...object, modifiers: [newMirror('m')] })), id };
  };
  const rendered = (document: EditorDocument, id: string) => renderedMesh(document, findObject(document, id)!, 0, null, worldMatrices(document, 0));

  it('adds the reflection, joined at the seam, leaving the mesh itself alone', () => {
    const { document, id } = half();
    const { vertices, faces } = rendered(document, id);
    expect(vertices).toHaveLength(6);
    expect(faces).toHaveLength(4);
    near(vertices[4], { x: -10, y: 0, z: 0 });
    expect(faces[2]).toContain(0);
    expect(findObject(document, id)!.vertices).toHaveLength(4);
  });

  it('keeps the halves apart without merging, and reflects along more axes', () => {
    const { document, id } = half();
    const change = (modifier: Partial<ReturnType<typeof newMirror>>) => updateObject(document, id, object => ({ ...object, modifiers: [{ ...newMirror('m'), ...modifier }] }));
    expect(rendered(change({ merge: false }), id).vertices).toHaveLength(8);
    const both = rendered(change({ merge: false, axes: { x: true, y: true, z: false } }), id);
    expect(both.vertices).toHaveLength(16);
    expect(both.faces).toHaveLength(8);
  });

  it('clips: a vertex on the plane stays there, and none can cross', () => {
    const before = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
    const after = clippedByMirrors([{ x: 5, y: 3, z: 0 }, { x: -2, y: 1, z: 0 }], before, [newMirror('m')]);
    near(after[0], { x: 0, y: 3, z: 0 });
    near(after[1], { x: 0, y: 1, z: 0 });
    expect(clippedByMirrors(before, before, [{ ...newMirror('m'), clipping: false }])).toBe(before);
  });

  it('applies into a real mesh with animation and side-flipped weights', () => {
    const { document, id } = half();
    const named = updateObject(document, id, object => ({
      ...object,
      vertexGroups: [{ id: 'g', name: 'Arm.L', weights: new Map([[1, 1]]) }],
      vertices: writeKeys(object.vertices, [1], [{ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 0).map((vertex, i) => vertex),
    }));
    const animated = updateObject(named, id, object => ({ ...object, vertices: writeKeys(object.vertices, [1], [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }], 1) }));
    const applied = applyMirror(animated, id, 'm', 0);
    const object = findObject(applied, id)!;
    expect(object.modifiers).toEqual([]);
    expect(object.vertices).toHaveLength(6);
    expect(object.faces).toHaveLength(4);
    near(poseAt(object.vertices, 1)[4], { x: -20, y: 0, z: 0 });
    expect(object.vertexGroups.map(group => group.name)).toEqual(['Arm.L', 'Arm.R']);
    expect(Array.from(object.vertexGroups[1].weights)).toEqual([[4, 1]]);
    expect(object.vertexGroups[1].id).toMatch(/^group-/);
  });

  it('flips only names that say a side', () => {
    expect(flippedName('Arm.L')).toBe('Arm.R');
    expect(flippedName('leg_r')).toBe('leg_l');
    expect(flippedName('Hand-R.001')).toBe('Hand-L.001');
    expect(flippedName('Spine')).toBe('Spine');
  });

  it('counts as a surface in picking, and survives old files and duplicates', () => {
    const { document, id } = half();
    expect(duplicateObjects({ ...document, selectedObjects: [id] }).objects[1].modifiers).toHaveLength(1);
    const old = updateObject(document, id, object => {
      const { modifiers, ...rest } = object;
      return rest;
    });
    expect(rendered(old, id).vertices).toHaveLength(4);
  });
});

describe('the scene cursor in a project', () => {
  const state = (cursor?: Vec3) => ({
    view: { orbit: { target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 1, focalLength: 1 }, viewedCamera: null, time: 0, ...(cursor ? { cursor } : {}) },
    layout: { outlinerWidth: 1, timelineHeight: 1, objectPaneHeight: 1, transformPanelOpen: true, propertiesTab: 'object' as const },
    settings: { selectMode: 'vertex' as const, showOverlays: true, xRay: false, proportional: false, proportionalRadius: 1, proportionalConnected: false, brush: { weight: 1, radius: 1, strength: 1 } },
  });

  it('is saved with the view, not the document', () => {
    const document = emptyDocument();
    expect(document).not.toHaveProperty('cursor');
    const { view, document: read } = parseProject(serializeProject({ document, ...state({ x: 1, y: 2, z: 3 }) }));
    expect(savedCursor(view, read)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('comes out of the document in older files', () => {
    const old = { ...emptyDocument(), cursor: { x: 4, y: 5, z: 6 } };
    const { view, document: read } = parseProject(serializeProject({ document: old, ...state() }));
    expect(savedCursor(view, read)).toEqual({ x: 4, y: 5, z: 6 });
    expect(savedCursor(state().view, emptyDocument())).toEqual({ x: 0, y: 0, z: 0 });
  });
});
