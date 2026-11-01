import { Matrix, matrixOrigin } from './matrix';
import { Vec3 } from './model';

export type ConstraintKind = 'copyLocation' | 'copyRotation' | 'lookAt';

export const CONSTRAINT_LABELS: Record<ConstraintKind, string> = {
  copyLocation: 'Copy Location',
  copyRotation: 'Copy Rotation',
  lookAt: 'Look At',
};

// Overrides an object's world transform using another object's. Influence 0 leaves it alone and
// influence 1 applies it fully.
export type Constraint = { id: string; kind: ConstraintKind; target: string | null; influence: number };

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

function constrained(m: Matrix, kind: ConstraintKind, target: Matrix): Matrix {
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
  }
}

// Partial influence blends the matrices directly, which is exact for location and approximate
// for rotations.
export function applyConstraint(m: Matrix, kind: ConstraintKind, target: Matrix, influence: number): Matrix {
  const full = constrained(m, kind, target);
  return m.map((value, i) => value + (full[i] - value) * influence);
}
