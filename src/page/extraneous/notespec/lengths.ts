// Note lengths and time snapping.
import { attributesAt, Score, sectionStart, ticksPerBar, ticksPerBeat, Track, trackSectionAt, WHOLE } from './score';

// Whole note to 1/32, as fractions of a whole note's denominator.
export const DIVISIONS = [1, 2, 4, 8, 16, 32];
export type LengthMode = 'normal' | 'dotted' | 'triplet';

export function lengthTicks(division: number, mode: LengthMode): number {
  const plain = WHOLE / division;
  return mode === 'dotted' ? plain * 1.5 : mode === 'triplet' ? (plain * 2) / 3 : plain;
}

export function lengthLabel(division: number, mode: LengthMode): string {
  const base = division === 1 ? '1' : `1/${division}`;
  return mode === 'dotted' ? `${base}.` : mode === 'triplet' ? `${base}T` : base;
}

// Time snap: a grid of some length, or none.
export type Snap = { division: number; triplet: boolean } | null;

export const snapTicks = (snap: NonNullable<Snap>) => lengthTicks(snap.division, snap.triplet ? 'triplet' : 'normal');

// Where the grid starts at a point: the start of the track section there, else of the global section.
function gridOrigin(score: Score, track: Track | undefined, tick: number): number {
  const section = track && trackSectionAt(score, track, tick);
  if (section) {
    return sectionStart(score, section);
  }
  const global = score.globals.find(other => tick >= other.start && tick < other.start + other.length);
  return global?.start ?? 0;
}

// A time on the grid: the nearest line, or with 'floor' the line at or before it (where a click in
// a grid cell places a note).
export function snapTime(score: Score, track: Track | undefined, tick: number, snap: Snap, rounding: 'round' | 'floor' = 'round'): number {
  if (!snap) {
    return Math.round(tick);
  }
  const grid = snapTicks(snap);
  const origin = gridOrigin(score, track, tick);
  return origin + Math[rounding]((tick - origin) / grid) * grid;
}

// An offset rounded to the grid, for moves: notes keep where they sit relative to the grid.
export function snapOffset(ticks: number, snap: Snap): number {
  return snap ? Math.round(ticks / snapTicks(snap)) * snapTicks(snap) : Math.round(ticks);
}

// The ticks in one beat at a point: the time signature's lower number (an eighth in 6/8).
export function beatTicks(score: Score, track: Track | undefined, tick: number): number {
  return WHOLE / attributesAt(score, track, tick).time.unit;
}

// The section a point lies in, for counting beats and bars: the track's section there, else the
// global section there. Its start, end and time signature.
function sectionSpan(score: Score, track: Track | undefined, tick: number): { start: number; end: number; unit: (beat: boolean) => number } | null {
  const section = track && trackSectionAt(score, track, tick);
  const global = score.globals.find(other => tick >= other.start && tick < other.start + other.length);
  const start = section ? sectionStart(score, section) : global?.start;
  const length = section ? section.length : global?.length;
  if (start === undefined || length === undefined) {
    return null;
  }
  const { time } = attributesAt(score, track, tick);
  return { start, end: start + length, unit: beat => (beat ? ticksPerBeat(time) : ticksPerBar(time)) };
}

export type CursorStep = 'beat' | 'bar' | 'section';

// Where the cursor goes with Left (-1) or Right (+1): the next beat or bar line in that direction,
// counted from the start of the section it's in (a section's end counts as a line), or the next
// section boundary (global sections and the track's own). Outside every section, beats and bars
// count from tick 0 in the first section's time signature.
export function stepCursor(score: Score, track: Track | undefined, tick: number, step: CursorStep, direction: 1 | -1): number {
  if (step === 'section') {
    const bounds = new Set<number>([0]);
    for (const global of score.globals) {
      bounds.add(global.start).add(global.start + global.length);
    }
    for (const section of track?.sections ?? []) {
      const start = sectionStart(score, section);
      bounds.add(start).add(start + section.length);
    }
    const sorted = [...bounds].sort((a, b) => a - b);
    const found = direction > 0 ? sorted.find(bound => bound > tick) : [...sorted].reverse().find(bound => bound < tick);
    return found ?? tick;
  }
  // Going left, the line wanted lies before the cursor, so count in the section just before it.
  const at = direction > 0 ? tick : tick - 1;
  const span = sectionSpan(score, track, at);
  const first = score.globals[0];
  const unit = span ? span.unit(step === 'beat') : first ? (step === 'beat' ? ticksPerBeat(first.time) : ticksPerBar(first.time)) : WHOLE / 4;
  const origin = span?.start ?? 0;
  if (direction > 0) {
    const next = origin + (Math.floor((tick - origin) / unit) + 1) * unit;
    return span ? Math.min(next, span.end) : next;
  }
  const previous = origin + Math.floor((tick - 1 - origin) / unit) * unit;
  return Math.max(0, span ? Math.max(previous, span.start) : previous);
}

// The standard length nearest a duration and one step longer or shorter, for Alt+scroll on placed notes.
export function stepLength(duration: number, steps: number, mode: LengthMode): number {
  const lengths = DIVISIONS.map(division => lengthTicks(division, mode)).sort((a, b) => a - b);
  let nearest = 0;
  for (let i = 1; i < lengths.length; i++) {
    if (Math.abs(lengths[i] - duration) < Math.abs(lengths[nearest] - duration)) {
      nearest = i;
    }
  }
  const exact = lengths[nearest] === duration;
  const index = exact ? nearest + steps : nearest + (steps > 0 ? (lengths[nearest] > duration ? 0 : 1) : (lengths[nearest] < duration ? 0 : -1));
  return lengths[Math.max(0, Math.min(lengths.length - 1, index))];
}
