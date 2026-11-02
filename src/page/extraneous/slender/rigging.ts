import { automaticWeights, Bone, restMatrix, VertexGroup } from './armature';
import { bonePartners, isCenterBone, isOnPlane, jointPartners, reflected } from './armatureMirror';
import {
  addObject, canParent, EditorDocument, findBone, findObject, ObjectTransform, releaseReferences, SceneObject, selectedVisible, setParent, toWorld,
  transformParts, uniqueName, updateObject, updateTransform, withTransformParts, worldMatrices,
} from './document';
import { Selection } from './editing';
import { commitEdit, poseAt } from './keyframes';
import { applyMatrix, multiply } from './matrix';
import { Vec3 } from './model';
import { flippedName } from './modifiers';

const DEFAULT_BONE_LENGTH = 100;

export type ClearField = 'position' | 'rotation' | 'scale';
export type ParentKind = 'object' | 'withoutInverse' | 'armature' | 'armatureAuto' | 'bone';
export type PaintTool = 'mix' | 'subtract' | 'smooth';

const CLEARED: Record<ClearField, Vec3> = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
const PART_INDEX: Record<ClearField, number> = { position: 0, rotation: 1, scale: 2 };

// Bones start as quaternions, as in Blender, since they turn freely and blend the short way.
function restTransform(): ObjectTransform {
  return { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
}

// Resets one part of each object's or bone's transform, keying it if it is animated.
export function clearTransforms(document: EditorDocument, ids: string[], field: ClearField, time: number): EditorDocument {
  const index = PART_INDEX[field];
  return ids.reduce((next, id) => updateTransform(next, id, transform => {
    const posable = { transform };
    const pose: Vec3[] = [];
    pose[index] = field === 'rotation' && transform.rotation.w !== undefined ? { w: 1, ...CLEARED.rotation } as Vec3 : CLEARED[field];
    return withTransformParts(posable, commitEdit(transformParts(posable), new Set([index]), pose, time)).transform;
  }), document);
}

// An armature with one upright bone, selected as an object.
export function addArmature(document: EditorDocument, at?: Vec3): EditorDocument {
  const added = addObject(document, 'Armature', {
    vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: DEFAULT_BONE_LENGTH }],
    faces: [],
    edges: [[0, 1]],
  }, null, at);
  const bone = newBone(`bone-${added.nextId}`, 'Bone', null, 0, 1);
  return {
    ...updateObject(added, added.activeObject!, object => ({ ...object, bones: [bone] })),
    nextId: added.nextId + 1,
  };
}

function newBone(id: string, name: string, parent: string | null, head: number, tail: number): Bone {
  return { id, name, parent, head, tail, transform: restTransform(), constraints: [] };
}

// Stores changed bones, dropping joints no bone uses and keeping the object's lines and selection in step.
function withBones(object: SceneObject, bones: Bone[], selected: Selection): SceneObject {
  const used = Array.from(new Set(bones.flatMap(bone => [bone.head, bone.tail]))).sort((a, b) => a - b);
  const position = new Map(used.map((old, i) => [old, i]));
  const reindexed = bones.map(bone => ({ ...bone, head: position.get(bone.head)!, tail: position.get(bone.tail)! }));
  return {
    ...object,
    vertices: used.map(i => object.vertices[i]),
    bones: reindexed,
    edges: reindexed.map(bone => [bone.head, bone.tail]),
    selectedVertices: new Set(Array.from(selected).flatMap(i => (position.has(i) ? [position.get(i)!] : []))),
  };
}

function boneNames(object: SceneObject): string[] {
  return (object.bones ?? []).map(bone => bone.name);
}

// Bones count as selected by their tail, or by their head if no tail is selected.
export function selectedBonesOf(object: SceneObject): Bone[] {
  const bones = object.bones ?? [];
  const byTail = bones.filter(bone => object.selectedVertices.has(bone.tail));
  return byTail.length > 0 ? byTail : bones.filter(bone => object.selectedVertices.has(bone.head));
}

// The bone a set of picked joints most directly means.
export function boneFromJoints(object: SceneObject, joints: number[]): string | null {
  const bones = object.bones ?? [];
  const match = bones.find(bone => joints.includes(bone.head) && joints.includes(bone.tail))
    ?? bones.find(bone => joints.includes(bone.tail))
    ?? bones.find(bone => joints.includes(bone.head));
  return match?.id ?? null;
}

// Adds a separate upright bone at the armature's origin, selected.
export function addBone(document: EditorDocument, armatureId: string): EditorDocument {
  const object = findObject(document, armatureId)!;
  const start = object.vertices.length;
  const id = `bone-${document.nextId}`;
  const bone = newBone(id, uniqueName(boneNames(object), 'Bone'), null, start, start + 1);
  const vertices = [...object.vertices, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: DEFAULT_BONE_LENGTH }];
  return {
    ...updateObject(document, armatureId, current => withBones({ ...current, vertices }, [...current.bones!, bone], new Set([start, start + 1]))),
    nextId: document.nextId + 1,
    activeBone: id,
  };
}

// Grows a new bone from each selected joint, with only the new tails selected. From a tail, the
// new bone connects as a child. From a head, it becomes a sibling sharing that head.
export function extrudeBones(document: EditorDocument, armatureId: string, time: number): EditorDocument {
  const object = findObject(document, armatureId)!;
  const pose = poseAt(object.vertices, time);
  let number = document.nextId;
  const vertices = [...object.vertices];
  const bones = [...object.bones!];
  const tails: number[] = [];
  let active: string | null = document.activeBone;
  // With mirroring, the other side grows too, and only this side stays selected, so the other follows.
  const partners = object.mirrorEdit ? jointPartners(object, pose) : new Map<number, number>();
  const chosen = Array.from(object.selectedVertices);
  const leading = chosen.filter(joint => {
    const partner = partners.get(joint);
    return partner === undefined || partner === joint || !object.selectedVertices.has(partner) || joint < partner;
  });
  const following = leading.flatMap(joint => {
    const partner = partners.get(joint);
    return partner === undefined || partner === joint ? [] : [partner];
  });
  [...following, ...leading].forEach(joint => {
    const fromTail = object.bones!.find(bone => bone.tail === joint);
    const fromHead = object.bones!.find(bone => bone.head === joint);
    const source = fromTail ?? fromHead;
    if (source) {
      const tail = vertices.length;
      vertices.push(pose[joint]);
      active = `bone-${number++}`;
      bones.push(newBone(active, uniqueName(bones.map(bone => bone.name), source.name), fromTail ? fromTail.id : source.parent, joint, tail));
      if (leading.includes(joint)) {
        tails.push(tail);
      }
    }
  });
  return {
    ...updateObject(document, armatureId, current => withBones({ ...current, vertices }, bones, new Set(tails))),
    nextId: number,
    activeBone: active,
  };
}

// Copies the selected bones, keeping how they connect among themselves, and selects the copies.
export function duplicateBones(document: EditorDocument, armatureId: string): EditorDocument {
  const object = findObject(document, armatureId)!;
  const chosen = selectedBonesOf(object);
  let number = document.nextId;
  const vertices = [...object.vertices];
  const jointCopies = new Map<number, number>();
  const copyJoint = (joint: number) => {
    if (!jointCopies.has(joint)) {
      jointCopies.set(joint, vertices.length);
      vertices.push(object.vertices[joint]);
    }
    return jointCopies.get(joint)!;
  };
  const ids = new Map(chosen.map(bone => [bone.id, `bone-${number++}`]));
  const bones = [...object.bones!];
  for (const bone of chosen) {
    bones.push(newBone(
      ids.get(bone.id)!,
      uniqueName(bones.map(other => other.name), bone.name),
      bone.parent ? ids.get(bone.parent) ?? bone.parent : null,
      copyJoint(bone.head),
      copyJoint(bone.tail),
    ));
  }
  return {
    ...updateObject(document, armatureId, current => withBones({ ...current, vertices }, bones, new Set(Array.from(jointCopies.values())))),
    nextId: number,
    activeBone: ids.get(chosen[chosen.length - 1]?.id) ?? document.activeBone,
  };
}

// Deletes the selected bones. Their children attach to whatever they were attached to, and
// anything that followed them lets go, staying in place.
export function deleteBones(document: EditorDocument, armatureId: string, time: number): EditorDocument {
  const chosen = bonesToDelete(findObject(document, armatureId)!, time);
  const gone = chosen.map(bone => bone.id);
  const released = releaseReferences(document, gone, time);
  const parentAfter = (id: string | null): string | null => {
    const bone = chosen.find(candidate => candidate.id === id);
    return bone ? parentAfter(bone.parent) : id;
  };
  return updateObject(released, armatureId, object => withBones(
    object,
    object.bones!.filter(bone => !gone.includes(bone.id)).map(bone => ({ ...bone, parent: parentAfter(bone.parent) })),
    new Set(),
  ));
}

// The selected bones, with their other sides if the armature mirrors its edits.
export function bonesToDelete(object: SceneObject, time: number): Bone[] {
  const chosen = selectedBonesOf(object);
  if (!object.mirrorEdit) {
    return chosen;
  }
  const partners = bonePartners(object, poseAt(object.vertices, time));
  return object.bones!.filter(bone => chosen.some(other => other.id === bone.id || partners.get(other.id) === bone.id));
}

// Makes the other side of each selected bone match it, creating bones that are missing: where they
// lie, what they are parented to, and their constraints, whose targets flip sides where they have
// one. With both sides selected, -x is the side kept, as in Blender.
export function symmetrizeBones(document: EditorDocument, armatureId: string, time: number): EditorDocument {
  const object = findObject(document, armatureId)!;
  const pose = poseAt(object.vertices, time);
  const partners = bonePartners(object, pose);
  const chosen = selectedBonesOf(object);
  const meanX = (bone: Bone) => pose[bone.head].x + pose[bone.tail].x;
  const sources = chosen.filter(bone => {
    if (isCenterBone(bone, pose)) {
      return false;
    }
    const other = chosen.find(candidate => candidate.id === partners.get(bone.id));
    return !other || meanX(bone) < meanX(other);
  });
  let number = document.nextId;
  const created = new Map(sources.filter(bone => !partners.has(bone.id)).map(bone => [bone.id, `bone-${number++}`]));
  const partnerOf = (id: string) => created.get(id) ?? partners.get(id) ?? id;

  const vertices = [...object.vertices];
  const joints = jointPartners(object, pose, partners);
  const partnerJoint = (joint: number) => {
    if (!joints.has(joint)) {
      joints.set(joint, isOnPlane(pose[joint]) ? joint : vertices.length);
      if (!isOnPlane(pose[joint])) {
        vertices.push(reflected(pose[joint]));
      }
    }
    return joints.get(joint)!;
  };
  const flipTarget = (target: string | null | undefined) => {
    if (!target) {
      return target ?? null;
    }
    if (object.bones!.some(bone => bone.id === target)) {
      return partnerOf(target);
    }
    const flipped = flippedName(findObject(document, target)?.name ?? '');
    return document.objects.find(other => other.id !== target && other.name === flipped)?.id ?? target;
  };

  let bones = [...object.bones!];
  for (const source of sources) {
    const [head, tail] = [partnerJoint(source.head), partnerJoint(source.tail)];
    [[source.head, head], [source.tail, tail]].forEach(([from, to]) => {
      if (from !== to) {
        vertices[to] = reflected(pose[from]);
      }
    });
    const constraints = source.constraints.map(constraint => ({
      ...constraint,
      id: `constraint-${number++}`,
      target: flipTarget(constraint.target),
      ...(constraint.kind === 'ik' ? { pole: flipTarget(constraint.pole) } : {}),
    }));
    const parent = source.parent && partnerOf(source.parent);
    const id = partnerOf(source.id);
    if (created.has(source.id)) {
      const flipped = flippedName(source.name);
      const name = uniqueName(bones.map(bone => bone.name), flipped);
      bones.push({ ...newBone(id, name, parent, head, tail), constraints });
    } else {
      bones = bones.map(bone => (bone.id === id ? { ...bone, parent, head, tail, constraints } : bone));
    }
  }
  return {
    ...updateObject(document, armatureId, current => withBones({ ...current, vertices }, bones, current.selectedVertices)),
    nextId: number,
  };
}

// Parents the selected bones to the active bone. Connected moves each one's head to the parent's tail.
export function parentBones(document: EditorDocument, armatureId: string, connected: boolean): EditorDocument {
  const object = findObject(document, armatureId)!;
  const parent = object.bones!.find(bone => bone.id === document.activeBone);
  if (!parent) {
    return document;
  }
  const children = selectedBonesOf(object).filter(bone => bone.id !== parent.id && canParent(document, bone.id, parent.id));
  const bones = object.bones!.map(bone => (children.includes(bone)
    ? { ...bone, parent: parent.id, head: connected ? parent.tail : bone.head }
    : bone));
  return updateObject(document, armatureId, current => withBones(current, bones, current.selectedVertices));
}

// Sets a bone's parent. Null detaches it. Its joints stay where they are.
export function setBoneParent(document: EditorDocument, armatureId: string, boneId: string, parent: string | null): EditorDocument {
  if (parent && !canParent(document, boneId, parent)) {
    return document;
  }
  const object = findObject(document, armatureId)!;
  const bones = object.bones!.map(bone => (bone.id === boneId ? { ...bone, parent } : bone));
  return updateObject(document, armatureId, current => withBones(current, bones, current.selectedVertices));
}

// Renames a bone, keeping names unique within its armature and carrying along the vertex groups
// that it moves.
export function renameBone(document: EditorDocument, boneId: string, name: string): EditorDocument {
  const trimmed = name.trim();
  const found = findBone(document, boneId);
  if (!found || !trimmed || trimmed === found.bone.name) {
    return document;
  }
  const { armature, bone } = found;
  const unique = uniqueName(boneNames(armature).filter(other => other !== bone.name), trimmed);
  return {
    ...document,
    objects: document.objects.map(object => {
      if (object.id === armature.id) {
        return { ...object, bones: object.bones!.map(other => (other.id === boneId ? { ...other, name: unique } : other)) };
      }
      return object.deformer === armature.id
        ? { ...object, vertexGroups: object.vertexGroups.map(group => (group.name === bone.name ? { ...group, name: unique } : group)) }
        : object;
    }),
  };
}

// Without a group for each bone, a mesh has nothing to paint or bend. Existing groups stay.
function withBoneGroups(document: EditorDocument, meshId: string, bones: Bone[]): EditorDocument {
  let next = document;
  for (const bone of bones) {
    if (!findObject(next, meshId)!.vertexGroups.some(group => group.name === bone.name)) {
      next = addVertexGroup(next, meshId, bone.name);
    }
  }
  return next;
}

// Parents the selected objects to the active object, or to its active bone. Reports how many
// could not be, because the active object already depends on them.
export function parentSelected(document: EditorDocument, kind: ParentKind, time: number): { document: EditorDocument; parented: number; refused: number } {
  const active = findObject(document, document.activeObject)!;
  const target = kind === 'bone' ? document.activeBone! : active.id;
  const children = selectedVisible(document).filter(id => id !== active.id);
  const allowed = children.filter(id => canParent(document, id, target));
  let next = document;
  for (const id of allowed) {
    next = setParent(next, id, target, time);
    if (kind === 'withoutInverse') {
      next = clearTransforms(next, [id], 'position', time);
    }
    const child = findObject(next, id)!;
    if ((kind === 'armature' || kind === 'armatureAuto') && !child.bones && !child.camera) {
      next = withBoneGroups(updateObject(next, id, object => ({ ...object, deformer: active.id })), id, active.bones!);
      if (kind === 'armatureAuto') {
        next = withAutomaticWeights(next, id, active, time);
      }
    }
  }
  return { document: next, parented: allowed.length, refused: children.length - allowed.length };
}

function withAutomaticWeights(document: EditorDocument, meshId: string, armature: SceneObject, time: number): EditorDocument {
  const mesh = findObject(document, meshId)!;
  const matrices = worldMatrices(document, time);
  const world = toWorld(matrices.get(meshId)!, poseAt(mesh.vertices, time));
  const armatureWorld = matrices.get(armature.id)!;
  const joints = poseAt(armature.vertices, time);
  const bones = armature.bones!;
  const weights = automaticWeights(world, bones.map(bone => {
    const rest = multiply(armatureWorld, restMatrix(joints[bone.head], joints[bone.tail]));
    const length = Math.hypot(joints[bone.tail].x - joints[bone.head].x, joints[bone.tail].y - joints[bone.head].y, joints[bone.tail].z - joints[bone.head].z);
    return { head: applyMatrix(rest, 0, 0, 0), tail: applyMatrix(rest, 0, length, 0) };
  }));
  return updateObject(document, meshId, object => ({
    ...object,
    vertexGroups: object.vertexGroups.map(group => {
      const bone = bones.findIndex(candidate => candidate.name === group.name);
      return bone >= 0 ? { ...group, weights: weights[bone] } : group;
    }),
  }));
}

export function addVertexGroup(document: EditorDocument, meshId: string, name = 'Group'): EditorDocument {
  const id = `group-${document.nextId}`;
  return {
    ...updateObject(document, meshId, object => ({
      ...object,
      vertexGroups: [...object.vertexGroups, { id, name: uniqueName(object.vertexGroups.map(group => group.name), name), weights: new Map() }],
      activeGroup: id,
    })),
    nextId: document.nextId + 1,
  };
}

export function removeVertexGroup(document: EditorDocument, meshId: string, groupId: string): EditorDocument {
  return updateObject(document, meshId, object => {
    const vertexGroups = object.vertexGroups.filter(group => group.id !== groupId);
    return {
      ...object,
      vertexGroups,
      activeGroup: object.activeGroup === groupId ? vertexGroups[vertexGroups.length - 1]?.id ?? null : object.activeGroup,
    };
  });
}

export function renameVertexGroup(document: EditorDocument, meshId: string, groupId: string, name: string): EditorDocument {
  const trimmed = name.trim();
  return !trimmed ? document : updateObject(document, meshId, object => ({
    ...object,
    vertexGroups: object.vertexGroups.map(group => (group.id === groupId
      ? { ...group, name: uniqueName(object.vertexGroups.filter(other => other !== group).map(other => other.name), trimmed) }
      : group)),
  }));
}

function changeWeights(document: EditorDocument, meshId: string, groupId: string, change: (weights: Map<number, number>) => void): EditorDocument {
  return updateObject(document, meshId, object => ({
    ...object,
    vertexGroups: object.vertexGroups.map(group => {
      if (group.id !== groupId) {
        return group;
      }
      const weights = new Map(group.weights);
      change(weights);
      return { ...group, weights };
    }),
  }));
}

export function assignToGroup(document: EditorDocument, meshId: string, groupId: string, vertices: Selection, weight: number): EditorDocument {
  return changeWeights(document, meshId, groupId, weights => vertices.forEach(i => weights.set(i, weight)));
}

export function removeFromGroup(document: EditorDocument, meshId: string, groupId: string, vertices: Selection): EditorDocument {
  return changeWeights(document, meshId, groupId, weights => vertices.forEach(i => weights.delete(i)));
}

// One stroke's step of a brush. Factors say how strongly it reaches each vertex, from 0 to 1.
export function paintWeights(
  document: EditorDocument, meshId: string, groupId: string, factors: Map<number, number>, tool: PaintTool, weight: number, neighbors: number[][]
): EditorDocument {
  return changeWeights(document, meshId, groupId, weights => {
    const before = new Map(weights);
    factors.forEach((factor, i) => {
      const current = before.get(i) ?? 0;
      let goal = tool === 'subtract' ? 0 : weight;
      if (tool === 'smooth') {
        const around = neighbors[i];
        goal = around.length === 0 ? current : around.reduce((sum, other) => sum + (before.get(other) ?? 0), 0) / around.length;
      }
      const painted = current + (goal - current) * factor;
      if (painted > 0) {
        weights.set(i, painted);
      } else {
        weights.delete(i);
      }
    });
  });
}

// Keeps weights with their vertices after some are deleted. `kept` lists the surviving old indices.
export function groupsAfterDelete(groups: VertexGroup[], kept: number[]): VertexGroup[] {
  const position = new Map(kept.map((old, i) => [old, i]));
  return groups.map(group => {
    const weights = new Map<number, number>();
    group.weights.forEach((weight, i) => {
      if (position.has(i)) {
        weights.set(position.get(i)!, weight);
      }
    });
    return { ...group, weights };
  });
}

// Gives vertices made halfway along a line the average weight of its ends.
export function groupsAfterSubdivide(groups: VertexGroup[], splits: [number, number][], start: number): VertexGroup[] {
  return groups.map(group => {
    const weights = new Map(group.weights);
    splits.forEach(([a, b], i) => {
      const weight = ((group.weights.get(a) ?? 0) + (group.weights.get(b) ?? 0)) / 2;
      if (weight > 0) {
        weights.set(start + i, weight);
      }
    });
    return { ...group, weights };
  });
}

// Gives vertices copied to the end of a mesh the weights of what they were copied from.
export function groupsAfterCopy(groups: VertexGroup[], copiedFrom: number[], start: number): VertexGroup[] {
  return groups.map(group => {
    const weights = new Map(group.weights);
    copiedFrom.forEach((source, i) => {
      const weight = group.weights.get(source);
      if (weight !== undefined) {
        weights.set(start + i, weight);
      }
    });
    return { ...group, weights };
  });
}
