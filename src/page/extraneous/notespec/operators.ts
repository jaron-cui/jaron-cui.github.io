// Modal operators, Blender style: they start from a key, follow the pointer or a typed number, and
// end with a click or Enter (keep) or a right click or Escape (undo).
import { KeyInput, Modal, Point, PointerInput, Rect } from './canvas/interaction';
import { moveGlobals, moveNotes, moveTrackSections, resizeGlobal, resizeTrackSection } from './editing';
import { beatTicks, Snap, snapOffset } from './lengths';
import { Lane, noteRect, View, yStep } from './layout';
import { pitchAtStep } from './music';
import { globalById, locateNotes, sectionAttributes, sectionStart, trackNotes, ticksPerBeat } from './score';
import { EditorState, SectionRef } from './state';
import { describeTyped, isTypedKey, typedValue, typeKey, TypedInput } from './typedInput';

export type OperatorContext = {
  // The state before the operator, as committed.
  state(): EditorState;
  // Shows a state without committing it; null shows the committed one again.
  preview(state: EditorState | null): void;
  commit(state: EditorState): void;
  // Changes only the selection: replaces the committed state without an undo step.
  select(state: EditorState): void;
  view(): View;
  lanes(): Lane[];
  snap(): Snap;
  // A rectangle to draw over the score (box select), or none.
  overlay(rect: Rect | null): void;
  // Plays notes of a state, as when their pitch changes.
  audition(state: EditorState, ids: string[]): void;
};

const ends = (input: PointerInput) => (input.button === 0 ? 'confirm' : input.button === 2 ? 'cancel' : 'handled');

function typing(typed: TypedInput | null, input: KeyInput): TypedInput | null | undefined {
  return isTypedKey(input.key) ? typeKey(typed, input.key) : undefined;
}

// G: moves the selected notes in time; Z switches to pitch and back. Typed numbers are beats (of the
// earliest selected note's time signature) or semitones; they ignore snapping and the pitch lock.
// `base` is the state to move from and `cancelled` the one to return to, when they differ from the
// committed state (Shift+D moves fresh copies, and cancelling removes them).
export function grabNotes(context: OperatorContext, start: Point, base = context.state(), cancelled: EditorState | null = null): Modal {
  let axis: 'time' | 'pitch' = 'time';
  let typed: TypedInput | null = null;
  let pointer = start;
  let result = base;
  const located = locateNotes(base.score, base.notes).sort((a, b) => a.start - b.start);
  const first = located[0];
  const beat = first ? beatTicks(base.score, first.track, first.start) : ticksPerBeat({ beats: 4, unit: 4 });
  const lane = () => context.lanes().find(other => other.track.id === base.activeTrack);
  let offset = 0;
  let heard = 0;

  const apply = () => {
    const view = context.view();
    if (axis === 'time') {
      offset = typed ? Math.round(typedValue(typed) * beat) : snapOffset((pointer.x - start.x) / view.scale, context.snap());
    } else {
      const shown = lane();
      offset = typed ? Math.round(typedValue(typed)) : shown ? Math.round(pitchAtStep(yStep(shown, pointer.y)) - pitchAtStep(yStep(shown, start.y))) : 0;
    }
    result = { ...base, score: axis === 'time' ? moveNotes(base.score, base.notes, offset, 0) : moveNotes(base.score, base.notes, 0, offset) };
    context.preview(result);
    // Moving in pitch plays each new pitch as it's reached.
    if (axis === 'pitch' && offset !== heard) {
      heard = offset;
      context.audition(result, base.notes);
    }
  };
  apply();

  return {
    get cursor() {
      return axis === 'time' ? 'ew-resize' : 'ns-resize';
    },
    describe: () => {
      const amount = typed ? describeTyped(typed, axis === 'time' ? 'beats' : 'semitones') : axis === 'time' ? `${+(offset / beat).toFixed(3)} beats` : `${offset} semitones`;
      return [`Move ${axis === 'time' ? 'in time' : 'in pitch'}: ${amount}`, `Z: ${axis === 'time' ? 'pitch' : 'time'}`, 'Click or Enter: keep', 'Right click or Esc: cancel'].join('  ·  ');
    },
    move: input => {
      pointer = input;
      apply();
    },
    key: input => {
      if (input.key === 'z' || input.key === 'Z') {
        axis = axis === 'time' ? 'pitch' : 'time';
        heard = 0;
        apply();
        return 'handled';
      }
      const next = typing(typed, input);
      if (next !== undefined) {
        typed = next;
        apply();
        return 'handled';
      }
      return input.key === 'Enter' || input.key === 'Escape' ? undefined : 'handled';
    },
    press: ends,
    finish: confirmed => {
      if (confirmed) {
        context.commit(result);
      } else if (cancelled) {
        context.commit(cancelled);
      } else {
        context.preview(null);
      }
    },
  };
}

// G in object mode: moves the selected section lines' sections in time, and the selected bounds
// (which grows or shrinks their sections). Typed numbers are beats of the earliest selected
// section's time signature.
export function grabSections(context: OperatorContext, start: Point): Modal {
  const base = context.state();
  let typed: TypedInput | null = null;
  let pointer = start;
  let result = base;
  let offset = 0;
  const { score } = base;
  const starts = base.sections.map(ref => {
    if (ref.kind === 'global') {
      const global = globalById(score, ref.id)!;
      return { start: global.start, beat: ticksPerBeat(global.time) };
    }
    const section = score.tracks[ref.track].sections.find(other => other.id === ref.id)!;
    return { start: sectionStart(score, section), beat: ticksPerBeat(sectionAttributes(score, section).time) };
  }).sort((a, b) => a.start - b.start);
  const beat = starts[0]?.beat ?? ticksPerBeat({ beats: 4, unit: 4 });

  const apply = () => {
    offset = typed ? Math.round(typedValue(typed) * beat) : snapOffset((pointer.x - start.x) / context.view().scale, context.snap());
    result = { ...base, score: moveSections(base.score, base.sections, offset) };
    context.preview(result);
  };
  apply();

  return {
    cursor: 'ew-resize',
    describe: () => [`Move ${base.sections.every(ref => ref.edge) ? 'bounds' : 'sections'}: ${typed ? describeTyped(typed, 'beats') : `${+(offset / beat).toFixed(3)} beats`}`, 'Click or Enter: keep', 'Right click or Esc: cancel'].join('  ·  '),
    move: input => {
      pointer = input;
      apply();
    },
    key: input => {
      const next = typing(typed, input);
      if (next !== undefined) {
        typed = next;
        apply();
        return 'handled';
      }
      return input.key === 'Enter' || input.key === 'Escape' ? undefined : 'handled';
    },
    press: ends,
    finish: confirmed => (confirmed ? context.commit(result) : context.preview(null)),
  };
}

function moveSections(score: EditorState['score'], refs: SectionRef[], ticks: number) {
  const moved = refs.filter(ref => !ref.edge);
  let next = moveGlobals(score, moved.filter(ref => ref.kind === 'global').map(ref => ref.id), ticks);
  const byTrack = new Map<string, string[]>();
  for (const ref of moved) {
    if (ref.kind === 'track') {
      byTrack.set(ref.track, [...(byTrack.get(ref.track) ?? []), ref.id]);
    }
  }
  for (const [track, ids] of byTrack) {
    next = moveTrackSections(next, track, ids, ticks);
  }
  for (const ref of refs) {
    if (ref.edge) {
      next = ref.kind === 'global' ? resizeGlobal(next, ref.id, ref.edge, ticks) : resizeTrackSection(next, ref.track, ref.id, ref.edge, ticks);
    }
  }
  return next;
}

// B: drag a box over the active track's notes to add them to the selection; Shift when the drag
// starts removes them instead.
export function boxSelect(context: OperatorContext): Modal {
  let anchor: Point | null = null;
  let removing = false;
  let box: Rect | null = null;
  const base = context.state();

  const rectFrom = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  return {
    cursor: 'crosshair',
    describe: () => ['Box select: drag over notes to add them', 'Shift+drag: remove', 'Right click or Esc: cancel'].join('  ·  '),
    press: input => {
      if (input.button !== 0) {
        return 'cancel';
      }
      anchor = input;
      removing = input.shift;
      box = rectFrom(input, input);
      context.overlay(box);
      return 'handled';
    },
    move: input => {
      if (anchor) {
        box = rectFrom(anchor, input);
        context.overlay(box);
      }
    },
    release: input => {
      if (!anchor) {
        return 'handled';
      }
      box = rectFrom(anchor, input);
      return 'confirm';
    },
    finish: confirmed => {
      context.overlay(null);
      if (!confirmed || !box) {
        return;
      }
      const lane = context.lanes().find(other => other.track.id === base.activeTrack);
      if (!lane) {
        return;
      }
      const view = context.view();
      const area = box;
      const hit = trackNotes(base.score, lane.track).filter(item => intersects(area, noteRect(base.score, lane, view, item))).map(item => item.note.id);
      const selected = new Set(base.notes);
      hit.forEach(id => (removing ? selected.delete(id) : selected.add(id)));
      context.select({ ...base, notes: [...selected] });
    },
  };
}
