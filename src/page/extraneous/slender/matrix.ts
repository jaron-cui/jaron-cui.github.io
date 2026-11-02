import { Camera, Rotation, Transform, Vec3 } from './model';

// A 3D affine transform: the top three rows of a 4x4 matrix, in row order.
export type Matrix = number[];

function quaternionRows({ w = 1, x, y, z }: Rotation): number[] {
  const length = Math.hypot(w, x, y, z) || 1;
  const [a, b, c, d] = [w / length, x / length, y / length, z / length];
  return [
    1 - 2 * (c * c + d * d), 2 * (b * c - a * d), 2 * (b * d + a * c),
    2 * (b * c + a * d), 1 - 2 * (b * b + d * d), 2 * (c * d - a * b),
    2 * (b * d - a * c), 2 * (c * d + a * b), 1 - 2 * (b * b + c * c),
  ];
}

function rotationRows(rotation: Rotation): number[] {
  if (rotation.w !== undefined) {
    return quaternionRows(rotation);
  }
  const { x, y, z } = rotation;
  const [cx, sx] = [Math.cos(x), Math.sin(x)];
  const [cy, sy] = [Math.cos(y), Math.sin(y)];
  const [cz, sz] = [Math.cos(z), Math.sin(z)];
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

export function transformMatrix({ position: p, rotation, scale: s }: Transform): Matrix {
  const r = rotationRows(rotation);
  return [
    r[0] * s.x, r[1] * s.y, r[2] * s.z, p.x,
    r[3] * s.x, r[4] * s.y, r[5] * s.z, p.y,
    r[6] * s.x, r[7] * s.y, r[8] * s.z, p.z,
  ];
}

// Maps world space to view space, whose axes follow the image: x right, y down, z into the screen.
// This undoes the camera's placement, then turns its local x, y, z into right, forward, up.
export function viewMatrix({ position: p, rotation }: Camera): Matrix {
  const r = rotationRows(rotation);
  const right = [r[0], r[3], r[6], -(r[0] * p.x + r[3] * p.y + r[6] * p.z)];
  const forward = [r[1], r[4], r[7], -(r[1] * p.x + r[4] * p.y + r[7] * p.z)];
  const up = [r[2], r[5], r[8], -(r[2] * p.x + r[5] * p.y + r[8] * p.z)];
  return [...right, ...up.map(value => -value), ...forward];
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const result: Matrix = [];
  for (let row = 0; row < 3; row++) {
    const [a0, a1, a2, a3] = a.slice(row * 4, row * 4 + 4);
    result.push(
      a0 * b[0] + a1 * b[4] + a2 * b[8],
      a0 * b[1] + a1 * b[5] + a2 * b[9],
      a0 * b[2] + a1 * b[6] + a2 * b[10],
      a0 * b[3] + a1 * b[7] + a2 * b[11] + a3
    );
  }
  return result;
}

export function applyMatrix(m: Matrix, x: number, y: number, z: number): Vec3 {
  return {
    x: m[0] * x + m[1] * y + m[2] * z + m[3],
    y: m[4] * x + m[5] * y + m[6] * z + m[7],
    z: m[8] * x + m[9] * y + m[10] * z + m[11],
  };
}

// The inverse of an invertible affine transform.
export function invertMatrix(m: Matrix): Matrix {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = m;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const r = [
    (e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant,
    (f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant,
    (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant,
  ];
  return [
    r[0], r[1], r[2], -(r[0] * tx + r[1] * ty + r[2] * tz),
    r[3], r[4], r[5], -(r[3] * tx + r[4] * ty + r[5] * tz),
    r[6], r[7], r[8], -(r[6] * tx + r[7] * ty + r[8] * tz),
  ];
}

export function matrixOrigin(m: Matrix): Vec3 {
  return { x: m[3], y: m[7], z: m[11] };
}

function eulerFromRows(r: number[]): Vec3 {
  const y = Math.atan2(-r[6], Math.hypot(r[0], r[3]));
  // At y = +-PI / 2, x and z turn about the same axis, so z alone carries the rotation.
  const locked = Math.hypot(r[0], r[3]) < 1e-9;
  return {
    x: locked ? 0 : Math.atan2(r[7], r[8]),
    y,
    z: locked ? Math.atan2(-r[1], r[4]) : Math.atan2(r[3], r[0]),
  };
}

// Splits a matrix into position, rotation, and scale, assuming it has no shear. A parent with
// uneven scale over a rotated child can produce shear, which this approximates.
export function decompose(m: Matrix): Transform {
  const scale = {
    x: Math.hypot(m[0], m[4], m[8]),
    y: Math.hypot(m[1], m[5], m[9]),
    z: Math.hypot(m[2], m[6], m[10]),
  };
  const rows = [
    m[0] / scale.x, m[1] / scale.y, m[2] / scale.z,
    m[4] / scale.x, m[5] / scale.y, m[6] / scale.z,
    m[8] / scale.x, m[9] / scale.y, m[10] / scale.z,
  ];
  return { position: matrixOrigin(m), rotation: eulerFromRows(rows), scale };
}

// The whole turns of 2 * PI that bring an angle closest to a reference, so that keys written from
// the result interpolate the short way.
function nearestEquivalentAngle(angle: number, reference: number): number {
  return angle + Math.round((reference - angle) / (Math.PI * 2)) * Math.PI * 2;
}

// Euler angles for the given rotation applied after the existing one, about a global unit axis.
export function rotateEuler(euler: Vec3, axis: Vec3, angle: number): Vec3 {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const t = 1 - cos;
  const q = [
    t * axis.x * axis.x + cos, t * axis.x * axis.y - sin * axis.z, t * axis.x * axis.z + sin * axis.y,
    t * axis.x * axis.y + sin * axis.z, t * axis.y * axis.y + cos, t * axis.y * axis.z - sin * axis.x,
    t * axis.x * axis.z - sin * axis.y, t * axis.y * axis.z + sin * axis.x, t * axis.z * axis.z + cos,
  ];
  const o = rotationRows(euler);
  const r: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      r.push(q[row * 3] * o[column] + q[row * 3 + 1] * o[3 + column] + q[row * 3 + 2] * o[6 + column]);
    }
  }

  const { x, y, z } = eulerFromRows(r);
  return {
    x: nearestEquivalentAngle(x, euler.x),
    y: nearestEquivalentAngle(y, euler.y),
    z: nearestEquivalentAngle(z, euler.z),
  };
}

// The same turn, with its sign chosen so that blending from the reference goes the short way.
export function nearestQuaternion(rotation: Rotation, reference: Rotation): Rotation {
  const dot = (rotation.w ?? 1) * (reference.w ?? 1) + rotation.x * reference.x + rotation.y * reference.y + rotation.z * reference.z;
  return dot >= 0 ? rotation : { w: -(rotation.w ?? 1), x: -rotation.x, y: -rotation.y, z: -rotation.z };
}

function quaternionFromRows(r: number[]): Rotation {
  const trace = r[0] + r[4] + r[8];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return { w: s / 4, x: (r[7] - r[5]) / s, y: (r[2] - r[6]) / s, z: (r[3] - r[1]) / s };
  }
  if (r[0] > r[4] && r[0] > r[8]) {
    const s = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2;
    return { w: (r[7] - r[5]) / s, x: s / 4, y: (r[1] + r[3]) / s, z: (r[2] + r[6]) / s };
  }
  if (r[4] > r[8]) {
    const s = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2;
    return { w: (r[2] - r[6]) / s, x: (r[1] + r[3]) / s, y: s / 4, z: (r[5] + r[7]) / s };
  }
  const s = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2;
  return { w: (r[3] - r[1]) / s, x: (r[2] + r[6]) / s, y: (r[5] + r[7]) / s, z: s / 4 };
}

// A rotation as a quaternion or as Euler angles, staying near a reference of the same kind if given,
// so that keys written from the result blend the short way.
export function rotationAs(rotation: Rotation, quaternion: boolean, reference?: Rotation): Rotation {
  if ((rotation.w !== undefined) === quaternion) {
    return rotation;
  }
  const rows = rotationRows(rotation);
  if (quaternion) {
    const result = quaternionFromRows(rows);
    return reference ? nearestQuaternion(result, reference) : result;
  }
  const { x, y, z } = eulerFromRows(rows);
  return reference
    ? { x: nearestEquivalentAngle(x, reference.x), y: nearestEquivalentAngle(y, reference.y), z: nearestEquivalentAngle(z, reference.z) }
    : { x, y, z };
}

// A rotation in the same form as another, for writing a result into something that uses that form.
export function rotationLike(rotation: Rotation, like: Rotation): Rotation {
  return rotationAs(rotation, like.w !== undefined, like);
}

// The given rotation applied after the existing one, about a global unit axis, in the same form.
export function rotateRotation(rotation: Rotation, axis: Vec3, angle: number): Rotation {
  if (rotation.w === undefined) {
    return rotateEuler(rotation, axis, angle);
  }
  const length = Math.hypot(rotation.w, rotation.x, rotation.y, rotation.z) || 1;
  const [w, x, y, z] = [rotation.w / length, rotation.x / length, rotation.y / length, rotation.z / length];
  const [c, s] = [Math.cos(angle / 2), Math.sin(angle / 2)];
  const [a, b, d] = [axis.x * s, axis.y * s, axis.z * s];
  return nearestQuaternion({
    w: c * w - a * x - b * y - d * z,
    x: c * x + a * w + b * z - d * y,
    y: c * y - a * z + b * w + d * x,
    z: c * z + a * y - b * x + d * w,
  }, rotation);
}

// One number for how much a matrix enlarges things, used for stroke widths.
export function averageScale(m: Matrix): number {
  return (Math.hypot(m[0], m[4], m[8]) + Math.hypot(m[1], m[5], m[9]) + Math.hypot(m[2], m[6], m[10])) / 3;
}
