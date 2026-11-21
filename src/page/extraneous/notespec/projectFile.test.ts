import { placeNote, tieNotes } from './editing';
import { parseScore, serializeScore } from './projectFile';
import { newScore } from './score';

describe('project files', () => {
  it('round-trips a score', () => {
    const start = newScore();
    const track = Object.keys(start.tracks)[0];
    const a = placeNote(start, track, 0, 60, 960);
    const b = placeNote(a.score, track, 960, 62, 960);
    const score = tieNotes(b.score, [a.id, b.id]);
    expect(parseScore(serializeScore(score))).toEqual(score);
  });

  it('says what is wrong with a bad file', () => {
    expect(() => parseScore('not json')).toThrow('not JSON');
    expect(() => parseScore('{"format":"slender"}')).toThrow('not a notespec score');
    expect(() => parseScore('{"format":"notespec","version":99,"score":{}}')).toThrow('newer version');
    expect(() => parseScore('{"format":"notespec","version":1,"score":{}}')).toThrow('incomplete');
  });
});
