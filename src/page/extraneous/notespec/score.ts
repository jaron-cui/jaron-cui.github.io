// The score's data and the lookups everything else uses. Scores are immutable: edits (editing.ts)
// return new objects and share everything unchanged, so undo can keep whole snapshots.
import { Clef, Key, Spelling } from './music';

// Time is whole-number ticks. 960 per quarter note divides evenly into triplets down to 1/32.
export const TICKS_PER_QUARTER = 960;
export const WHOLE = 4 * TICKS_PER_QUARTER;

export type TimeSignature = { beats: number; unit: number };

export type Note = {
  id: string;
  // Semitones, MIDI numbering (60 = C4).
  pitch: number;
  // Ticks from the start of the track section that owns the note.
  start: number;
  duration: number;
  // The note this one is tied into, which must start where this one ends.
  tie: string | null;
  // How the note is drawn when off the key's scale; otherwise the key decides.
  spelling?: Spelling;
};

export type SectionAttributes = { key: Key; time: TimeSignature; clef: Clef };

// A section of the whole score. Its start is absolute; tempo is in quarter notes per minute.
export type GlobalSection = SectionAttributes & { id: string; start: number; length: number; tempo: number };

// A track's subdivision of a global section. Its start is relative to that global section's, and
// its notes' starts are relative to its own, so moving either carries everything inside along.
export type TrackSection = {
  id: string;
  global: string;
  start: number;
  length: number;
  overrides: Partial<SectionAttributes>;
  notes: Note[];
};

export type Visibility = { hidden: boolean; muted: boolean; solo: boolean };

export type Track = Visibility & {
  id: string;
  name: string;
  sections: TrackSection[];
  // Semitones of room above and below the staffs of the lane's clefs.
  margins: { above: number; below: number };
};

export type Folder = Visibility & { id: string; name: string };

// The outliner's order and nesting. Lanes are drawn in this order, depth first.
export type TreeNode = { kind: 'track'; id: string } | { kind: 'folder'; id: string; children: TreeNode[] };

export type Score = {
  globals: GlobalSection[];
  tracks: Record<string, Track>;
  folders: Record<string, Folder>;
  tree: TreeNode[];
  nextId: number;
};

export const DEFAULT_ATTRIBUTES: SectionAttributes = { key: { tonic: 0, scale: 'major' }, time: { beats: 4, unit: 4 }, clef: 'treble' };
export const DEFAULT_TEMPO = 120;
export const DEFAULT_BARS = 32;
export const DEFAULT_MARGINS = { above: 7, below: 7 };

export const ticksPerBeat = (time: TimeSignature) => WHOLE / time.unit;
export const ticksPerBar = (time: TimeSignature) => ticksPerBeat(time) * time.beats;

// A fresh id, and the score that has used it up.
export function newId(score: Score, prefix: string): [string, Score] {
  return [`${prefix}${score.nextId}`, { ...score, nextId: score.nextId + 1 }];
}

export function emptyTrack(score: Score, name: string): [Track, Score] {
  const [id, withTrack] = newId(score, 't');
  let next = withTrack;
  const sections: TrackSection[] = [];
  for (const global of score.globals) {
    const [sectionId, after] = newId(next, 's');
    next = after;
    sections.push({ id: sectionId, global: global.id, start: 0, length: global.length, overrides: {}, notes: [] });
  }
  return [{ id, name, sections, margins: { ...DEFAULT_MARGINS }, hidden: false, muted: false, solo: false }, next];
}

// One global section (4/4, C major, 120 BPM, treble clef) and one empty track.
export function newScore(): Score {
  const global: GlobalSection = { id: 'g1', start: 0, length: DEFAULT_BARS * ticksPerBar(DEFAULT_ATTRIBUTES.time), tempo: DEFAULT_TEMPO, ...DEFAULT_ATTRIBUTES };
  const base: Score = { globals: [global], tracks: {}, folders: {}, tree: [], nextId: 2 };
  const [track, score] = emptyTrack(base, 'Track 1');
  return { ...score, tracks: { [track.id]: track }, tree: [{ kind: 'track', id: track.id }] };
}

export function globalById(score: Score, id: string): GlobalSection | undefined {
  return score.globals.find(global => global.id === id);
}

// Where a track section starts in the score.
export function sectionStart(score: Score, section: TrackSection): number {
  return (globalById(score, section.global)?.start ?? 0) + section.start;
}

// A track section's key, time signature and clef: its global section's, with its overrides.
export function sectionAttributes(score: Score, section: TrackSection): SectionAttributes {
  const global = globalById(score, section.global);
  return { ...(global ?? DEFAULT_ATTRIBUTES), ...section.overrides };
}

export function globalAt(score: Score, tick: number): GlobalSection | undefined {
  return score.globals.find(global => tick >= global.start && tick < global.start + global.length);
}

export function trackSectionAt(score: Score, track: Track, tick: number): TrackSection | undefined {
  return track.sections.find(section => {
    const start = sectionStart(score, section);
    return tick >= start && tick < start + section.length;
  });
}

// The attributes in force at a point of a track: its section's, or the global section's there, or the
// first global section's.
export function attributesAt(score: Score, track: Track | undefined, tick: number): SectionAttributes {
  const section = track && trackSectionAt(score, track, tick);
  if (section) {
    return sectionAttributes(score, section);
  }
  return globalAt(score, tick) ?? score.globals[0] ?? DEFAULT_ATTRIBUTES;
}

export type Located = { track: Track; section: TrackSection; note: Note; start: number };

// Every note of a track with its absolute start.
export function trackNotes(score: Score, track: Track): Located[] {
  return track.sections.flatMap(section => {
    const offset = sectionStart(score, section);
    return section.notes.map(note => ({ track, section, note, start: offset + note.start }));
  });
}

export function allNotes(score: Score): Located[] {
  return Object.values(score.tracks).flatMap(track => trackNotes(score, track));
}

export function locateNotes(score: Score, ids: Iterable<string>): Located[] {
  const wanted = new Set(ids);
  return allNotes(score).filter(({ note }) => wanted.has(note.id));
}

// Tracks in outliner order, depth first, with what their folders pass down.
export type TrackRow = { track: Track; hidden: boolean; muted: boolean; soloed: boolean; depth: number };

export function trackRows(score: Score): TrackRow[] {
  const rows: TrackRow[] = [];
  const visit = (nodes: TreeNode[], inherited: { hidden: boolean; muted: boolean; soloed: boolean }, depth: number) => {
    for (const node of nodes) {
      const item = node.kind === 'track' ? score.tracks[node.id] : score.folders[node.id];
      if (!item) {
        continue;
      }
      const state = { hidden: inherited.hidden || item.hidden, muted: inherited.muted || item.muted, soloed: inherited.soloed || item.solo };
      if (node.kind === 'track') {
        rows.push({ track: score.tracks[node.id], ...state, depth });
      } else {
        visit(node.children, state, depth + 1);
      }
    }
  };
  visit(score.tree, { hidden: false, muted: false, soloed: false }, 0);
  return rows;
}

// The tracks that sound: when anything is soloed, only soloed tracks; never muted ones.
export function audibleTracks(score: Score): Track[] {
  const rows = trackRows(score);
  const anySolo = rows.some(row => row.soloed);
  return rows.filter(row => !row.muted && (!anySolo || row.soloed)).map(row => row.track);
}

// Notes whose attachment point (their start) lies outside the section that owns them.
export function strayNotes(track: Track): Set<string> {
  const stray = new Set<string>();
  for (const section of track.sections) {
    for (const note of section.notes) {
      if (note.start < 0 || note.start >= section.length) {
        stray.add(note.id);
      }
    }
  }
  return stray;
}

// Track sections whose start lies outside their global section.
export function straySections(score: Score, track: Track): Set<string> {
  return new Set(track.sections.filter(section => {
    const global = globalById(score, section.global);
    return !global || section.start < 0 || section.start >= global.length;
  }).map(section => section.id));
}

function overlapping<T extends { id: string }>(items: T[], range: (item: T) => [number, number]): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [a0, a1] = range(items[i]);
      const [b0, b1] = range(items[j]);
      if (a0 < b1 && b0 < a1) {
        found.add(items[i].id);
        found.add(items[j].id);
      }
    }
  }
  return found;
}

export const overlappingGlobals = (score: Score) => overlapping(score.globals, global => [global.start, global.start + global.length]);

export function overlappingSections(score: Score, track: Track): Set<string> {
  return overlapping(track.sections, section => {
    const start = sectionStart(score, section);
    return [start, start + section.length];
  });
}

// The end of the last section, for scrolling and playback.
export function scoreEnd(score: Score): number {
  return Math.max(0, ...score.globals.map(global => global.start + global.length));
}
