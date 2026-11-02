import { Bone } from './armature';
import { bonePartners, jointPartners, mirroredJoints, mirroredPose } from './armatureMirror';
import { addConstraint, addObject, boneSegments, emptyDocument, findBone, findObject, updateConstraint, updateObject, updateTransform, worldMatrices } from './document';
import { poseAt } from './keyframes';
import { Vec3 } from './model';
import { bonesToDelete, deleteBones, extrudeBones, symmetrizeBones } from './rigging';

function transform() {
  return { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
}

function bone(id: string, name: string, parent: string | null, head: number, tail: number): Bone {
  return { id, name, parent, head, tail, transform: transform(), constraints: [] };
}

// A spine, with an upper and lower arm going out each way from its top, as x reflects them.
function rig() {
  const vertices = [
    { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 100 },
    { x: 50, y: 10, z: 100 }, { x: 120, y: 30, z: 80 },
    { x: -50, y: 10, z: 100 }, { x: -120, y: 30, z: 80 },
  ];
  const added = addObject(emptyDocument(), 'Rig', { vertices, faces: [], edges: [] });
  const id = added.activeObject!;
  const bones = [
    bone('spine', 'Spine', null, 0, 1),
    bone('upperA', 'Bone.001', 'spine', 1, 2), bone('lowerA', 'Bone.002', 'upperA', 2, 3),
    bone('upperB', 'Bone.003', 'spine', 1, 4), bone('lowerB', 'Bone.004', 'upperB', 4, 5),
  ];
  const document = updateObject(added, id, object => ({ ...object, bones, edges: bones.map(({ head, tail }) => [head, tail]), mirrorEdit: true, mirrorPose: true }));
  return { document, id };
}

const select = (document: ReturnType<typeof rig>['document'], id: string, joints: number[]) => updateObject(document, id, object => ({ ...object, selectedVertices: new Set(joints) }));
const jointsOf = (document: ReturnType<typeof rig>['document'], id: string): Vec3[] => poseAt(findObject(document, id)!.vertices, 0);

describe('pairing bones across x', () => {
  it('pairs by reflection, leaving a center bone without one', () => {
    const { document, id } = rig();
    const partners = bonePartners(findObject(document, id)!, jointsOf(document, id));
    expect(partners.get('upperA')).toBe('upperB');
    expect(partners.get('lowerB')).toBe('lowerA');
    expect(partners.has('spine')).toBe(false);
  });

  it('prefers names, wherever the bones lie', () => {
    const joints = [{ x: 1, y: 0, z: 0 }, { x: 1, y: 5, z: 0 }, { x: 9, y: 0, z: 0 }, { x: 9, y: 9, z: 0 }];
    const partners = bonePartners({ bones: [bone('a', 'Arm.L', null, 0, 1), bone('b', 'Arm.R', null, 2, 3)] }, joints);
    expect(partners.get('a')).toBe('b');
  });

  it('does not pair bones nearly reflected', () => {
    const joints = [{ x: 1, y: 0, z: 0 }, { x: 1, y: 5, z: 0 }, { x: -1.5, y: 0, z: 0 }, { x: -1, y: 5, z: 0 }];
    expect(bonePartners({ bones: [bone('a', 'A', null, 0, 1), bone('b', 'B', null, 2, 3)] }, joints).size).toBe(0);
  });
});

describe('mirroring joints', () => {
  const pointsAfter = (moved: Record<number, Vec3>, selected: number[]) => {
    const { document, id } = rig();
    const joints = jointsOf(document, id);
    const local = joints.map((joint, i) => moved[i] ?? joint);
    return mirroredJoints(local, new Set(selected), new Set(selected), jointPartners(findObject(document, id)!, joints));
  };

  it('moves the other side as the reflection, and marks it changed', () => {
    const { local, affected } = pointsAfter({ 3: { x: 200, y: 40, z: 60 } }, [3]);
    expect(local[5]).toEqual({ x: -200, y: 40, z: 60 });
    expect(affected.has(5)).toBe(true);
  });

  it('keeps a center joint on the plane', () => {
    const { local } = pointsAfter({ 1: { x: 30, y: 5, z: 110 } }, [1]);
    expect(local[1]).toEqual({ x: 0, y: 5, z: 110 });
  });

  it('leaves each side its own when both are selected', () => {
    const { local } = pointsAfter({ 3: { x: 200, y: 40, z: 60 }, 5: { x: 7, y: 8, z: 9 } }, [3, 5]);
    expect(local[3].x).toBe(200);
    expect(local[5]).toEqual({ x: 7, y: 8, z: 9 });
  });
});

describe('mirroring poses', () => {
  it('reflects the world result for any pose, in either rotation mode', () => {
    const { document, id } = rig();
    const pose = { position: { x: 3, y: -4, z: 5 }, rotation: { w: 0.8, x: 0.2, y: 0.5, z: -0.2 }, scale: { x: 1, y: 1, z: 1 } };
    const size = Math.hypot(0.8, 0.2, 0.5, 0.2);
    pose.rotation = { w: 0.8 / size, x: 0.2 / size, y: 0.5 / size, z: -0.2 / size };
    let posed = updateTransform(document, 'upperA', () => pose);
    posed = updateTransform(posed, 'upperB', () => mirroredPose(pose, transform()));
    const euler = updateTransform(posed, 'upperB', () => mirroredPose(pose, { ...transform(), rotation: { x: 0, y: 0, z: 0 } }));
    for (const version of [posed, euler]) {
      const armature = findObject(version, id)!;
      const segments = boneSegments(armature, worldMatrices(version, 0), poseAt(armature.vertices, 0));
      const at = (name: string) => segments.find(segment => segment.bone.id === name)!;
      expect(at('lowerB').tail.x).toBeCloseTo(-at('lowerA').tail.x, 6);
      expect(at('lowerB').tail.y).toBeCloseTo(at('lowerA').tail.y, 6);
      expect(at('lowerB').tail.z).toBeCloseTo(at('lowerA').tail.z, 6);
    }
  });
});

describe('editing an armature with mirroring on', () => {
  it('extrudes both sides, selecting one, and they stay paired', () => {
    const { document, id } = rig();
    const next = extrudeBones(select(document, id, [3]), id, 0);
    const armature = findObject(next, id)!;
    expect(armature.bones).toHaveLength(7);
    expect(armature.selectedVertices.size).toBe(1);
    const [selected] = Array.from(armature.selectedVertices);
    const partner = jointPartners(armature, poseAt(armature.vertices, 0)).get(selected)!;
    expect(armature.vertices[partner]).toEqual({ x: -120, y: 30, z: 80 });
    expect(partner).not.toBe(selected);
  });

  it('extrudes once from a center joint', () => {
    const { document, id } = rig();
    expect(findObject(extrudeBones(select(document, id, [1]), id, 0), id)!.bones).toHaveLength(6);
  });

  it('deletes both sides', () => {
    const { document, id } = rig();
    const chosen = select(document, id, [3]);
    expect(bonesToDelete(findObject(chosen, id)!, 0).map(({ id: name }) => name).sort()).toEqual(['lowerA', 'lowerB']);
    expect(findObject(deleteBones(chosen, id, 0), id)!.bones!.map(({ id: name }) => name)).toEqual(['spine', 'upperA', 'upperB']);
  });
});

describe('symmetrizing', () => {
  // The rig without its -x arm, and with its +x arm given an IK constraint on a foot.R.
  function half() {
    const { document, id } = rig();
    const withFeet = addObject(addObject(document, 'foot.R', { vertices: [{ x: 0, y: 0, z: 0 }], faces: [], edges: [] }), 'foot.L', { vertices: [{ x: 0, y: 0, z: 0 }], faces: [], edges: [] });
    const footR = withFeet.objects.find(object => object.name === 'foot.R')!.id;
    let next = updateObject(withFeet, id, object => ({ ...object, mirrorEdit: false, selectedVertices: new Set([4, 5]) }));
    next = { ...deleteBones(next, id, 0), activeObject: id };
    next = updateObject(next, id, object => ({
      ...object,
      bones: object.bones!.map(other => (other.id === 'lowerA' ? { ...other, name: 'Arm.L' } : other)),
    }));
    next = addConstraint(next, 'lowerA', 'ik');
    next = updateConstraint(next, 'lowerA', findBone(next, 'lowerA')!.bone.constraints[0].id, { target: footR });
    return { document: next, id };
  }

  it('creates the missing side, connected, parented, named, and with flipped targets', () => {
    const { document, id } = half();
    const armature = findObject(document, id)!;
    const upper = armature.bones!.find(other => other.id === 'upperA')!;
    const lower = armature.bones!.find(other => other.id === 'lowerA')!;
    const next = symmetrizeBones(updateObject(document, id, object => ({ ...object, selectedVertices: new Set([upper.tail, lower.tail]) })), id, 0);
    const result = findObject(next, id)!;
    expect(result.bones).toHaveLength(5);
    const newLower = result.bones!.find(other => other.name === 'Arm.R')!;
    const newUpper = result.bones!.find(other => other.id === newLower.parent)!;
    expect(newUpper.parent).toBe('spine');
    expect(newUpper.head).toBe(result.bones!.find(other => other.id === 'spine')!.tail);
    expect(newLower.head).toBe(newUpper.tail);
    expect(result.vertices[newLower.tail]).toEqual({ x: -120, y: 30, z: 80 });
    const footL = next.objects.find(object => object.name === 'foot.L')!.id;
    expect(newLower.constraints[0].target).toBe(footL);
    expect(newLower.constraints[0].id).not.toBe(result.bones!.find(other => other.id === 'lowerA')!.constraints[0].id);
    expect(bonePartners(result, poseAt(result.vertices, 0)).get('upperA')).toBe(newUpper.id);
  });

  it('overwrites a side that exists, and with both selected keeps -x', () => {
    const { document, id } = rig();
    const moved = updateObject(document, id, object => ({
      ...object,
      bones: object.bones!.map(other => (other.id === 'lowerA' ? { ...other, name: 'Arm.R' } : other.id === 'lowerB' ? { ...other, name: 'Arm.L' } : other)),
      vertices: object.vertices.map((vertex, i) => (i === 5 ? { x: -150, y: 70, z: 20 } : vertex)),
      selectedVertices: new Set([3, 5]),
    }));
    const result = findObject(symmetrizeBones(moved, id, 0), id)!;
    expect(result.bones).toHaveLength(5);
    expect(result.vertices[3]).toEqual({ x: 150, y: 70, z: 20 });
    expect(result.vertices[5]).toEqual({ x: -150, y: 70, z: 20 });
  });

  it('leaves a center bone alone', () => {
    const { document, id } = rig();
    const result = symmetrizeBones(select(document, id, [1]), id, 0);
    expect(findObject(result, id)!.bones).toHaveLength(5);
  });
});
