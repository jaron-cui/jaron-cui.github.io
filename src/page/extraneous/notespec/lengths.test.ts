import { lengthTicks, snapOffset, snapTime, stepCursor, stepLength } from './lengths';
import { splitGlobal, setGlobal } from './editing';
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

  it('steps the cursor by beats, bars and section boundaries', () => {
    const Q = WHOLE / 4;
    // 4/4 for two bars, then 6/8.
    let score = splitGlobal(newScore(), 8 * Q).score;
    score = setGlobal(score, score.globals[1].id, { time: { beats: 6, unit: 8 } });
    // Off the beat, Right and Left go to the nearest beat line that way.
    expect(stepCursor(score, undefined, Q + 100, 'beat', 1)).toBe(2 * Q);
    expect(stepCursor(score, undefined, Q + 100, 'beat', -1)).toBe(Q);
    expect(stepCursor(score, undefined, 2 * Q, 'beat', 1)).toBe(3 * Q);
    expect(stepCursor(score, undefined, 0, 'beat', -1)).toBe(0);
    // In 6/8 a beat is an eighth, counted from the section's start.
    expect(stepCursor(score, undefined, 8 * Q, 'beat', 1)).toBe(8 * Q + Q / 2);
    expect(stepCursor(score, undefined, 8 * Q, 'beat', -1)).toBe(7 * Q);
    // Bars: 4/4 bars, then the section's end is a line, then 6/8 bars.
    expect(stepCursor(score, undefined, Q, 'bar', 1)).toBe(4 * Q);
    expect(stepCursor(score, undefined, 5 * Q, 'bar', 1)).toBe(8 * Q);
    expect(stepCursor(score, undefined, 8 * Q, 'bar', 1)).toBe(8 * Q + 3 * Q);
    expect(stepCursor(score, undefined, 8 * Q + Q, 'bar', -1)).toBe(8 * Q);
    // Sections.
    expect(stepCursor(score, undefined, Q, 'section', 1)).toBe(8 * Q);
    expect(stepCursor(score, undefined, 9 * Q, 'section', -1)).toBe(8 * Q);
    expect(stepCursor(score, undefined, 8 * Q, 'section', -1)).toBe(0);
  });

  it('steps through standard lengths', () => {
    expect(stepLength(WHOLE / 4, 1, 'normal')).toBe(WHOLE / 2);
    expect(stepLength(WHOLE / 4, -1, 'normal')).toBe(WHOLE / 8);
    expect(stepLength(WHOLE, 1, 'normal')).toBe(WHOLE);
    expect(stepLength(700, 1, 'normal')).toBe(WHOLE / 4);
  });
});
