// Playing rendered samples through Web Audio without clicks. A sound that starts or stops partway
// through a wave (playback started in the middle of a note, Stop, or one audition cutting off the
// last) jumps to or from full volume, which clicks. Every sound fades in briefly through its own
// gain, and stopping fades it out before it ends.

export const FADE_IN = 0.01;
export const FADE_OUT = 0.015;

export type Voice = { source: AudioBufferSourceNode; gain: GainNode };

// Starts samples at `when` (audio clock), fading in.
export function startSamples(audio: AudioContext, samples: Float32Array<ArrayBuffer>, when = audio.currentTime): Voice {
  const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(1, when + FADE_IN);
  source.connect(gain).connect(audio.destination);
  source.start(when);
  return { source, gain };
}

// Fades a voice out from where it is now, then stops it. Its `onended` is cleared first, so stopping
// isn't mistaken for reaching the end.
export function fadeOut(audio: AudioContext, { source, gain }: Voice) {
  const now = audio.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + FADE_OUT);
  source.onended = null;
  source.stop(now + FADE_OUT + 0.005);
}
