// Edits to a score. Each takes a score and returns a new one, sharing what it didn't change.
import { Spelling } from './music';
import {
  allNotes, emptyTrack, Folder, GlobalSection, globalAt, globalById, locateNotes, newId, Note, Score, sectionStart, Track,
  TrackSection, trackSectionAt, TreeNode,
} from './score';

// ---- Low-level updates ----

function withTrack(score: Score, track: Track): Score {
  return { ...score, tracks: { ...score.tracks, [track.id]: track } };
}

function updateSections(score: Score, trackId: string, update: (sections: TrackSection[]) => TrackSection[]): Score {
  const track = score.tracks[trackId];
  return withTrack(score, { ...track, sections: update(track.sections) });
}

// Applies `update` to every note in `ids`, in whatever section holds it.
function updateNotes(score: Score, ids: Set<string>, update: (note: Note) => Note): Score {
  let next = score;
  for (const track of Object.values(score.tracks)) {
    if (!track.sections.some(section => section.notes.some(note => ids.has(note.id)))) {
      continue;
    }
    next = updateSections(next, track.id, sections => sections.map(section => (
      section.notes.some(note => ids.has(note.id))
        ? { ...section, notes: section.notes.map(note => (ids.has(note.id) ? update(note) : note)) }
        : section
    )));
  }
  return next;
}

// ---- Ties ----

// Clears every tie whose two notes no longer touch (or whose target is gone). Run after any edit
// that moves, resizes or removes notes.
export function pruneTies(score: Score): Score {
  const located = allNotes(score);
  const starts = new Map(located.map(({ note, start, track }) => [note.id, { start, track: track.id }]));
  const broken = new Set<string>();
  for (const { note, start, track } of located) {
    if (note.tie === null) {
      continue;
    }
    const target = starts.get(note.tie);
    if (!target || target.track !== track.id || target.start !== start + note.duration) {
      broken.add(note.id);
    }
  }
  return broken.size === 0 ? score : updateNotes(score, broken, note => ({ ...note, tie: null }));
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return groups;
}

// Ties the selection's notes across each point where some end and others start: lowest pitch to
// lowest pitch, and so on; notes left over stay untied.
export function tieNotes(score: Score, ids: Iterable<string>): Score {
  const located = locateNotes(score, ids);
  const links = new Map<string, string>();
  const byTrack = groupBy(located, item => item.track.id);
  for (const notes of byTrack.values()) {
    const meetings = new Set(notes.map(item => item.start + item.note.duration));
    for (const time of meetings) {
      const ending = notes.filter(item => item.start + item.note.duration === time).sort((a, b) => a.note.pitch - b.note.pitch);
      const starting = notes.filter(item => item.start === time).sort((a, b) => a.note.pitch - b.note.pitch);
      for (let i = 0; i < Math.min(ending.length, starting.length); i++) {
        links.set(ending[i].note.id, starting[i].note.id);
      }
    }
  }
  return updateNotes(score, new Set(links.keys()), note => ({ ...note, tie: links.get(note.id)! }));
}

// Removes the ties from and into the selection's notes.
export function untieNotes(score: Score, ids: Iterable<string>): Score {
  const selected = new Set(ids);
  const affected = new Set(locateNotesWhere(score, note => selected.has(note.id) || (note.tie !== null && selected.has(note.tie))));
  return updateNotes(score, affected, note => ({ ...note, tie: null }));
}

function locateNotesWhere(score: Score, test: (note: Note) => boolean): string[] {
  return Object.values(score.tracks).flatMap(track => track.sections.flatMap(section => section.notes.filter(test).map(note => note.id)));
}

// ---- Notes ----

// Places a note at an absolute time on a track. It belongs to the track section there, or, outside
// every section, to the nearest one (where it shows as stray).
export function placeNote(score: Score, trackId: string, start: number, pitch: number, duration: number): { score: Score; id: string } {
  const [id, next] = newId(score, 'n');
  const track = next.tracks[trackId];
  const section = trackSectionAt(next, track, start) ?? nearestSection(next, track, start);
  if (!section) {
    return { score, id: '' };
  }
  const note: Note = { id, pitch, start: start - sectionStart(next, section), duration, tie: null };
  return { score: updateSections(next, trackId, sections => sections.map(other => (other === section ? { ...other, notes: [...other.notes, note] } : other))), id };
}

function nearestSection(score: Score, track: Track, tick: number): TrackSection | undefined {
  let best: TrackSection | undefined;
  let bestDistance = Infinity;
  for (const section of track.sections) {
    const start = sectionStart(score, section);
    const distance = tick < start ? start - tick : Math.max(0, tick - (start + section.length) + 1);
    if (distance < bestDistance) {
      [best, bestDistance] = [section, distance];
    }
  }
  return best;
}

export function deleteNotes(score: Score, ids: Iterable<string>): Score {
  const gone = new Set(ids);
  let next = score;
  for (const track of Object.values(score.tracks)) {
    if (track.sections.some(section => section.notes.some(note => gone.has(note.id)))) {
      next = updateSections(next, track.id, sections => sections.map(section => ({ ...section, notes: section.notes.filter(note => !gone.has(note.id)) })));
    }
  }
  return pruneTies(next);
}

// Moves notes by a number of ticks and semitones. A note whose start lands in another section of its
// track moves into that section; one that lands outside every section stays with its own.
export function moveNotes(score: Score, ids: Iterable<string>, ticks: number, semitones: number): Score {
  const located = locateNotes(score, ids);
  let next = score;
  for (const [trackId, items] of groupBy(located, item => item.track.id)) {
    const track = next.tracks[trackId];
    const moving = new Map(items.map(item => [item.note.id, item]));
    // Take the moving notes out, then put each into the section its new start falls in.
    let sections = track.sections.map(section => ({ ...section, notes: section.notes.filter(note => !moving.has(note.id)) }));
    for (const item of items) {
      const start = item.start + ticks;
      const target = trackSectionAt(next, { ...track, sections }, start) ?? sections.find(section => section.id === item.section.id)!;
      const note = { ...item.note, pitch: item.note.pitch + semitones, start: start - sectionStart(next, target) };
      sections = sections.map(section => (section.id === target.id ? { ...section, notes: [...section.notes, note] } : section));
    }
    next = withTrack(next, { ...track, sections });
  }
  return pruneTies(next);
}

export function setDurations(score: Score, ids: Iterable<string>, duration: number): Score {
  return pruneTies(updateNotes(score, new Set(ids), note => ({ ...note, duration })));
}

export function setSpelling(score: Score, ids: Iterable<string>, spelling: Spelling | undefined): Score {
  return updateNotes(score, new Set(ids), note => {
    const { spelling: _, ...rest } = note;
    return spelling ? { ...rest, spelling } : rest;
  });
}

// Splits the notes that the given time falls strictly inside into two separate notes. Returns the
// second halves' ids. A tie out of a split note leaves from its second half.
export function splitNotes(score: Score, ids: Iterable<string>, time: number): { score: Score; created: string[] } {
  const located = locateNotes(score, ids).filter(({ note, start }) => time > start && time < start + note.duration);
  let next = score;
  const created: string[] = [];
  for (const { track, section, note, start } of located) {
    const [id, withId] = newId(next, 'n');
    next = withId;
    created.push(id);
    const first: Note = { ...note, duration: time - start, tie: null };
    const second: Note = { ...note, id, start: note.start + (time - start), duration: start + note.duration - time };
    next = updateSections(next, track.id, sections => sections.map(other => (
      other.id === section.id ? { ...other, notes: other.notes.flatMap(n => (n.id === note.id ? [first, second] : [n])) } : other
    )));
  }
  return { score: next, created };
}

// ---- Copy and paste ----

export type Clip = { notes: { pitch: number; offset: number; duration: number; spelling?: Spelling; tie: number | null }[] };

// The selected notes, relative to the earliest. Ties within the copy are kept.
export function copyNotes(score: Score, ids: Iterable<string>): Clip {
  const located = locateNotes(score, ids).sort((a, b) => a.start - b.start || a.note.pitch - b.note.pitch);
  if (located.length === 0) {
    return { notes: [] };
  }
  const origin = located[0].start;
  const index = new Map(located.map((item, i) => [item.note.id, i]));
  return {
    notes: located.map(({ note, start }) => ({
      pitch: note.pitch, offset: start - origin, duration: note.duration,
      ...(note.spelling ? { spelling: note.spelling } : {}),
      tie: note.tie !== null && index.has(note.tie) ? index.get(note.tie)! : null,
    })),
  };
}

export function pasteNotes(score: Score, trackId: string, time: number, clip: Clip): { score: Score; ids: string[] } {
  let next = score;
  const ids: string[] = [];
  for (const item of clip.notes) {
    const placed = placeNote(next, trackId, time + item.offset, item.pitch, item.duration);
    next = placed.score;
    ids.push(placed.id);
  }
  next = updateNotes(next, new Set(ids), note => {
    const item = clip.notes[ids.indexOf(note.id)];
    return { ...note, ...(item.spelling ? { spelling: item.spelling } : {}), tie: item.tie === null ? null : ids[item.tie] };
  });
  return { score: pruneTies(next), ids };
}

// ---- Sections ----

// Splits the global section at a time, and every track section spanning it, so each track's part
// after the split belongs to the new global section.
export function splitGlobal(score: Score, time: number): { score: Score; id: string | null } {
  const global = globalAt(score, time);
  if (!global || time === global.start) {
    return { score, id: null };
  }
  const [id, withId] = newId(score, 'g');
  let next: Score = {
    ...withId,
    globals: withId.globals.flatMap(other => (other.id === global.id
      ? [{ ...other, length: time - other.start }, { ...other, id, start: time, length: other.start + other.length - time }]
      : [other])),
  };
  const offset = time - global.start;
  for (const track of Object.values(score.tracks)) {
    const sections: TrackSection[] = [];
    for (const section of track.sections) {
      if (section.global !== global.id || section.start + section.length <= offset) {
        sections.push(section);
      } else if (section.start >= offset) {
        sections.push({ ...section, global: id, start: section.start - offset });
      } else {
        const [secondId, after] = newId(next, 's');
        next = after;
        const [first, second] = splitSectionAt(section, offset - section.start);
        sections.push(first, { ...second, id: secondId, global: id, start: 0 });
      }
    }
    next = withTrack(next, { ...next.tracks[track.id], sections });
  }
  return { score: next, id };
}

// A section cut at a point (relative to its start): the first part keeps its id; notes go by their
// start. The second part's start is left for the caller.
function splitSectionAt(section: TrackSection, at: number): [TrackSection, TrackSection] {
  return [
    { ...section, length: at, notes: section.notes.filter(note => note.start < at) },
    { ...section, start: section.start + at, length: section.length - at, notes: section.notes.filter(note => note.start >= at).map(note => ({ ...note, start: note.start - at })) },
  ];
}

// Splits a track's section at an absolute time.
export function splitTrackSection(score: Score, trackId: string, time: number): { score: Score; id: string | null } {
  const track = score.tracks[trackId];
  const section = trackSectionAt(score, track, time);
  if (!section || time === sectionStart(score, section)) {
    return { score, id: null };
  }
  const [id, next] = newId(score, 's');
  const [first, second] = splitSectionAt(section, time - sectionStart(score, section));
  return {
    score: updateSections(next, trackId, sections => sections.flatMap(other => (other.id === section.id ? [first, { ...second, id }] : [other]))),
    id,
  };
}

export function moveGlobals(score: Score, ids: Iterable<string>, ticks: number): Score {
  const moving = new Set(ids);
  return pruneTies({ ...score, globals: score.globals.map(global => (moving.has(global.id) ? { ...global, start: global.start + ticks } : global)) });
}

// Moves track sections. One whose start lands in another global section joins it; outside every
// global section it stays with its own.
export function moveTrackSections(score: Score, trackId: string, ids: Iterable<string>, ticks: number): Score {
  const moving = new Set(ids);
  const next = updateSections(score, trackId, sections => sections.map(section => {
    if (!moving.has(section.id)) {
      return section;
    }
    const start = sectionStart(score, section) + ticks;
    const target = globalAt(score, start) ?? globalById(score, section.global)!;
    return { ...section, global: target.id, start: start - target.start };
  }));
  return pruneTies(next);
}

export function setGlobal(score: Score, id: string, changes: Partial<Omit<GlobalSection, 'id'>>): Score {
  return { ...score, globals: score.globals.map(global => (global.id === id ? { ...global, ...changes } : global)) };
}

export function setTrackSection(score: Score, trackId: string, id: string, changes: Partial<Omit<TrackSection, 'id' | 'notes'>>): Score {
  return updateSections(score, trackId, sections => sections.map(section => (section.id === id ? { ...section, ...changes } : section)));
}

// ---- Tracks and folders ----

export function addTrack(score: Score, name: string): { score: Score; id: string } {
  const [track, next] = emptyTrack(score, name);
  return { score: { ...withTrack(next, track), tree: [...next.tree, { kind: 'track', id: track.id }] }, id: track.id };
}

export function addFolder(score: Score, name: string): { score: Score; id: string } {
  const [id, next] = newId(score, 'f');
  return {
    score: { ...next, folders: { ...next.folders, [id]: { id, name, hidden: false, muted: false, solo: false } }, tree: [...next.tree, { kind: 'folder', id, children: [] }] },
    id,
  };
}

export function setTrack(score: Score, id: string, changes: Partial<Omit<Track, 'id' | 'sections'>>): Score {
  return withTrack(score, { ...score.tracks[id], ...changes });
}

export function setFolder(score: Score, id: string, changes: Partial<Omit<Folder, 'id'>>): Score {
  return { ...score, folders: { ...score.folders, [id]: { ...score.folders[id], ...changes } } };
}

function removeNode(nodes: TreeNode[], id: string): [TreeNode[], TreeNode | null] {
  let found: TreeNode | null = null;
  const kept: TreeNode[] = [];
  for (const node of nodes) {
    if (node.id === id) {
      found = node;
      continue;
    }
    if (node.kind === 'folder') {
      const [children, inner] = removeNode(node.children, id);
      found ??= inner;
      kept.push(inner ? { ...node, children } : node);
    } else {
      kept.push(node);
    }
  }
  return [kept, found];
}

function containsNode(node: TreeNode, id: string): boolean {
  return node.id === id || (node.kind === 'folder' && node.children.some(child => containsNode(child, id)));
}

// Where a dragged item goes: into a folder (at its end), before an item, or at the end of the top level.
export type Drop = { into: string } | { before: string } | { root: true };

function insertNode(nodes: TreeNode[], node: TreeNode, drop: Drop): [TreeNode[], boolean] {
  if ('root' in drop) {
    return [[...nodes, node], true];
  }
  const result: TreeNode[] = [];
  let placed = false;
  for (const other of nodes) {
    if ('before' in drop && other.id === drop.before) {
      result.push(node);
      placed = true;
    }
    if (other.kind === 'folder') {
      if ('into' in drop && other.id === drop.into) {
        result.push({ ...other, children: [...other.children, node] });
        placed = true;
        continue;
      }
      const [children, inner] = insertNode(other.children, node, drop);
      placed ||= inner;
      result.push(inner ? { ...other, children } : other);
    } else {
      result.push(other);
    }
  }
  return [result, placed];
}

// Moves outliner items. A folder can't go inside itself; such a move does nothing.
export function moveItems(score: Score, ids: string[], drop: Drop): Score {
  let tree = score.tree;
  for (const id of ids) {
    const target = 'into' in drop ? drop.into : 'before' in drop ? drop.before : null;
    if (target === id) {
      continue;
    }
    const [without, node] = removeNode(tree, id);
    if (!node || (target && containsNode(node, target))) {
      continue;
    }
    const [placed, ok] = insertNode(without, node, drop);
    if (ok) {
      tree = placed;
    }
  }
  return { ...score, tree };
}

// Deletes a folder; what it held takes its place.
export function deleteFolder(score: Score, id: string): Score {
  const replace = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap(node => (
    node.kind === 'folder' ? (node.id === id ? replace(node.children) : [{ ...node, children: replace(node.children) }]) : [node]
  ));
  const { [id]: _, ...folders } = score.folders;
  return { ...score, folders, tree: replace(score.tree) };
}

export function deleteTrack(score: Score, id: string): Score {
  const [tree] = removeNode(score.tree, id);
  const { [id]: _, ...tracks } = score.tracks;
  return pruneTies({ ...score, tracks, tree });
}
