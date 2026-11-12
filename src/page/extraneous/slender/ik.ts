import { applyMatrix, Matrix, matrixOrigin, multiply } from '../../../lib/vrender/matrix';
import { Vec3 } from '../../../lib/vrender/model';

const MAX_ITERATIONS = 32;
const TOLERANCE = 1e-5;
const STRAIGHT = 1e-3;
const SEED_BEND = 0.05;

function minus(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function plus(a: Vec3, b: Vec3, scale = 1): Vec3 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function unit(a: Vec3): Vec3 {
  const size = length(a);
  return size < 1e-12 ? { x: 0, y: 0, z: 0 } : { x: a.x / size, y: a.y / size, z: a.z / size };
}

// The part of a vector square to a unit axis.
function square(a: Vec3, axis: Vec3): Vec3 {
  return plus(a, axis, -dot(a, axis));
}

function turned(a: Vec3, axis: Vec3, angle: number): Vec3 {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return plus(plus({ x: a.x * cos, y: a.y * cos, z: a.z * cos }, cross(axis, a), sin), axis, dot(axis, a) * (1 - cos));
}

// The smallest turn taking one unit vector to another, as a matrix without translation.
function turnBetween(from: Vec3, to: Vec3): Matrix {
  const cos = Math.max(-1, Math.min(1, dot(from, to)));
  let axis = cross(from, to);
  if (length(axis) < 1e-9) {
    if (cos > 0) {
      return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    }
    axis = cross(from, Math.abs(from.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 });
  }
  const { x, y, z } = unit(axis);
  const sin = Math.sqrt(1 - cos * cos);
  const t = 1 - cos;
  return [
    t * x * x + cos, t * x * y - sin * z, t * x * z + sin * y, 0,
    t * x * y + sin * z, t * y * y + cos, t * y * z - sin * x, 0,
    t * x * z - sin * y, t * y * z + sin * x, t * z * z + cos, 0,
  ];
}

// FABRIK: reaches from the tip back to the root and from the root back out, keeping each link's
// length, until the tip arrives. It bends the way the joints already bend. Out of reach, the chain
// points straight at the target.
function reach(start: Vec3[], lengths: number[], target: Vec3): Vec3[] {
  const joints = [...start];
  const root = joints[0];
  const total = lengths.reduce((sum, link) => sum + link, 0);
  const toTarget = minus(target, root);
  if (length(toTarget) >= total) {
    const direction = unit(toTarget);
    lengths.forEach((link, i) => {
      joints[i + 1] = plus(joints[i], direction, link);
    });
    return joints;
  }
  const last = joints.length - 1;
  for (let iteration = 0; iteration < MAX_ITERATIONS && length(minus(joints[last], target)) > total * TOLERANCE; iteration++) {
    joints[last] = target;
    for (let i = last - 1; i >= 0; i--) {
      joints[i] = plus(joints[i + 1], unit(minus(joints[i], joints[i + 1])), lengths[i]);
    }
    joints[0] = root;
    for (let i = 0; i < last; i++) {
      joints[i + 1] = plus(joints[i], unit(minus(joints[i + 1], joints[i])), lengths[i]);
    }
  }
  return joints;
}

// A chain lying straight along the way to its target can bend in no direction by itself, so it gets
// a slight bend toward the hint.
function withBend(joints: Vec3[], target: Vec3, hint: Vec3, total: number): Vec3[] {
  const axis = unit(minus(target, joints[0]));
  const offsets = joints.map(joint => length(square(minus(joint, joints[0]), axis)));
  if (Math.max(...offsets) > total * STRAIGHT) {
    return joints;
  }
  const away = unit(square(hint, axis));
  return joints.map((joint, i) => (i === 0 || i === joints.length - 1 ? joint : plus(joint, away, total * SEED_BEND)));
}

// Swings the joints between the ends about the line joining them, so that the bend points at the
// pole, then further by an angle.
function aimedAtPole(joints: Vec3[], pole: Vec3, angle: number): Vec3[] {
  const root = joints[0];
  const axis = unit(minus(joints[joints.length - 1], root));
  const wanted = square(minus(pole, root), axis);
  const bends = joints.map(joint => square(minus(joint, root), axis));
  const bend = bends.reduce((most, candidate) => (length(candidate) > length(most) ? candidate : most));
  if (length(axis) === 0 || length(wanted) < 1e-9 || length(bend) < 1e-9) {
    return joints;
  }
  const swing = Math.atan2(dot(axis, cross(bend, wanted)), dot(bend, wanted)) + angle;
  return joints.map((joint, i) => (i === 0 || i === joints.length - 1 ? joint : plus(root, turned(minus(joint, root), axis, swing))));
}

export type ChainGoal = { target: Vec3; pole: Vec3 | null; poleAngle: number; influence: number };

// Where a chain of bones ends up when the tail of its last bone reaches for a target, given each
// bone's world matrix without IK, root first. The root stays where it is. Each bone turns as little
// as it can from where it was, so a bone keeps its twist.
export function solveChain(bones: Matrix[], tipLength: number, { target, pole, poleAngle, influence }: ChainGoal): Matrix[] {
  const start = [...bones.map(matrixOrigin), applyMatrix(bones[bones.length - 1], 0, tipLength, 0)];
  const lengths = bones.map((_, i) => length(minus(start[i + 1], start[i])));
  const total = lengths.reduce((sum, link) => sum + link, 0);
  if (total < 1e-9) {
    return bones;
  }
  // A bone's own z is the bend's direction of last resort.
  const hint = pole ? minus(pole, start[0]) : { x: bones[0][2], y: bones[0][6], z: bones[0][10] };
  let solved = reach(withBend(start, target, hint, total), lengths, target);
  if (pole) {
    solved = aimedAtPole(solved, pole, poleAngle);
  }
  if (influence < 1) {
    const blended = [start[0]];
    lengths.forEach((link, i) => {
      const from = unit(minus(start[i + 1], start[i]));
      const to = unit(minus(solved[i + 1], solved[i]));
      blended.push(plus(blended[i], unit(plus(plus({ x: 0, y: 0, z: 0 }, from, 1 - influence), to, influence)), link));
    });
    solved = blended;
  }
  return bones.map((bone, i) => {
    const turn = turnBetween(unit(minus(start[i + 1], start[i])), unit(minus(solved[i + 1], solved[i])));
    const result = multiply(turn, bone);
    result[3] = solved[i].x;
    result[7] = solved[i].y;
    result[11] = solved[i].z;
    return result;
  });
}
