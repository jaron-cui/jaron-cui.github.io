// What undo covers: the score, the mode, the active track and the selection.
import { newScore, Score, trackRows } from './score';

export type Mode = 'object' | 'edit';

// A selected section line, or with `edge` one of its bounds (the bars at its ends).
export type SectionRef = ({ kind: 'global'; id: string } | { kind: 'track'; track: string; id: string }) & { edge?: 'start' | 'end' };

export type EditorState = {
  score: Score;
  mode: Mode;
  activeTrack: string;
  // Selected notes (edit mode) and selected section lines (object mode).
  notes: string[];
  sections: SectionRef[];
};

export const sameSection = (a: SectionRef, b: SectionRef) => a.kind === b.kind && a.id === b.id && (a.edge ?? null) === (b.edge ?? null);

export function initialState(score: Score = newScore()): EditorState {
  return { score, mode: 'object', activeTrack: trackRows(score)[0]?.track.id ?? '', notes: [], sections: [] };
}

// Drops selected things that no longer exist, and picks an active track if it's gone.
export function tidy(state: EditorState): EditorState {
  const { score } = state;
  const noteIds = new Set(Object.values(score.tracks).flatMap(track => track.sections.flatMap(section => section.notes.map(note => note.id))));
  const notes = state.notes.filter(id => noteIds.has(id));
  const sections = state.sections.filter(ref => (ref.kind === 'global'
    ? score.globals.some(global => global.id === ref.id)
    : score.tracks[ref.track]?.sections.some(section => section.id === ref.id)));
  const activeTrack = score.tracks[state.activeTrack] ? state.activeTrack : trackRows(score)[0]?.track.id ?? '';
  const unchanged = notes.length === state.notes.length && sections.length === state.sections.length && activeTrack === state.activeTrack;
  return unchanged ? state : { ...state, notes, sections, activeTrack };
}
