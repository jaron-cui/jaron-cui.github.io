import { worldMatrices } from '../../slender/document';
import { Matrix, multiply } from '../../../../lib/vrender/matrix';
import type { Geoms } from './protocol';
import { buildRig, poseMatrix, poseRig } from './slenderRenderer';

// A small deterministic generator, so failures repeat.
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function rotationRows(next: () => number): number[] {
  const q = [next() - 0.5, next() - 0.5, next() - 0.5, next() - 0.5];
  const n = Math.hypot(...q);
  const [w, x, y, z] = q.map(v => v / n);
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

// Random body poses in metres, flattened as MuJoCo's xpos and xmat are.
function bodyFrame(next: () => number, nbody: number) {
  const xpos = new Float32Array(3 * nbody);
  const xmat = new Float32Array(9 * nbody);
  for (let b = 1; b < nbody; b++) {
    xpos.set([next() * 0.2 - 0.1, next() * 0.2 - 0.1, next() * 0.1], 3 * b);
    xmat.set(rotationRows(next), 9 * b);
  }
  return { xpos, xmat };
}

describe('the Slender rat rig', () => {
  it('puts every geom where the physics does, in a new pose', () => {
    const next = random(7);
    // World, a root with two branches, one of them three deep.
    const body_parentid = [0, 0, 1, 2, 1, 4];
    const nbody = body_parentid.length;
    const geom_bodyid = [1, 2, 2, 3, 4, 5];
    // Each geom's fixed pose on its body (metres).
    const geomLocal = geom_bodyid.map(() => poseMatrix([next() * 0.02, next() * 0.02, next() * 0.02], 0, rotationRows(next), 0));
    const geoms: Geoms = {
      type: geom_bodyid.map(() => 3),
      size: geom_bodyid.flatMap(() => [0.01, 0.02, 0]),
      rgba: geom_bodyid.flatMap(() => [0.8, 0.5, 0.5, 1]),
      group: geom_bodyid.map(() => 1),
      geom_bodyid,
      body_parentid,
      body_names: body_parentid.map((_, b) => `body${b}`),
    };
    const geomWorld = (frame: { xpos: Float32Array; xmat: Float32Array }) => geom_bodyid.map((b, g) => {
      const local = geomLocal[g];
      // poseMatrix scales positions to mm; scale the local offset to match.
      return multiply(poseMatrix(frame.xpos, 3 * b, frame.xmat, 9 * b), [...local.slice(0, 3), local[3] * 1000, ...local.slice(4, 7), local[7] * 1000, ...local.slice(8, 11), local[11] * 1000]);
    });
    const flatten = (matrices: Matrix[]) => {
      const xpos = new Float32Array(3 * matrices.length);
      const xmat = new Float32Array(9 * matrices.length);
      matrices.forEach((m, g) => {
        xpos.set([m[3] / 1000, m[7] / 1000, m[11] / 1000], 3 * g);
        xmat.set([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]], 9 * g);
      });
      return { xpos, xmat };
    };

    const first = bodyFrame(next, nbody);
    const firstGeoms = flatten(geomWorld(first));
    const rig = buildRig(geoms, first.xpos, first.xmat, firstGeoms.xpos, firstGeoms.xmat);

    for (const frame of [first, bodyFrame(next, nbody), bodyFrame(next, nbody)]) {
      const document = poseRig(rig, b => poseMatrix(frame.xpos, 3 * b, frame.xmat, 9 * b));
      const matrices = worldMatrices(document, 0);
      const expected = geomWorld(frame);
      geom_bodyid.forEach((_, g) => {
        const object = document.objects.find(o => o.name === `geom ${g}`)!;
        const actual = matrices.get(object.id)!;
        actual.forEach((value, k) => {
          // Rotation entries to 1e-4; positions (mm) to 0.01 mm. Float32 input limits both.
          expect(Math.abs(value - expected[g][k])).toBeLessThan(k % 4 === 3 ? 0.01 : 1e-4);
        });
      });
    }
  });
});
