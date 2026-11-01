import { Fixed, Scene } from './model';

// Control points of a CSS-style timing curve from (0, 0) to (1, 1).
export type CubicEase = [x1: number, y1: number, x2: number, y2: number];

// Handles set by hand in the curves editor. Each is an offset in seconds and value from its own
// key, so unlike a CubicEase it can bend a segment whose two keys have the same value.
export type BezierEase = { out: [time: number, value: number]; in: [time: number, value: number] };

// How a key eases toward the next key. 'hold' keeps its value until the next key arrives.
export type Ease = 'linear' | 'hold' | CubicEase | BezierEase;

// Time is in seconds, not frames, so playback and export can sample at any rate.
export type Key = { time: number; value: number; ease?: Ease };

// Keys are sorted by time. Before the first key and after the last, the value holds.
// held is an edit not keyed yet. It shows at its own time only, and leaving that frame discards it.
export type Track = { kind: 'track'; keys: Key[]; held?: { time: number; value: number } };

// Every number in T may be a constant or a track, unless wrapped in Fixed. Everything else,
// including array lengths and the kinds of nodes, is fixed. A path therefore keeps its anchor
// count over time, which is what makes any two poses of it interpolable.
export type Animated<T> =
  T extends Fixed<unknown> ? T
  : T extends number ? number | Track
  : T extends string | boolean | null | undefined ? T
  : T extends (infer U)[] ? Animated<U>[]
  : { [K in keyof T]: Animated<T[K]> };

export type AnimatedScene = Animated<Scene>;

export function track(...keys: Key[]): Track {
  return { kind: 'track', keys: [...keys].sort((a, b) => a.time - b.time) };
}

// Handle positions as fractions of a segment's time, kept inside it so time never runs backward.
function cubicEaseFromHandles({ out, in: into }: BezierEase, span: number): [number, number] {
  return [Math.max(0, Math.min(1, out[0] / span)), Math.max(0, Math.min(1, 1 + into[0] / span))];
}

function cubicAt(a: number, b: number, s: number): number {
  const u = 1 - s;
  return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s;
}

// Finds the curve parameter whose x is the given progress. x is monotonic because x1 and x2 are in
// 0..1, so bisection always converges.
function parameterAt(x1: number, x2: number, progress: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    if (cubicAt(x1, x2, mid) < progress) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

// Maps progress in time to progress in value.
function applyCubicEase([x1, y1, x2, y2]: CubicEase, progress: number): number {
  return cubicAt(y1, y2, parameterAt(x1, x2, progress));
}

export function sampleTrack({ keys, held }: Track, time: number): number {
  if (keys.length === 0) {
    throw new Error('Cannot sample a track with no keys.');
  }
  if (held && Math.abs(held.time - time) < 1e-6) {
    return held.value;
  }
  if (time <= keys[0].time) {
    return keys[0].value;
  }
  const last = keys[keys.length - 1];
  if (time >= last.time) {
    return last.value;
  }

  const nextIndex = keys.findIndex(key => key.time > time);
  const from = keys[nextIndex - 1];
  const to = keys[nextIndex];
  const ease = from.ease ?? 'linear';
  if (ease === 'hold') {
    return from.value;
  }
  const progress = (time - from.time) / (to.time - from.time);
  if (typeof ease === 'object' && !Array.isArray(ease)) {
    const [x1, x2] = cubicEaseFromHandles(ease, to.time - from.time);
    const s = parameterAt(x1, x2, progress);
    const u = 1 - s;
    return u * u * u * from.value + 3 * u * u * s * (from.value + ease.out[1]) + 3 * u * s * s * (to.value + ease.in[1]) + s * s * s * to.value;
  }
  const eased = ease === 'linear' ? progress : applyCubicEase(ease, progress);
  return from.value + (to.value - from.value) * eased;
}

function evaluateValue(value: unknown, time: number): unknown {
  if (Array.isArray(value)) {
    return value.map(item => evaluateValue(item, time));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'track') {
    return sampleTrack(value as Track, time);
  }
  if (kind === 'fixed') {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    result[key] = evaluateValue(field, time);
  }
  return result;
}

// The whole of animation: a pure function from the document and a time to a static scene.
export function evaluateScene(scene: AnimatedScene, time: number): Scene {
  return evaluateValue(scene, time) as Scene;
}
