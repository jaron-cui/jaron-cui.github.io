// Where things are on the canvas: time across, staff steps down each track's lane.
import { Rect } from './canvas/interaction';
import { Key, signatureAlterations, spell, staffRange, stepPitch } from './music';
import { Located, Score, sectionAttributes, Track, TrackRow } from './score';

export const RULER_HEIGHT = 22;
export const GLOBAL_LINE_HEIGHT = 16;
export const SCORE_TOP = RULER_HEIGHT + GLOBAL_LINE_HEIGHT;
export const HEADER_WIDTH = 132;
// Pixels per staff step (line to space): staff lines are two steps apart.
export const STEP = 6;
export const SECTION_LINE_HEIGHT = 12;
export const LANE_PADDING = 6;
export const LANE_GAP = 8;

export type View = {
  // The tick at the left edge of the score area, its pixels per tick, and how far the lanes are
  // scrolled down.
  start: number;
  scale: number;
  scrollY: number;
};

export const DEFAULT_VIEW: View = { start: 0, scale: 40 / 960, scrollY: 0 };

export const tickX = (view: View, tick: number) => HEADER_WIDTH + (tick - view.start) * view.scale;
export const xTick = (view: View, x: number) => view.start + (x - HEADER_WIDTH) / view.scale;

export type Lane = {
  row: TrackRow;
  track: Track;
  top: number;
  height: number;
  // The highest and lowest staff steps the lane shows.
  high: number;
  low: number;
};

// The staff steps a track's lane covers: every clef's staff among its sections, plus its margins.
export function laneSteps(score: Score, track: Track): { high: number; low: number } {
  const clefs = new Set(track.sections.map(section => sectionAttributes(score, section).clef));
  if (clefs.size === 0) {
    clefs.add(score.globals[0]?.clef ?? 'treble');
  }
  const ranges = [...clefs].map(staffRange);
  const high = Math.max(...ranges.map(range => range.high));
  const low = Math.min(...ranges.map(range => range.low));
  const C: Key = { tonic: 0, scale: 'major' };
  return {
    high: spell(stepPitch(high) + track.margins.above, C, 'sharp').step,
    low: spell(stepPitch(low) - track.margins.below, C, 'flat').step,
  };
}

// The lanes of the shown (not hidden) tracks, stacked under the ruler and global section line.
export function layoutLanes(score: Score, rows: TrackRow[], view: View): Lane[] {
  let top = SCORE_TOP + LANE_GAP / 2 - view.scrollY;
  const lanes: Lane[] = [];
  for (const row of rows) {
    if (row.hidden) {
      continue;
    }
    const { high, low } = laneSteps(score, row.track);
    const height = SECTION_LINE_HEIGHT + 2 * LANE_PADDING + (high - low) * STEP;
    lanes.push({ row, track: row.track, top, height, high, low });
    top += height + LANE_GAP;
  }
  return lanes;
}

export const lanesHeight = (lanes: Lane[], view: View) => (lanes.length === 0 ? 0 : lanes[lanes.length - 1].top + lanes[lanes.length - 1].height + view.scrollY - SCORE_TOP);

export const stepY = (lane: Lane, step: number) => lane.top + SECTION_LINE_HEIGHT + LANE_PADDING + (lane.high - step) * STEP;
export const yStep = (lane: Lane, y: number) => lane.high - (y - lane.top - SECTION_LINE_HEIGHT - LANE_PADDING) / STEP;

export const laneAt = (lanes: Lane[], y: number) => lanes.find(lane => y >= lane.top && y < lane.top + lane.height);

export type PitchLock = 'key' | 'chromatic' | 'none';

// The pitch a click on a staff step places: under the key lock, the scale tone on that step (its
// letter as the key signature alters it); otherwise the natural.
export function placementPitch(step: number, key: Key, lock: PitchLock): number {
  const natural = stepPitch(step);
  if (lock !== 'key') {
    return natural;
  }
  return natural + signatureAlterations(key)[((step % 7) + 7) % 7];
}

// A note's box: from its start to its end, one space tall around its staff step.
export function noteRect(score: Score, lane: Lane, view: View, { section, note, start }: Located): Rect {
  const { key } = sectionAttributes(score, section);
  const y = stepY(lane, spell(note.pitch, key, note.spelling).step);
  const x = tickX(view, start);
  return { x, y: y - STEP + 1, width: Math.max(3, note.duration * view.scale - 1), height: 2 * STEP - 2 };
}
