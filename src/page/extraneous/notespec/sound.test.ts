import { placeNote, setGlobal, setTrack, splitGlobal, tieNotes } from './editing';
import { newScore, Score, WHOLE } from './score';
import { ATTACK, RELEASE, renderScore, sineTie, tempoMap, trackTies } from './sound';

const Q = WHOLE / 4;
const RATE = 8000;
const trackId = (score: Score) => Object.keys(score.tracks)[0];

function zeroCrossings(samples: Float32Array, from: number, to: number) {
  let count = 0;
  for (let i = from + 1; i < to; i++) {
    if ((samples[i - 1] < 0) !== (samples[i] < 0)) {
      count++;
    }
  }
  return count;
}

describe('tempo', () => {
  it('converts ticks to seconds through tempo changes and back', () => {
    let score = splitGlobal(newScore(), 4 * Q).score;
    score = setGlobal(score, score.globals[1].id, { tempo: 60 });
    const time = tempoMap(score);
    // Four quarters at 120, then quarters at 60.
    expect(time.seconds(4 * Q)).toBeCloseTo(2);
    expect(time.seconds(6 * Q)).toBeCloseTo(4);
    expect(time.tick(4)).toBeCloseTo(6 * Q);
  });
});

describe('ties', () => {
  it('chains tied notes into one voice', () => {
    const a = placeNote(newScore(), trackId(newScore()), 0, 60, Q);
    const b = placeNote(a.score, trackId(a.score), Q, 64, Q);
    const c = placeNote(b.score, trackId(b.score), 3 * Q, 67, Q);
    const score = tieNotes(c.score, [a.id, b.id]);
    const ties = trackTies(score, score.tracks[trackId(score)], tempoMap(score));
    expect(ties.map(tie => tie.map(note => note.pitch))).toEqual([[60, 64], [67]]);
  });

  it('fades in, holds its pitch per note and releases after the end', () => {
    const { start, samples } = sineTie([{ start: 1, end: 1.5, pitch: 69 }, { start: 1.5, end: 2, pitch: 81 }], RATE);
    expect(start).toBe(1);
    expect(samples.length).toBe(Math.ceil((1 + RELEASE) * RATE));
    expect(Math.abs(samples[1])).toBeLessThan(0.05);
    // 440 Hz for half a second, then 880 Hz: about 440 and 880 zero crossings.
    expect(zeroCrossings(samples, 0, RATE / 2)).toBeGreaterThan(430);
    expect(zeroCrossings(samples, 0, RATE / 2)).toBeLessThan(450);
    expect(zeroCrossings(samples, RATE / 2, RATE)).toBeGreaterThan(870);
    expect(samples[samples.length - 1]).toBeCloseTo(0, 2);
    expect(ATTACK).toBeLessThan(0.02);
  });
});

describe('mix', () => {
  it('renders from a tick, and leaves muted tracks out', () => {
    const placed = placeNote(newScore(), trackId(newScore()), 4 * Q, 69, Q);
    const sound = renderScore(placed.score, RATE, 0);
    // The note is at 2 s and lasts 0.5 s.
    expect(sound.length).toBe(Math.ceil((2.5 + RELEASE) * RATE));
    expect(Math.max(...sound.slice(0, RATE))).toBe(0);
    const fromNote = renderScore(placed.score, RATE, 4 * Q);
    expect(fromNote.length).toBe(Math.ceil((0.5 + RELEASE) * RATE));
    const muted = setTrack(placed.score, trackId(placed.score), { muted: true });
    expect(renderScore(muted, RATE, 0).length).toBe(0);
  });
});
