import { Bone } from './armature';
import { Selection } from './editing';
import { rotationLike } from '../../../lib/vrender/matrix';
import { Transform, Vec3 } from '../../../lib/vrender/model';
import { flippedName } from './modifiers';

// How far apart two joints can be and still count as each other's reflection, or a joint as on the
// mirror plane. Bones pair by exact placement, so that nothing pairs by accident.
const PLACEMENT_TOLERANCE = 0.01;

type Rig = { bones?: Bone[] | null };

export function reflected({ x, y, z }: Vec3): Vec3 {
  return { x: -x, y, z };
}

function coincide(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < PLACEMENT_TOLERANCE;
}

export function isOnPlane({ x }: Vec3): boolean {
  return Math.abs(x) < PLACEMENT_TOLERANCE;
}

// A bone with length lying along the mirror plane has no other side. A new bone with no length yet
// is still free to go to either.
export function isCenterBone(bone: Bone, joints: Vec3[]): boolean {
  return isOnPlane(joints[bone.head]) && isOnPlane(joints[bone.tail]) && !coincide(joints[bone.head], joints[bone.tail]);
}

// Which bone is each bone's other side across its armature's x, both ways round: by name where they
// are named .L and .R, as in Blender, and otherwise where one lies exactly on the other's reflection.
export function bonePartners(rig: Rig, joints: Vec3[]): Map<string, string> {
  const bones = rig.bones ?? [];
  const partners = new Map<string, string>();
  const pair = (a: Bone, b: Bone) => {
    partners.set(a.id, b.id);
    partners.set(b.id, a.id);
  };
  for (const bone of bones) {
    const flipped = flippedName(bone.name);
    const named = flipped !== bone.name ? bones.find(other => other.name === flipped) : undefined;
    if (named) {
      pair(bone, named);
    }
  }
  for (const bone of bones) {
    if (partners.has(bone.id) || isCenterBone(bone, joints)) {
      continue;
    }
    const placed = bones.find(other => other !== bone && !partners.has(other.id)
      && coincide(joints[other.head], reflected(joints[bone.head])) && coincide(joints[other.tail], reflected(joints[bone.tail])));
    if (placed) {
      pair(bone, placed);
    }
  }
  return partners;
}

// Which joint is each joint's other side. A joint on a center bone, or shared across the plane by a
// pair of bones, is its own.
export function jointPartners(rig: Rig, joints: Vec3[], partners = bonePartners(rig, joints)): Map<number, number> {
  const result = new Map<number, number>();
  const bones = rig.bones ?? [];
  for (const bone of bones) {
    const partner = bones.find(other => other.id === partners.get(bone.id));
    if (partner) {
      result.set(bone.head, partner.head);
      result.set(bone.tail, partner.tail);
    } else if (isCenterBone(bone, joints)) {
      result.set(bone.head, bone.head);
      result.set(bone.tail, bone.tail);
    }
  }
  return result;
}

// Local joint positions with each selected joint's other side following it. Where both sides are
// selected, each goes its own way, and a joint that is its own other side stays on the plane.
export function mirroredJoints(local: Vec3[], selection: Selection, affected: Selection, joints: ReadonlyMap<number, number>): { local: Vec3[]; affected: Selection } {
  const next = [...local];
  const reached = new Set(affected);
  selection.forEach(joint => {
    const partner = joints.get(joint);
    if (partner === joint) {
      next[joint] = { ...next[joint], x: 0 };
    } else if (partner !== undefined && !selection.has(partner)) {
      next[partner] = reflected(next[joint]);
      reached.add(partner);
    }
  });
  return { local: next, affected: reached };
}

// A pose on the other side. Paired bones rest as reflections of each other with their local x flipped,
// so across any bone this is the same rule. like gives the rotation mode to keep.
export function mirroredPose({ position, rotation, scale }: Transform, like: Transform): Transform {
  return {
    position: { x: -position.x, y: position.y, z: position.z },
    rotation: rotationLike({ ...rotation, y: -rotation.y, z: -rotation.z }, like.rotation),
    scale,
  };
}
