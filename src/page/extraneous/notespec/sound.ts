// Turns notes into samples. A track's notes go in whole (so a later instrument can keep state across
// notes, such as bowing); for now each tie (a chain of tied notes) becomes one sine voice that
// steps from pitch to pitch, with a short fade in and a release past its end.
import { frequency } from './music';
import { audibleTracks, locateNotes, Score, trackNotes, Track, TICKS_PER_QUARTER } from './score';

export const ATTACK = 0.005;
export const RELEASE = 0.04;
const VOICE_GAIN = 0.18;

// Seconds from tick 0, by the tempo of the global section each stretch of time falls in (before the
// first section, the first section's tempo).
export type TempoMap = { seconds(tick: number): number; tick(seconds: number): number };

export function tempoMap(score: Score): TempoMap {
  const starts = [...score.globals].sort((a, b) => a.start - b.start);
  // Segments of constant tempo: [start tick, start seconds, seconds per tick].
  const segments: [number, number, number][] = [];
  let seconds = 0;
  let previous: [number, number] | null = null;
  for (const global of starts) {
    const perTick = 60 / (global.tempo * TICKS_PER_QUARTER);
    if (previous) {
      seconds += (global.start - previous[0]) * previous[1];
    } else if (global.start > 0) {
      seconds = global.start * perTick;
    }
    segments.push([global.start, seconds, perTick]);
    previous = [global.start, perTick];
  }
  if (segments.length === 0 || segments[0][0] > 0) {
    const perTick = segments[0]?.[2] ?? 60 / (120 * TICKS_PER_QUARTER);
    segments.unshift([0, 0, perTick]);
  }
  return {
    seconds: tick => {
      const segment = [...segments].reverse().find(([start]) => tick >= start) ?? segments[0];
      return segment[1] + (tick - segment[0]) * segment[2];
    },
    tick: time => {
      const segment = [...segments].reverse().find(([, start]) => time >= start) ?? segments[0];
      return segment[0] + (time - segment[1]) / segment[2];
    },
  };
}

export type SoundNote = { start: number; end: number; pitch: number };

// A track's notes, in seconds, grouped into ties: each chain of tied notes in order.
export function trackTies(score: Score, track: Track, time: TempoMap): SoundNote[][] {
  const notes = trackNotes(score, track);
  const byId = new Map(notes.map(item => [item.note.id, item]));
  const tiedInto = new Set(notes.flatMap(item => (item.note.tie ? [item.note.tie] : [])));
  const ties: SoundNote[][] = [];
  for (const head of notes.filter(item => !tiedInto.has(item.note.id))) {
    const chain: SoundNote[] = [];
    const seen = new Set<string>();
    for (let item = head as typeof head | undefined; item && !seen.has(item.note.id); item = item.note.tie ? byId.get(item.note.tie) : undefined) {
      seen.add(item.note.id);
      chain.push({ start: time.seconds(item.start), end: time.seconds(item.start + item.note.duration), pitch: item.note.pitch });
    }
    ties.push(chain);
  }
  return ties.sort((a, b) => a[0].start - b[0].start);
}

// One tie as a sine voice: phase-continuous across its notes, faded in over ATTACK and out over
// RELEASE after its end. Returns where it starts, in seconds, and its samples.
export function sineTie(tie: SoundNote[], rate: number): { start: number; samples: Float32Array } {
  const start = tie[0].start;
  const end = tie[tie.length - 1].end;
  const length = Math.ceil((end - start + RELEASE) * rate);
  const samples = new Float32Array(length);
  let phase = 0;
  let index = 0;
  for (let i = 0; i < length; i++) {
    const t = start + i / rate;
    while (index < tie.length - 1 && t >= tie[index].end) {
      index++;
    }
    const attack = Math.min(1, (i / rate) / ATTACK);
    const release = t <= end ? 1 : Math.max(0, 1 - (t - end) / RELEASE);
    samples[i] = Math.sin(phase) * attack * release * VOICE_GAIN;
    phase += (2 * Math.PI * frequency(tie[index].pitch)) / rate;
  }
  return { start, samples };
}

// A track's sound, from `from` seconds on. Ties that started earlier and still sound are included.
export function renderTrack(score: Score, track: Track, rate: number, time: TempoMap, from = 0): Float32Array<ArrayBuffer> {
  const ties = trackTies(score, track, time).filter(tie => tie[tie.length - 1].end + RELEASE > from);
  const end = Math.max(from, ...ties.map(tie => tie[tie.length - 1].end + RELEASE));
  const out = new Float32Array(Math.ceil((end - from) * rate));
  for (const tie of ties) {
    const { start, samples } = sineTie(tie, rate);
    const offset = Math.round((start - from) * rate);
    for (let i = Math.max(0, -offset); i < samples.length && offset + i < out.length; i++) {
      out[offset + i] += samples[i];
    }
  }
  return out;
}

// The longest a note sounds when auditioned.
export const AUDITION_SECONDS = 1;

// Notes played on their own, all starting together, as when one is placed or its pitch changes:
// each for its own length, at most AUDITION_SECONDS.
export function auditionSamples(score: Score, ids: Iterable<string>, rate: number): Float32Array<ArrayBuffer> {
  const time = tempoMap(score);
  const notes = locateNotes(score, ids).map(({ note, start }) => ({
    pitch: note.pitch,
    seconds: Math.min(AUDITION_SECONDS, time.seconds(start + note.duration) - time.seconds(start)),
  }));
  const voices = notes.map(({ pitch, seconds }) => sineTie([{ start: 0, end: seconds, pitch }], rate).samples);
  const mix = new Float32Array(Math.max(0, ...voices.map(voice => voice.length)));
  // Chords are scaled so they never clip.
  const gain = Math.min(1, 4 / Math.max(1, voices.length));
  for (const voice of voices) {
    for (let i = 0; i < voice.length; i++) {
      mix[i] += voice[i] * gain;
    }
  }
  return mix;
}

// Every audible track mixed, from a tick on, scaled down if it would clip.
export function renderScore(score: Score, rate: number, fromTick = 0): Float32Array<ArrayBuffer> {
  const time = tempoMap(score);
  const from = time.seconds(fromTick);
  const tracks = audibleTracks(score).map(track => renderTrack(score, track, rate, time, from));
  const mix = new Float32Array(Math.max(0, ...tracks.map(track => track.length)));
  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) {
      mix[i] += track[i];
    }
  }
  let peak = 0;
  for (const value of mix) {
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak > 0.95) {
    const scale = 0.95 / peak;
    for (let i = 0; i < mix.length; i++) {
      mix[i] *= scale;
    }
  }
  return mix;
}
