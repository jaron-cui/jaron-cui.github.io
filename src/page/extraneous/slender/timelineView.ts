// The stretch of frames the animation pane shows. It can run past either end of the animation, so a
// key near an edge can still be brought to the middle.
export type TimeView = { start: number; end: number };

const MIN_SPAN = 4;
const MAX_SPAN = 100000;
const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const MIN_TICK_PIXELS = 45;

// Zooms by a factor, keeping the time at a position across the view, from 0 to 1, where it is.
export function zoomView({ start, end }: TimeView, position: number, factor: number): TimeView {
  const span = end - start;
  const next = Math.max(MIN_SPAN, Math.min(MAX_SPAN, span * factor));
  const anchor = start + span * position;
  return { start: anchor - next * position, end: anchor + next * (1 - position) };
}

export function panView({ start, end }: TimeView, frames: number): TimeView {
  return { start: start + frames, end: end + frames };
}

const MIN_SCALE_REACH = 40;

// How much a stretch about a pivot has grown, from how far the pointer has moved from it, all in
// pixels. Starting close to the pivot, the reach is kept from being so small that it jumps.
export function timeScaleFactor(start: number, pointer: number, pivot: number): number {
  const from = Math.abs(start - pivot);
  return Math.max(0.001, 1 + (Math.abs(pointer - pivot) - from) / Math.max(from, MIN_SCALE_REACH));
}

// The frames to mark in a view of a given width in pixels.
export function rulerTicks({ start, end }: TimeView, width: number): number[] {
  const span = end - start;
  const step = RULER_STEPS.find(candidate => candidate * width / span >= MIN_TICK_PIXELS) ?? RULER_STEPS[RULER_STEPS.length - 1];
  const ticks: number[] = [];
  for (let i = Math.ceil(start / step); i * step <= end; i++) {
    ticks.push(i * step);
  }
  return ticks;
}
