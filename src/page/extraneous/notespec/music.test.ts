import { accidental, inKey, Key, pitchAtStep, pitchName, signatureFifths, snapToKey, spell, staffLines, stepPitch } from './music';

const C: Key = { tonic: 0, scale: 'major' };
const G: Key = { tonic: 7, scale: 'major' };
const F: Key = { tonic: 5, scale: 'major' };

describe('keys', () => {
  it('counts key signatures on the circle of fifths', () => {
    expect(signatureFifths(C)).toBe(0);
    expect(signatureFifths(G)).toBe(1);
    expect(signatureFifths(F)).toBe(-1);
    expect(signatureFifths({ tonic: 9, scale: 'minor' })).toBe(0);
    expect(signatureFifths({ tonic: 4, scale: 'minor' })).toBe(1);
    expect(signatureFifths({ tonic: 2, scale: 'dorian' })).toBe(0);
    expect(signatureFifths({ tonic: 1, scale: 'major' })).toBe(-5);
  });

  it('snaps to the nearest scale tone, going up from halfway', () => {
    expect(snapToKey(61, C)).toBe(62);
    expect(snapToKey(66, G)).toBe(66);
    expect(snapToKey(65, G)).toBe(66);
    expect(inKey(66, G)).toBe(true);
    expect(inKey(66, C)).toBe(false);
  });
});

describe('spelling', () => {
  it('spells with the key signature direction off the scale', () => {
    expect(pitchName(61, C)).toBe('C♯4');
    expect(pitchName(61, F)).toBe('D♭4');
    expect(pitchName(61, C, 'flat')).toBe('D♭4');
  });

  it('spells scale tones by the scale', () => {
    expect(pitchName(66, G)).toBe('F♯4');
    expect(pitchName(70, F)).toBe('B♭4');
    // F# major has E#.
    expect(pitchName(65, { tonic: 6, scale: 'major' })).toBe('E♯4');
  });

  it('draws an accidental only where the key signature differs', () => {
    expect(accidental(spell(66, G), G)).toBeNull();
    expect(accidental(spell(65, G), G)).toBe('♮');
    expect(accidental(spell(61, C), C)).toBe('♯');
    expect(accidental(spell(63, C, 'flat'), C, 'flat')).toBe('♭');
  });

  it('draws a fractional pitch on its base note with a tilde', () => {
    const sharp = spell(60.3, C);
    expect(sharp.step).toBe(spell(60, C).step);
    expect(accidental(sharp, C)).toBe('~♯');
    const flat = spell(61.7, C, 'flat');
    expect(flat.step).toBe(spell(62, C).step);
    expect(accidental(flat, C, 'flat')).toBe('~♭');
  });
});

describe('staff', () => {
  it('places clef lines', () => {
    expect(staffLines('treble').map(stepPitch)).toEqual([64, 67, 71, 74, 77]);
    expect(staffLines('bass').map(stepPitch)).toEqual([43, 47, 50, 53, 57]);
    expect(staffLines('alto').map(stepPitch)).toEqual([53, 57, 60, 64, 67]);
    expect(staffLines('tenor').map(stepPitch)).toEqual([50, 53, 57, 60, 64]);
  });

  it('puts sharps halfway between staff steps', () => {
    const c4 = spell(60, C).step;
    expect(pitchAtStep(c4)).toBe(60);
    expect(pitchAtStep(c4 + 0.5)).toBe(61);
    expect(pitchAtStep(c4 + 2.5)).toBe(64.5);
  });
});
