import {
  AnimatedVertex, changeHandle, commitEdit, deleteKeys, dropHeldEdits, remapKeys, rotateOffset, scaledTimes, shiftedTimes, isKeyed, keyEase, keyTimes, poseAt, retimeKeys, setKeyEase, snapTime, writeKeys,
} from './keyframes';
import { Vec3 } from '../../../lib/vrender/model';

const A: Vec3 = { x: 0, y: 0, z: 0 };
const B: Vec3 = { x: 10, y: 20, z: 30 };

function keyedAB(): AnimatedVertex[] {
  const first = writeKeys([A], [0], [A], 0);
  return writeKeys(first, [0], [B], 2);
}

describe('writing keys', () => {
  it('leaves unkeyed vertices constant and interpolates keyed ones', () => {
    const vertices = writeKeys([A, B], [0], [A, B], 0);
    expect(isKeyed(vertices[0])).toBe(true);
    expect(vertices[1]).toBe(B);
    const done = writeKeys(vertices, [0], [B, B], 2);
    expect(poseAt(done, 1)[0].x).toBeCloseTo(5);
    expect(poseAt(done, 1)[0].y).toBeCloseTo(10);
    expect(poseAt(done, 1)[0].z).toBeCloseTo(15);
    expect(poseAt(done, 1)[1]).toEqual(B);
  });

  it('holds a single key at all times', () => {
    const [vertex] = writeKeys([A], [0], [B], 1);
    expect(poseAt([vertex], 0)[0]).toEqual(B);
    expect(poseAt([vertex], 5)[0]).toEqual(B);
  });

  it('replaces a key at the same time and keeps its easing', () => {
    const eased = setKeyEase(keyedAB(), [0], 0, 'hold');
    const replaced = writeKeys(eased, [0], [B], 0);
    expect(keyTimes(replaced)).toEqual([0, 2]);
    expect(poseAt(replaced, 0)[0]).toEqual(B);
    expect(keyEase(replaced, [0], 0)).toBe('hold');
  });
});

describe('committing edits', () => {
  it('changes a constant vertex without creating a key', () => {
    const vertices = commitEdit([A], new Set([0]), [B], 1);
    expect(vertices[0]).toEqual(B);
    expect(keyTimes(vertices)).toEqual([]);
  });

  it('auto-keys an animated vertex at the current time', () => {
    const edited = commitEdit(keyedAB(), new Set([0]), [{ x: 99, y: 99, z: 99 }], 1);
    expect(keyTimes(edited)).toEqual(keyTimes(keyedAB()));
    expect(poseAt(edited, 1)[0].x).toBe(99);
    expect(poseAt(edited, 0)[0]).toEqual(poseAt(keyedAB(), 0)[0]);
    expect(poseAt(dropHeldEdits(edited), 1)[0]).toEqual(poseAt(keyedAB(), 1)[0]);
  });

  it('ignores unselected vertices', () => {
    const edited = commitEdit([A, B], new Set([1]), [B, A], 0);
    expect(edited[0]).toBe(A);
    expect(edited[1]).toEqual(A);
  });
});

describe('managing keys', () => {
  it('lists each time once, optionally for a subset', () => {
    const one = writeKeys([A, A], [0], [A, A], 1);
    const two = writeKeys(one, [0, 1], [A, A], 2);
    expect(keyTimes(two)).toEqual([1, 2]);
    expect(keyTimes(two, [1])).toEqual([2]);
    expect(keyTimes(two, [])).toEqual([]);
  });

  it('deleting the last key leaves the vertex constant at that value', () => {
    const single = writeKeys([A], [0], [B], 1);
    const [vertex] = deleteKeys(single, [0], 1);
    expect(vertex).toEqual(B);
    expect(isKeyed(vertex)).toBe(false);
  });

  it('deletes only the chosen time and leaves vertices without it alone', () => {
    const vertices = deleteKeys(keyedAB(), [0], 0);
    expect(keyTimes(vertices)).toEqual([2]);
    const untouched = keyedAB();
    expect(deleteKeys(untouched, [0], 7)[0]).toBe(untouched[0]);
  });

  it('retimes all coordinates and keeps values', () => {
    const moved = retimeKeys(keyedAB(), [0], 2, 4);
    expect(keyTimes(moved)).toEqual([0, 4]);
    expect(poseAt(moved, 4)[0]).toEqual(B);
    expect(poseAt(moved, 2)[0].x).toBeCloseTo(5);
  });

  it('replaces a key it lands on', () => {
    const moved = retimeKeys(keyedAB(), [0], 2, 0);
    expect(keyTimes(moved)).toEqual([0]);
    expect(poseAt(moved, 0)[0]).toEqual(B);
  });

  it('applies easing changes', () => {
    const held = setKeyEase(keyedAB(), [0], 0, 'hold');
    expect(poseAt(held, 1.9)[0]).toEqual(A);
    expect(keyEase(held, [0], 0)).toBe('hold');
  });

  it('snaps to the grid', () => {
    expect(snapTime(0.51)).toBeCloseTo(0.5);
    expect(snapTime(1 / 24 + 0.001)).toBeCloseTo(1 / 24);
  });
});

describe('held edits', () => {
  it('are keyed by I at the value shown', () => {
    const edited = commitEdit(keyedAB(), new Set([0]), [{ x: 99, y: 99, z: 99 }], 1);
    const keyed = writeKeys(edited, [0], poseAt(edited, 1), 1);
    expect(keyTimes(keyed)).toContain(1);
    expect(poseAt(dropHeldEdits(keyed), 1)[0].x).toBe(99);
  });

  it('leave vertices without any untouched', () => {
    const vertices = keyedAB();
    expect(dropHeldEdits(vertices)).toBe(vertices);
  });
});

describe('moving keys together', () => {
  it('lets one key take the place another just left', () => {
    const moved = remapKeys(keyedAB(), [0], keyTimes(keyedAB()).map(time => ({ from: time, to: time + 1 })));
    expect(keyTimes(moved)).toEqual(keyTimes(keyedAB()).map(time => time + 1));
  });

  it('scales times about a pivot onto whole frames, never below zero', () => {
    expect(scaledTimes([1, 2], 2, 1, 24)).toEqual([1, 3]);
    expect(scaledTimes([0], 3, 1, 24)).toEqual([0]);
  });

  it('stops shifting when the earliest reaches zero', () => {
    expect(shiftedTimes([0.5, 1], -24, 24)).toEqual([0, 0.5]);
  });
});

describe('handles', () => {
  const bezier = (): AnimatedVertex => writeKeys(writeKeys([A], [0], [A], 0), [0], [B], 1)[0];

  it('stay on their own side of their key', () => {
    const changed = changeHandle(bezier(), 'x', 0, 'out', () => [-5, 7]);
    const key = (changed.x as { keys: { ease: { out: number[] } }[] }).keys[0];
    expect(key.ease.out).toEqual([0, 7]);
  });

  it('turn as they appear on screen', () => {
    const [dt, dv] = rotateOffset([1, 0], Math.PI / 2, 10, 100);
    expect(dt).toBeCloseTo(0);
    expect(dv).toBeCloseTo(0.1);
  });
});

describe('keys per property', () => {
  it('deletes one coordinate of a key and leaves the rest', () => {
    const [vertex] = deleteKeys(keyedAB(), [0], 0, ['x']);
    expect(keyTimes([{ ...vertex, x: 0, z: 0 }])).toEqual(keyTimes([{ ...keyedAB()[0], x: 0, z: 0 }]));
    expect((vertex.x as { keys: unknown[] }).keys.length).toBe((keyedAB()[0].x as { keys: unknown[] }).keys.length - 1);
  });

  it('leaves a coordinate constant after its last key, still keyed by the others', () => {
    const one = writeKeys([A], [0], [B], 1);
    const [vertex] = deleteKeys(one, [0], 1, ['x']);
    expect(vertex.x).toBe(B.x);
    expect(isKeyed(vertex)).toBe(true);
    expect(poseAt([vertex], 5)[0]).toEqual(B);
  });

  it('keys only the coordinates asked for', () => {
    const [vertex] = writeKeys([A], [0], [B], 1, () => ['z']);
    expect(vertex.x).toBe(A.x);
    expect(typeof vertex.z).not.toBe('number');
    expect(keyTimes([vertex])).toEqual([1]);
  });

  it('lets an edit change a constant coordinate beside a keyed one', () => {
    const keyed = writeKeys([A], [0], [A], 1, () => ['z']);
    const [vertex] = commitEdit(keyed, new Set([0]), [B], 1);
    expect(vertex.x).toBe(B.x);
    expect(typeof vertex.z).not.toBe('number');
  });
});
