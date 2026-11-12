import { Track } from './animation';
import { sampleTrack } from './animation';
import { invertMatrix, Matrix, matrixOrigin, multiply } from '../../../lib/vrender/matrix';
import { Vec3 } from '../../../lib/vrender/model';

export type ConstraintKind = 'copyLocation' | 'copyRotation' | 'lookAt' | 'childOf' | 'ik';

export const CONSTRAINT_LABELS: Record<ConstraintKind, string> = {
  copyLocation: 'Copy Location',
  copyRotation: 'Copy Rotation',
  lookAt: 'Look At',
  childOf: 'Child Of',
  ik: 'Inverse Kinematics',
};

// Overrides an object's world transform using another object's. Influence 0 leaves it alone and
// influence 1 applies it fully, and it can be animated.
export type Constraint = {
  id: string;
  kind: ConstraintKind;
  target: string | null;
  influence: number | Track;
  // Child Of: undoes where the target was when this was set, so that the child does not jump.
  inverse?: Matrix;
  // Inverse Kinematics, which bones alone can have. The tail of the bone reaches for the target.
  // chainLength counts bones up from this one, with 0 meaning all the way to the root.
  chainLength?: number;
  // What the bend of the chain points at, then swung about the chain by an angle in radians.
  pole?: string | null;
  poleAngle?: number;
};

export const DEFAULT_CHAIN_LENGTH = 2;

function columnLengths(m: Matrix): [number, number, number] {
  return [Math.hypot(m[0], m[4], m[8]), Math.hypot(m[1], m[5], m[9]), Math.hypot(m[2], m[6], m[10])];
}

// A matrix with the given unit axes as its columns, keeping an object's scale and position.
function withAxes(m: Matrix, x: Vec3, y: Vec3, z: Vec3): Matrix {
  const [sx, sy, sz] = columnLengths(m);
  return [
    x.x * sx, y.x * sy, z.x * sz, m[3],
    x.y * sx, y.y * sy, z.y * sz, m[7],
    x.z * sx, y.z * sy, z.z * sz, m[11],
  ];
}

function normalized({ x, y, z }: Vec3): Vec3 {
  const length = Math.hypot(x, y, z);
  return length === 0 ? { x: 0, y: 0, z: 0 } : { x: x / length, y: y / length, z: z / length };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

// Aims local +y, the way cameras look, at a point, keeping local +z as near to world up as it can.
function lookingAt(m: Matrix, point: Vec3): Matrix {
  const origin = matrixOrigin(m);
  const toPoint = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z };
  if (Math.hypot(toPoint.x, toPoint.y, toPoint.z) < 1e-9) {
    return m;
  }
  const y = normalized(toPoint);
  // Looking straight up or down, world up cannot define a roll, so another axis stands in.
  const up = Math.abs(y.z) > 0.999 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const x = normalized(cross(y, up));
  return withAxes(m, x, y, cross(x, y));
}

function constrained(m: Matrix, kind: ConstraintKind, target: Matrix, inverse?: Matrix): Matrix {
  switch (kind) {
    case 'copyLocation': {
      const result = [...m];
      result[3] = target[3];
      result[7] = target[7];
      result[11] = target[11];
      return result;
    }
    case 'copyRotation': {
      const [sx, sy, sz] = columnLengths(target);
      return withAxes(
        m,
        { x: target[0] / sx, y: target[4] / sx, z: target[8] / sx },
        { x: target[1] / sy, y: target[5] / sy, z: target[9] / sy },
        { x: target[2] / sz, y: target[6] / sz, z: target[10] / sz },
      );
    }
    case 'lookAt':
      return lookingAt(m, matrixOrigin(target));
    case 'childOf':
      return multiply(inverse ? multiply(target, inverse) : target, m);
    // Solved along the whole chain, in worldMatrices.
    case 'ik':
      return m;
  }
}

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

// Child Of. With its influence keyed, it is a switch, and nothing jumps at either kind of key: turning
// on starts following the target from where it is at that moment, and turning off stays wherever
// following it had led. So the keys alone say when something is held, and any number of times.
export function childOfMatrix(m: Matrix, { influence, inverse }: Constraint, target: Matrix, time: number, targetAt: (time: number) => Matrix): Matrix {
  if (typeof influence === 'number') {
    return applyConstraint(m, 'childOf', target, influence, inverse);
  }
  const isNow = (other: number) => Math.abs(other - time) < 1e-6;
  const { keys, held } = influence;
  const heldNow = held && isNow(held.time);
  const events = [
    ...keys.filter(key => key.time <= time + 1e-6 && !(heldNow && isNow(key.time))),
    ...(heldNow ? [{ time, value: held!.value }] : []),
  ];
  let on = keys[0].value >= 0.5;
  let undo = inverse ?? IDENTITY;
  let carried = IDENTITY;
  for (const event of events) {
    const next = event.value >= 0.5;
    const there = isNow(event.time) ? target : targetAt(event.time);
    if (on && !next) {
      carried = multiply(multiply(there, undo), carried);
    } else if (!on && next) {
      undo = invertMatrix(there);
    }
    on = next;
  }
  return multiply(on ? multiply(multiply(target, undo), carried) : carried, m);
}

export function isSwitchedOn(constraint: Constraint, time: number): boolean {
  return (typeof constraint.influence === 'number' ? constraint.influence : sampleTrack(constraint.influence, time)) >= 0.5;
}

// Partial influence blends the matrices directly, which is exact for location and approximate
// for rotations.
export function applyConstraint(m: Matrix, kind: ConstraintKind, target: Matrix, influence: number, inverse?: Matrix): Matrix {
  const full = constrained(m, kind, target, inverse);
  return m.map((value, i) => value + (full[i] - value) * influence);
}
