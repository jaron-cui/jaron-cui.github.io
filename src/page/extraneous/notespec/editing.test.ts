import {
  addFolder, addTrack, copyNotes, deleteFolder, deleteNotes, moveGlobals, moveItems, moveNotes, moveTrackSections,
  pasteNotes, placeNote, setDurations, setFolder, splitGlobal, splitNotes, splitTrackSection, tieNotes, untieNotes,
} from './editing';
import {
  allNotes, audibleTracks, locateNotes, newScore, overlappingGlobals, Score, sectionStart, strayNotes, trackRows, WHOLE,
} from './score';

const Q = WHOLE / 4;
const firstTrack = (score: Score) => score.tracks[score.tree.find(node => node.kind === 'track')!.id];

function place(score: Score, start: number, pitch: number, duration = Q) {
  return placeNote(score, firstTrack(score).id, start, pitch, duration);
}

function at(score: Score, id: string) {
  const [item] = locateNotes(score, [id]);
  return { start: item.start, pitch: item.note.pitch, duration: item.note.duration, tie: item.note.tie, section: item.section.id };
}

describe('notes', () => {
  it('places, moves and deletes', () => {
    let { score, id } = place(newScore(), Q, 60);
    expect(at(score, id)).toMatchObject({ start: Q, pitch: 60 });
    score = moveNotes(score, [id], Q, 2);
    expect(at(score, id)).toMatchObject({ start: 2 * Q, pitch: 62 });
    score = deleteNotes(score, [id]);
    expect(allNotes(score)).toHaveLength(0);
  });

  it('splits notes at a time into separate notes', () => {
    const { score, id } = place(newScore(), 0, 60, 2 * Q);
    const split = splitNotes(score, [id], Q);
    expect(split.created).toHaveLength(1);
    expect(at(split.score, id)).toMatchObject({ start: 0, duration: Q, tie: null });
    expect(at(split.score, split.created[0])).toMatchObject({ start: Q, duration: Q, tie: null });
    // A time outside the note splits nothing.
    expect(splitNotes(score, [id], 3 * Q).created).toHaveLength(0);
  });
});

describe('ties', () => {
  it('pairs a chord into the next by pitch order, leaving extras untied', () => {
    let score = newScore();
    const ids: string[] = [];
    for (const [start, pitch] of [[0, 60], [0, 64], [0, 67], [Q, 62], [Q, 65]]) {
      const placed = place(score, start, pitch);
      score = placed.score;
      ids.push(placed.id);
    }
    score = tieNotes(score, ids);
    expect(at(score, ids[0]).tie).toBe(ids[3]);
    expect(at(score, ids[1]).tie).toBe(ids[4]);
    expect(at(score, ids[2]).tie).toBeNull();
    score = untieNotes(score, [ids[3]]);
    expect(at(score, ids[0]).tie).toBeNull();
    expect(at(score, ids[1]).tie).toBe(ids[4]);
  });

  it('breaks a tie when its notes stop touching', () => {
    const a = place(newScore(), 0, 60);
    const b = place(a.score, Q, 64);
    const score = tieNotes(b.score, [a.id, b.id]);
    expect(at(score, a.id).tie).toBe(b.id);
    expect(at(moveNotes(score, [a.id, b.id], Q, 0), a.id).tie).toBe(b.id);
    expect(at(moveNotes(score, [b.id], Q, 0), a.id).tie).toBeNull();
    expect(at(setDurations(score, [a.id], Q / 2), a.id).tie).toBeNull();
  });
});

describe('copy and paste', () => {
  it('keeps relative times and ties', () => {
    const a = place(newScore(), 0, 60);
    const b = place(a.score, Q, 62);
    const score = tieNotes(b.score, [a.id, b.id]);
    const pasted = pasteNotes(score, firstTrack(score).id, 4 * Q, copyNotes(score, [a.id, b.id]));
    const [c, d] = pasted.ids;
    expect(at(pasted.score, c)).toMatchObject({ start: 4 * Q, pitch: 60, tie: d });
    expect(at(pasted.score, d)).toMatchObject({ start: 5 * Q, pitch: 62 });
  });
});

describe('sections', () => {
  it('splits globals, carrying each track part and its notes to the new section', () => {
    const before = place(newScore(), Q, 60);
    const after = place(before.score, 5 * Q, 62);
    const split = splitGlobal(after.score, 4 * Q);
    let score = split.score;
    expect(score.globals.map(global => [global.start, global.length])).toEqual([[0, 4 * Q], [4 * Q, 124 * Q]]);
    const track = firstTrack(score);
    expect(track.sections).toHaveLength(2);
    expect(at(score, after.id)).toMatchObject({ start: 5 * Q, section: track.sections[1].id });
    // Moving the second global section carries its notes; the first's stay.
    score = moveGlobals(score, [split.id!], 8 * Q);
    expect(at(score, after.id).start).toBe(13 * Q);
    expect(at(score, before.id).start).toBe(Q);
  });

  it('marks overlapping global sections', () => {
    const split = splitGlobal(newScore(), 4 * Q);
    expect(overlappingGlobals(split.score).size).toBe(0);
    expect(overlappingGlobals(moveGlobals(split.score, [split.id!], -Q)).size).toBe(2);
  });

  it('keeps a note that leaves every section with its own, as stray', () => {
    const track = firstTrack(newScore());
    const split = splitTrackSection(newScore(), track.id, 4 * Q);
    const placed = place(split.score, Q, 60);
    let score = moveNotes(placed.score, [placed.id], 4 * Q, 0);
    // Into the second track section: it moves there.
    expect(at(score, placed.id).section).toBe(split.id);
    // Past the end of the score: it stays, and is stray.
    score = moveNotes(score, [placed.id], 200 * Q, 0);
    expect(at(score, placed.id).section).toBe(split.id);
    expect(strayNotes(firstTrack(score)).has(placed.id)).toBe(true);
  });

  it('moves a track section into the global section its start lands in', () => {
    let score = splitGlobal(newScore(), 4 * Q).score;
    const track = firstTrack(score);
    const split = splitTrackSection(score, track.id, 2 * Q);
    score = moveTrackSections(split.score, track.id, [split.id!], 3 * Q);
    const moved = firstTrack(score).sections.find(section => section.id === split.id)!;
    expect(moved.global).toBe(score.globals[1].id);
    expect(sectionStart(score, moved)).toBe(5 * Q);
  });
});

describe('outliner', () => {
  it('nests and unnests, and never puts a folder inside itself', () => {
    const start = newScore();
    const outer = addFolder(start, 'Strings');
    const inner = addFolder(outer.score, 'Violins');
    let score = moveItems(inner.score, [inner.id], { into: outer.id });
    score = moveItems(score, [firstTrack(start).id], { into: inner.id });
    expect(trackRows(score)[0].depth).toBe(2);
    expect(moveItems(score, [outer.id], { into: inner.id }).tree).toEqual(score.tree);
    score = deleteFolder(score, inner.id);
    expect(trackRows(score)[0].depth).toBe(1);
  });

  it('solos and mutes through folders', () => {
    const second = addTrack(newScore(), 'Bass');
    const folder = addFolder(second.score, 'Low');
    let score = moveItems(folder.score, [second.id], { into: folder.id });
    expect(audibleTracks(score)).toHaveLength(2);
    score = setFolder(score, folder.id, { solo: true });
    expect(audibleTracks(score).map(track => track.id)).toEqual([second.id]);
    score = setFolder(score, folder.id, { muted: true });
    expect(audibleTracks(score)).toEqual([]);
  });
});
