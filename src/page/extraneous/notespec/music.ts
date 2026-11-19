// Keys, scales, spelling, clefs and staff positions. Pitch is in semitones, MIDI numbering
// (60 = C4); a pitch class is pitch mod 12, with C = 0.

export type Scale = 'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian';
export type Key = { tonic: number; scale: Scale };
export type Spelling = 'sharp' | 'flat';
export type Clef = 'treble' | 'bass' | 'alto' | 'tenor';

export const SCALES: Scale[] = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian'];
export const CLEFS: Clef[] = ['treble', 'bass', 'alto', 'tenor'];

// Semitones above the tonic of each degree.
const INTERVALS: Record<Scale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

// The degree of the relative major each scale starts on (minor starts on the sixth).
const MODE_DEGREE: Record<Scale, number> = { major: 0, dorian: 1, phrygian: 2, lydian: 3, mixolydian: 4, minor: 5, locrian: 6 };

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// The pitch class of each natural letter.
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
// Letter and alteration of each pitch class, spelled with sharps and with flats.
const SHARP_SPELLING: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_SPELLING: [number, number][] = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

export const pitchClass = (pitch: number) => ((Math.round(pitch) % 12) + 12) % 12;
const mod = (value: number, n: number) => ((value % n) + n) % n;

export function scalePitchClasses({ tonic, scale }: Key): number[] {
  return INTERVALS[scale].map(interval => mod(tonic + interval, 12));
}

export function inKey(pitch: number, key: Key): boolean {
  return Number.isInteger(pitch) && scalePitchClasses(key).includes(pitchClass(pitch));
}

// The nearest pitch on the key's scale; a pitch halfway between two goes up.
export function snapToKey(pitch: number, key: Key): number {
  const classes = scalePitchClasses(key);
  const base = Math.round(pitch);
  for (let offset = 0; offset <= 6; offset++) {
    for (const candidate of [base + offset, base - offset]) {
      if (classes.includes(pitchClass(candidate))) {
        return candidate;
      }
    }
  }
  return base;
}

// The key signature as a count on the circle of fifths: sharps positive, flats negative. Six (F#
// major, or Gb major) counts as sharps.
export function signatureFifths({ tonic, scale }: Key): number {
  // The tonic sits on degree MODE_DEGREE of its relative major.
  const major = mod(tonic - INTERVALS.major[MODE_DEGREE[scale]], 12);
  const fifths = mod(major * 7, 12);
  return fifths > 6 ? fifths - 12 : fifths;
}

export const signatureDirection = (key: Key): Spelling => (signatureFifths(key) < 0 ? 'flat' : 'sharp');

// The key signature's alteration of each letter (1 sharp, -1 flat, 0 none), indexed by letter.
export function signatureAlterations(key: Key): number[] {
  const fifths = signatureFifths(key);
  const alterations = [0, 0, 0, 0, 0, 0, 0];
  // Sharps are added F C G D A E B, flats B E A D G C F.
  const sharpOrder = [3, 0, 4, 1, 5, 2, 6];
  for (let i = 0; i < Math.abs(fifths); i++) {
    if (fifths > 0) {
      alterations[sharpOrder[i]] = 1;
    } else {
      alterations[sharpOrder[6 - i]] = -1;
    }
  }
  return alterations;
}

export type Spelled = {
  // Staff steps from C-1: letter + 7 * octave. One step is a line to the next space.
  step: number;
  letter: number;
  alteration: number;
  // The fraction of a semitone a fractional pitch lies above (sharp) or below (flat) its base note.
  fraction: number;
};

// Where a pitch sits on the staff, and how it is spelled. Notes on the key's scale take the
// scale's letters; others take the note's spelling tag, or the key signature's direction.
export function spell(pitch: number, key: Key, spelling?: Spelling): Spelled {
  const direction = spelling ?? signatureDirection(key);
  const whole = direction === 'flat' ? Math.ceil(pitch - 1e-9) : Math.floor(pitch + 1e-9);
  const fraction = Math.abs(pitch - whole) < 1e-9 ? 0 : Math.abs(pitch - whole);
  const pc = pitchClass(whole);
  let letter: number;
  let alteration: number;
  const alterations = signatureAlterations(key);
  const classes = scalePitchClasses(key);
  const degree = fraction === 0 && !spelling ? classes.indexOf(pc) : -1;
  if (degree >= 0) {
    // Each degree of the scale has its own letter, counted from the tonic's.
    const tonicLetter = (signatureDirection(key) === 'flat' ? FLAT_SPELLING : SHARP_SPELLING)[key.tonic][0];
    letter = (tonicLetter + degree) % 7;
    alteration = alterations[letter];
  } else {
    [letter, alteration] = (direction === 'flat' ? FLAT_SPELLING : SHARP_SPELLING)[pc];
  }
  // The octave follows the letter, so that B#3 and Cb4 land where they are written.
  const octaves = Math.round((whole - NATURAL[letter] - alteration) / 12);
  return { step: letter + 7 * octaves, letter, alteration, fraction };
}

// The symbol drawn before a note: needed where its alteration differs from the key signature's
// for its letter, or for any fractional pitch (a tilde before the direction's symbol).
export function accidental(spelled: Spelled, key: Key, spelling?: Spelling): string | null {
  if (spelled.fraction > 0) {
    const direction = spelling ?? signatureDirection(key);
    return `~${direction === 'flat' ? '♭' : '♯'}`;
  }
  if (spelled.alteration === signatureAlterations(key)[spelled.letter]) {
    return null;
  }
  return ['♭♭', '♭', '♮', '♯', '𝄪'][spelled.alteration + 2];
}

// The natural pitch at a staff step.
export function stepPitch(step: number): number {
  return NATURAL[mod(step, 7)] + 12 * Math.floor(step / 7);
}

// The pitch at a fractional staff step: natural pitches at whole steps, straight lines between, so
// that halfway between C and D is C#, and E to F has no pitch in between.
export function pitchAtStep(step: number): number {
  const below = Math.floor(step);
  const low = stepPitch(below);
  return low + (stepPitch(below + 1) - low) * (step - below);
}

// The staff step of the bottom line of each clef's five-line staff.
const BOTTOM_LINE: Record<Clef, number> = {
  treble: 2 + 7 * 5, // E4
  bass: 4 + 7 * 3, // G2
  alto: 3 + 7 * 4, // F3
  tenor: 1 + 7 * 4, // D3
};

// A clef's five lines, as staff steps from the bottom.
export function staffLines(clef: Clef): number[] {
  return [0, 2, 4, 6, 8].map(offset => BOTTOM_LINE[clef] + offset);
}

export function staffRange(clef: Clef): { low: number; high: number } {
  return { low: BOTTOM_LINE[clef], high: BOTTOM_LINE[clef] + 8 };
}

const TONIC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const tonicName = (tonic: number) => TONIC_NAMES[mod(tonic, 12)];

export function pitchName(pitch: number, key: Key, spelling?: Spelling): string {
  const spelled = spell(pitch, key, spelling);
  const symbol = ['♭♭', '♭', '', '♯', '𝄪'][spelled.alteration + 2];
  return `${LETTERS[spelled.letter]}${symbol}${Math.floor(spelled.step / 7) - 1}`;
}

export const frequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
