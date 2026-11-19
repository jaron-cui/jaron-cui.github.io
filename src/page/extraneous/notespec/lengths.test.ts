import { lengthTicks, snapOffset, snapTime, stepLength } from './lengths';
import { newScore, WHOLE } from './score';

describe('lengths', () => {
  it('has whole-number ticks for every length', () => {
    for (const division of [1, 2, 4, 8, 16, 32]) {
      for (const mode of ['normal', 'dotted', 'triplet'] as const) {
        expect(Number.isInteger(lengthTicks(division, mode))).toBe(true);
      }
    }
  });

  it('snaps times to the grid from the section start, and offsets to grid multiples', () => {
    const score = newScore();
    expect(snapTime(score, undefined, 1000, { division: 4, triplet: false })).toBe(960);
    expect(snapTime(score, undefined, 1000, null)).toBe(1000);
    expect(snapOffset(700, { division: 8, triplet: false })).toBe(480);
  });

  it('steps through standard lengths', () => {
    expect(stepLength(WHOLE / 4, 1, 'normal')).toBe(WHOLE / 2);
    expect(stepLength(WHOLE / 4, -1, 'normal')).toBe(WHOLE / 8);
    expect(stepLength(WHOLE, 1, 'normal')).toBe(WHOLE);
    expect(stepLength(700, 1, 'normal')).toBe(WHOLE / 4);
  });
});
