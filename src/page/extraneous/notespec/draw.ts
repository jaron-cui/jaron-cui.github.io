// Draws the score and records its hit regions. Each part (ruler, global section line, lanes, notes,
// headers) is its own function; the actions they hook up come from the editor.
import { Drag, Frame, PointerInput, Rect, WheelInput } from './canvas/interaction';
import { Size } from './canvas/useCanvas';
import {
  GLOBAL_LINE_HEIGHT, HEADER_WIDTH, Lane, noteBox, noteRect, RULER_HEIGHT, SCORE_TOP, SECTION_LINE_HEIGHT, stepY, tickX, View, xTick, yStep,
} from './layout';
import { accidental, Clef, spell, staffLines, tonicName } from './music';
import {
  attributesAt, GlobalSection, overlappingGlobals, overlappingSections, Score, sectionAttributes, sectionStart, strayNotes, ticksPerBar, ticksPerBeat,
  trackNotes, TrackSection,
} from './score';
import { EditorState, sameSection, SectionRef } from './state';

export const COLORS = {
  paper: '#f6f3ec',
  lane: '#fbfaf6',
  activeLane: '#fffdf4',
  header: '#e9e5dc',
  activeHeader: '#dfe7f3',
  text: '#33312c',
  faint: '#8a867c',
  staff: '#a29e94',
  bar: '#77736b',
  beat: '#e4e0d6',
  note: '#3d6fb4',
  noteHover: '#5a8ad0',
  selected: '#e8892b',
  stray: '#d0392b',
  overlap: 'rgba(208, 57, 43, 0.16)',
  line: '#1d1c1a',
  cursor: '#2b7de8',
  playhead: '#2a9d55',
};

export type ScoreActions = {
  pressRuler(input: PointerInput): Drag | void;
  pressHeader(lane: Lane, input: PointerInput): void;
  pressNote(lane: Lane, id: string, input: PointerInput): void;
  // A press on a lane away from its notes, at a time and staff step.
  pressLane(lane: Lane, tick: number, step: number, input: PointerInput): Drag | void;
  pressSection(ref: SectionRef, input: PointerInput): void;
  // A press below the lanes or anywhere else on the score; a drag moves the cursor.
  pressBlank(tick: number, input: PointerInput): Drag | void;
  wheel(input: WheelInput): boolean;
};

// Where a click would place a note, drawn faded while placing notes.
export type Ghost = { track: string; start: number; pitch: number; duration: number };

export type ScoreModel = {
  state: EditorState;
  placing: boolean;
  ghost: Ghost | null;
  view: View;
  lanes: Lane[];
  cursor: number;
  playhead: number | null;
  box: Rect | null;
  actions: ScoreActions;
};

const CLEF_SYMBOLS: Record<Clef, string> = { treble: '𝄞', bass: '𝄢', alto: '𝄡', tenor: '𝄡' };
const FONT = '11px system-ui, sans-serif';

export function drawScore(context: CanvasRenderingContext2D, frame: Frame, size: Size, model: ScoreModel) {
  const { view, actions } = model;
  context.fillStyle = COLORS.paper;
  context.fillRect(0, 0, size.width, size.height);
  frame.region({
    rect: { x: 0, y: 0, width: size.width, height: size.height },
    press: input => actions.pressBlank(xTick(view, input.x), input),
    wheel: input => actions.wheel(input),
  });

  // Lanes scroll under the ruler and the headers, so they're clipped to the score area.
  context.save();
  context.beginPath();
  context.rect(HEADER_WIDTH, SCORE_TOP, size.width - HEADER_WIDTH, size.height - SCORE_TOP);
  context.clip();
  for (const lane of model.lanes) {
    if (lane.top + lane.height >= SCORE_TOP && lane.top <= size.height) {
      drawLane(context, frame, size, model, lane);
    }
  }
  context.restore();

  context.save();
  context.beginPath();
  context.rect(0, SCORE_TOP, HEADER_WIDTH, size.height - SCORE_TOP);
  context.clip();
  for (const lane of model.lanes) {
    drawHeader(context, frame, model, lane);
  }
  context.restore();

  drawRuler(context, frame, size, model);
  drawGlobalLine(context, frame, size, model);
  drawTimeLine(context, size, view, model.cursor, COLORS.cursor);
  if (model.playhead !== null) {
    drawTimeLine(context, size, view, model.playhead, COLORS.playhead);
  }
  if (model.box) {
    context.fillStyle = 'rgba(43, 125, 232, 0.12)';
    context.strokeStyle = COLORS.cursor;
    context.setLineDash([4, 3]);
    context.fillRect(model.box.x, model.box.y, model.box.width, model.box.height);
    context.strokeRect(model.box.x + 0.5, model.box.y + 0.5, model.box.width, model.box.height);
    context.setLineDash([]);
  }
}

function visibleRange(size: Size, view: View): [number, number] {
  return [xTick(view, HEADER_WIDTH), xTick(view, size.width)];
}

// Bar numbers and each global section's tempo, key and time signature. A press places the cursor.
function drawRuler(context: CanvasRenderingContext2D, frame: Frame, size: Size, { state, view, actions }: ScoreModel) {
  context.fillStyle = COLORS.header;
  context.fillRect(0, 0, size.width, RULER_HEIGHT);
  frame.region({ rect: { x: HEADER_WIDTH, y: 0, width: size.width - HEADER_WIDTH, height: RULER_HEIGHT }, cursor: 'text', press: input => actions.pressRuler(input) });
  const [from, to] = visibleRange(size, view);
  context.font = FONT;
  context.textBaseline = 'middle';
  // Bars are numbered through the whole score, in order of the global sections' starts.
  let barsBefore = 0;
  for (const global of [...state.score.globals].sort((a, b) => a.start - b.start)) {
    const bar = ticksPerBar(global.time);
    const bars = Math.ceil(global.length / bar);
    const number = barsBefore;
    barsBefore += bars;
    const first = Math.max(0, Math.floor((from - global.start) / bar));
    const last = Math.min(Math.ceil(global.length / bar), Math.ceil((to - global.start) / bar));
    const barPixels = bar * view.scale;
    const every = barPixels > 28 ? 1 : Math.ceil(28 / barPixels);
    for (let i = first; i <= last; i++) {
      const x = tickX(view, global.start + i * bar);
      if (x < HEADER_WIDTH) {
        continue;
      }
      context.fillStyle = COLORS.faint;
      context.fillRect(Math.round(x), RULER_HEIGHT - 6, 1, 6);
      if ((number + i) % every === 0 && i < bars) {
        context.fillStyle = COLORS.text;
        context.fillText(String(number + i + 1), x + 3, RULER_HEIGHT - 9);
      }
    }
  }
  context.fillStyle = COLORS.text;
  context.fillText('notespec', 10, RULER_HEIGHT / 2);
}

function sectionLabel(clef: Clef, key: { tonic: number; scale: string }, time: { beats: number; unit: number }, tempo?: number) {
  return `${tempo !== undefined ? `♩=${tempo}  ` : ''}${CLEF_SYMBOLS[clef]} ${tonicName(key.tonic)} ${key.scale}  ${time.beats}/${time.unit}`;
}

// The global sections as a thick line under the ruler, a gap with end bars at each split.
function drawGlobalLine(context: CanvasRenderingContext2D, frame: Frame, size: Size, { state, view, actions }: ScoreModel) {
  const y = RULER_HEIGHT + GLOBAL_LINE_HEIGHT / 2;
  context.fillStyle = COLORS.paper;
  context.fillRect(0, RULER_HEIGHT, size.width, GLOBAL_LINE_HEIGHT);
  context.fillStyle = COLORS.faint;
  context.font = FONT;
  context.textBaseline = 'middle';
  context.fillText('Sections', 10, y);
  context.save();
  context.beginPath();
  context.rect(HEADER_WIDTH, RULER_HEIGHT, size.width - HEADER_WIDTH, GLOBAL_LINE_HEIGHT);
  context.clip();
  const overlaps = overlappingGlobals(state.score);
  for (const global of state.score.globals) {
    const ref: SectionRef = { kind: 'global', id: global.id };
    const selected = state.sections.some(other => sameSection(other, ref));
    if (overlaps.has(global.id)) {
      shadeOverlap(context, view, global.start, global.length, RULER_HEIGHT, size.height - RULER_HEIGHT);
    }
    const rect = drawSegment(context, view, global.start, global.length, y, 4, selected ? COLORS.selected : overlaps.has(global.id) ? COLORS.stray : COLORS.line);
    frame.region({ rect: { ...rect, y: RULER_HEIGHT, height: GLOBAL_LINE_HEIGHT }, key: `global:${global.id}`, cursor: 'pointer', press: input => actions.pressSection(ref, input) });
    drawBounds(context, frame, state, actions, ref, rect, RULER_HEIGHT, GLOBAL_LINE_HEIGHT, y);
  }
  context.restore();
  drawGlobalLabels(context, view, state.score.globals);
}

function drawGlobalLabels(context: CanvasRenderingContext2D, view: View, globals: GlobalSection[]) {
  context.fillStyle = COLORS.text;
  context.font = FONT;
  for (const global of globals) {
    const x = tickX(view, global.start);
    if (x >= HEADER_WIDTH - 1) {
      context.fillText(sectionLabel(global.clef, global.key, global.time, global.tempo), x + 22, RULER_HEIGHT - 9);
    }
  }
}

// A section's line segment with end bars, inset so neighbors show a gap. Returns its hit box.
function drawSegment(context: CanvasRenderingContext2D, view: View, start: number, length: number, y: number, thickness: number, color: string): Rect {
  const x0 = tickX(view, start) + 2;
  const x1 = tickX(view, start + length) - 2;
  context.fillStyle = color;
  context.fillRect(x0, y - thickness / 2, Math.max(1, x1 - x0), thickness);
  context.fillRect(x0, y - 5, 1.5, 10);
  context.fillRect(x1 - 1.5, y - 5, 1.5, 10);
  return { x: x0, y: y - 6, width: Math.max(4, x1 - x0), height: 12 };
}

// A section line's bounds, the bars at its ends: each can be selected (and moved with G) on its own.
// A selected bound is drawn as a thick orange bar.
const BOUND_HIT = 4;
function drawBounds(context: CanvasRenderingContext2D, frame: Frame, state: EditorState, actions: ScoreActions, ref: SectionRef, rect: Rect, top: number, height: number, y: number) {
  for (const edge of ['start', 'end'] as const) {
    const bound: SectionRef = { ...ref, edge };
    const x = edge === 'start' ? rect.x : rect.x + rect.width;
    if (state.sections.some(other => sameSection(other, bound))) {
      context.fillStyle = COLORS.selected;
      context.fillRect(x - (edge === 'start' ? 0 : 3), y - 6, 3, 12);
    }
    frame.region({
      // Each bound's hit area lies on its own section's side, so neighbors' bounds don't overlap.
      rect: { x: edge === 'start' ? x - 2 : x - BOUND_HIT - 3, y: top, width: BOUND_HIT + 5, height },
      key: `bound:${ref.id}:${edge}`,
      cursor: 'ew-resize',
      press: input => actions.pressSection(bound, input),
    });
  }
}

function shadeOverlap(context: CanvasRenderingContext2D, view: View, start: number, length: number, top: number, height: number) {
  context.fillStyle = COLORS.overlap;
  context.fillRect(tickX(view, start), top, length * view.scale, height);
}

function drawHeader(context: CanvasRenderingContext2D, frame: Frame, { state, actions }: ScoreModel, lane: Lane) {
  const active = lane.track.id === state.activeTrack;
  context.fillStyle = active ? COLORS.activeHeader : COLORS.header;
  context.fillRect(0, lane.top, HEADER_WIDTH, lane.height);
  context.fillStyle = COLORS.text;
  context.font = active ? `600 ${FONT}` : FONT;
  context.textBaseline = 'top';
  context.fillText(lane.track.name, 8, lane.top + 6, HEADER_WIDTH - 16);
  context.fillStyle = COLORS.faint;
  context.font = FONT;
  const flags = [lane.row.muted && 'muted', lane.row.soloed && 'solo'].filter(Boolean).join(', ');
  if (flags) {
    context.fillText(flags, 8, lane.top + 22);
  }
  frame.region({ rect: { x: 0, y: lane.top, width: HEADER_WIDTH, height: lane.height }, cursor: 'pointer', press: input => actions.pressHeader(lane, input) });
}

function drawLane(context: CanvasRenderingContext2D, frame: Frame, size: Size, model: ScoreModel, lane: Lane) {
  const { state, view, actions } = model;
  const { score } = state;
  const active = lane.track.id === state.activeTrack;
  context.fillStyle = active ? COLORS.activeLane : COLORS.lane;
  context.fillRect(HEADER_WIDTH, lane.top, size.width - HEADER_WIDTH, lane.height);
  frame.region({
    rect: { x: HEADER_WIDTH, y: lane.top, width: size.width - HEADER_WIDTH, height: lane.height },
    // Named so the editor can tell the pointer is over blank lane space, where a note would go.
    key: `lane:${lane.track.id}`,
    cursor: model.placing ? 'crosshair' : undefined,
    press: input => actions.pressLane(lane, xTick(view, input.x), Math.round(yStep(lane, input.y)), input),
  });

  const overlaps = overlappingSections(score, lane.track);
  for (const section of lane.track.sections) {
    drawStaff(context, size, view, score, lane, section, overlaps.has(section.id));
  }
  drawSectionLine(context, frame, model, lane, overlaps);
  drawNotes(context, frame, model, lane);
  if (model.ghost?.track === lane.track.id) {
    drawGhost(context, model, lane, model.ghost);
  }
}

function drawGhost(context: CanvasRenderingContext2D, { state, view }: ScoreModel, lane: Lane, ghost: Ghost) {
  const { key } = attributesAt(state.score, lane.track, ghost.start);
  const rect = noteBox(lane, view, key, ghost.start, ghost.pitch, ghost.duration);
  context.globalAlpha = 0.4;
  context.fillStyle = COLORS.note;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  const symbol = accidental(spell(ghost.pitch, key), key);
  if (symbol) {
    context.fillStyle = COLORS.text;
    context.font = '12px system-ui, sans-serif';
    context.textBaseline = 'middle';
    context.textAlign = 'right';
    context.fillText(symbol, rect.x - 2, rect.y + rect.height / 2);
    context.textAlign = 'left';
  }
  context.globalAlpha = 1;
}

// A track section's staff lines, bar and beat lines, and its clef, key and time signature.
function drawStaff(context: CanvasRenderingContext2D, size: Size, view: View, score: Score, lane: Lane, section: TrackSection, overlapping: boolean) {
  const start = sectionStart(score, section);
  const { clef, time } = sectionAttributes(score, section);
  const x0 = Math.max(HEADER_WIDTH, tickX(view, start));
  const x1 = Math.min(size.width, tickX(view, start + section.length));
  if (x1 <= x0) {
    return;
  }
  const lines = staffLines(clef);
  const top = stepY(lane, lines[4]);
  const bottom = stepY(lane, lines[0]);
  if (overlapping) {
    shadeOverlap(context, view, start, section.length, lane.top, lane.height);
  }
  const beat = ticksPerBeat(time);
  const bar = ticksPerBar(time);
  const [from, to] = visibleRange(size, view);
  if (beat * view.scale >= 6) {
    context.fillStyle = COLORS.beat;
    for (let tick = start + Math.max(0, Math.ceil((from - start) / beat)) * beat; tick < Math.min(start + section.length, to); tick += beat) {
      context.fillRect(Math.round(tickX(view, tick)), top, 1, bottom - top);
    }
  }
  context.fillStyle = COLORS.staff;
  for (const line of lines) {
    context.fillRect(x0, Math.round(stepY(lane, line)), x1 - x0, 1);
  }
  context.fillStyle = COLORS.bar;
  for (let tick = start + Math.max(0, Math.ceil((from - start) / bar)) * bar; tick <= Math.min(start + section.length, to); tick += bar) {
    context.fillRect(Math.round(tickX(view, tick)), top, 1, bottom - top + 1);
  }
  context.fillStyle = COLORS.text;
  context.font = '22px "Segoe UI Symbol", "Noto Music", serif';
  context.textBaseline = 'middle';
  const sx = tickX(view, start);
  if (sx >= HEADER_WIDTH - 4) {
    context.fillText(CLEF_SYMBOLS[clef], sx + 3, (top + bottom) / 2);
  }
}

// The lane's track sections as a line along its top; each section and bound can be selected.
function drawSectionLine(context: CanvasRenderingContext2D, frame: Frame, { state, view, actions }: ScoreModel, lane: Lane, overlaps: Set<string>) {
  const { score } = state;
  const y = lane.top + SECTION_LINE_HEIGHT / 2 + 1;
  context.font = FONT;
  context.textBaseline = 'middle';
  for (const section of lane.track.sections) {
    const ref: SectionRef = { kind: 'track', track: lane.track.id, id: section.id };
    const selected = state.sections.some(other => sameSection(other, ref));
    const start = sectionStart(score, section);
    const stray = overlaps.has(section.id) || isStraySection(score, section);
    const rect = drawSegment(context, view, start, section.length, y, 2, selected ? COLORS.selected : stray ? COLORS.stray : COLORS.bar);
    const { clef, key, time } = sectionAttributes(score, section);
    if (Object.keys(section.overrides).length > 0) {
      context.fillStyle = COLORS.faint;
      context.fillText(sectionLabel(clef, key, time), rect.x + 6, y + 9);
    }
    frame.region({ rect: { ...rect, y: lane.top, height: SECTION_LINE_HEIGHT }, key: `section:${section.id}`, cursor: 'pointer', press: input => actions.pressSection(ref, input) });
    drawBounds(context, frame, state, actions, ref, rect, lane.top, SECTION_LINE_HEIGHT, y);
  }
}

function isStraySection(score: Score, section: TrackSection): boolean {
  const global = score.globals.find(other => other.id === section.global);
  return !global || section.start < 0 || section.start >= global.length;
}

function drawNotes(context: CanvasRenderingContext2D, frame: Frame, { state, view, actions }: ScoreModel, lane: Lane) {
  const { score } = state;
  const selected = new Set(state.notes);
  const stray = strayNotes(lane.track);
  const notes = trackNotes(score, lane.track);
  const rects = new Map(notes.map(item => [item.note.id, noteRect(score, lane, view, item)]));
  // Ties first, under the notes: a short curve from one note's end to the next one's start.
  context.strokeStyle = COLORS.text;
  context.lineWidth = 1.2;
  for (const { note } of notes) {
    const from = rects.get(note.id);
    const to = note.tie ? rects.get(note.tie) : undefined;
    if (from && to) {
      const x0 = from.x + from.width - 4;
      const x1 = to.x + 4;
      const y0 = from.y + from.height + 1;
      const y1 = to.y + to.height + 1;
      context.beginPath();
      context.moveTo(x0, y0);
      context.bezierCurveTo(x0 + 6, Math.max(y0, y1) + 6, x1 - 6, Math.max(y0, y1) + 6, x1, y1);
      context.stroke();
    }
  }
  drawLedgerLines(context, score, lane, notes, rects);
  context.font = '12px system-ui, sans-serif';
  context.textBaseline = 'middle';
  for (const item of notes) {
    const { note, section } = item;
    const rect = rects.get(note.id)!;
    const key = `note:${note.id}`;
    const isSelected = selected.has(note.id);
    context.fillStyle = stray.has(note.id) ? COLORS.stray : isSelected ? COLORS.selected : frame.isHovered(key) ? COLORS.noteHover : COLORS.note;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    const { key: musicKey } = sectionAttributes(score, section);
    const symbol = accidental(spell(note.pitch, musicKey, note.spelling), musicKey, note.spelling);
    if (symbol) {
      context.fillStyle = COLORS.text;
      context.textAlign = 'right';
      context.fillText(symbol, rect.x - 2, rect.y + rect.height / 2);
      context.textAlign = 'left';
    }
    frame.region({ rect, key, cursor: 'pointer', press: input => actions.pressNote(lane, note.id, input) });
  }
}

// Short lines through and toward notes above or below their section's staff.
function drawLedgerLines(context: CanvasRenderingContext2D, score: Score, lane: Lane, notes: ReturnType<typeof trackNotes>, rects: Map<string, Rect>) {
  context.fillStyle = COLORS.staff;
  for (const { note, section } of notes) {
    const { clef, key } = sectionAttributes(score, section);
    const lines = staffLines(clef);
    const step = spell(note.pitch, key, note.spelling).step;
    const rect = rects.get(note.id)!;
    const ledgers: number[] = [];
    for (let line = lines[4] + 2; line <= step; line += 2) {
      ledgers.push(line);
    }
    for (let line = lines[0] - 2; line >= step; line -= 2) {
      ledgers.push(line);
    }
    for (const line of ledgers) {
      context.fillRect(rect.x - 3, Math.round(stepY(lane, line)), rect.width + 6, 1);
    }
  }
}

function drawTimeLine(context: CanvasRenderingContext2D, size: Size, view: View, tick: number, color: string) {
  const x = Math.round(tickX(view, tick));
  if (x < HEADER_WIDTH || x > size.width) {
    return;
  }
  context.fillStyle = color;
  context.fillRect(x, 0, 1.5, size.height);
  context.beginPath();
  context.moveTo(x - 5, 0);
  context.lineTo(x + 6, 0);
  context.lineTo(x + 0.75, 7);
  context.fill();
}
