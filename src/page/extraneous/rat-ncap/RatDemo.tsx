// The homepage demo: the trained NCAP rat walking in MuJoCo (drawn with Slender as its kinematic
// skeleton inside the outline of its skin, public/rat-ncap/<checkpoint>/skin/rat.glb), its rhythm
// generation circuit lit by the activity, and controls for target speed and timescale.
//
// Until a visitor touches a control, it plays a cached loop of recorded walking and circuit
// activity (public/rat-ncap/<checkpoint>/demo-loop.json, made by scripts/make_demo_loop.ts), so the
// page does not run MuJoCo for everyone who passes by. Touching a control starts the simulation;
// the loop keeps playing, shaded, until it is ready.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties, JSX, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Col, Row } from 'react-bootstrap';
import { GraphView } from '../graphed/draw';
import { validate } from '../graphed/model';
import ncapCircuit from '../graphed/ncap-circuit.graphed?raw';
import { RG_UNITS } from './app/protocol';
import type { Activity, FromWorker, Geoms, ToWorker } from './app/protocol';
import { rowsFromQuaternion, SlenderRenderer } from './app/slenderRenderer';

const CHECKPOINT = `${import.meta.env.BASE_URL}rat-ncap/generic12`;
const CONTROL_DT = 0.03;  // (s) One control step, which is also one circuit tick.
const PANEL_HEIGHT = 300;
const INK = '#1d2330';
const MUTED = '#5b6575';
const DEFAULT_SPEED = 0.4;
const DEFAULT_TIMESCALE = 1.0;
const MAX_STEPS_PER_FRAME = 4;

const circuit = validate(JSON.parse(ncapCircuit));
// Where each limb's foot is, for the marks left when its extensor fires.
const FEET: Record<string, string> = { ext_FL: 'hand_L', ext_FR: 'hand_R', ext_HL: 'foot_L', ext_HR: 'foot_R' };
const EXT_ON = 0.1;
const MARK_COLOR = { r: 0.84, g: 0.16, b: 0.16 };
const unitIndex = new Map(RG_UNITS.map((unit, i) => [unit, i]));

// The circuit's recent activity, one sample per control step, read back interpolated between steps.
class Timeline {
  private samples = new Map<number, Float32Array>();
  private last = -1;
  private lastWall = 0;

  push(activity: Activity) {
    const n = RG_UNITS.length;
    if (activity.steps > 0 && activity.step < this.last) this.samples.clear();
    for (let k = 0; k < activity.steps; k++) {
      const step = activity.step - (activity.steps - 1 - k);
      this.samples.set(step, activity.values.slice(k * n, (k + 1) * n));
    }
    if (activity.steps > 0) {
      this.last = activity.step;
      this.lastWall = performance.now();
    }
    for (const step of this.samples.keys()) if (step < this.last - 16) this.samples.delete(step);
  }

  // Where to draw from, in steps: the simulation's progress estimated from the wall clock, one step
  // behind the newest sample so there is always a later sample to blend toward.
  displayStep(rate: number): number {
    if (this.last < 0) return 0;
    const since = rate > 0 ? (performance.now() - this.lastWall) / ((CONTROL_DT * 1000) / rate) : 0;
    return this.last - 1 + Math.min(1, since);
  }

  value(unit: string, at: number): number {
    const i = unitIndex.get(unit);
    if (i === undefined || this.last < 0) return 0;
    const t = Math.max(this.last - 15, Math.min(this.last, at));
    const s0 = Math.floor(t);
    const a = this.samples.get(s0) ?? this.samples.get(this.last)!;
    const b = this.samples.get(s0 + 1) ?? a;
    const v = a[i] + (b[i] - a[i]) * (t - s0);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
}

// The cached loop, as written by scripts/make_demo_loop.ts.
type Loop = {
  steps: number; nbody: number; units: string[]; geoms: Geoms;
  wrap: { turn: number; dx: number; dy: number };
  geomPose: { xpos: Float32Array; xmat: Float32Array };
  poses: Float32Array;  // Per step and body: x, y, z (m), then quaternion w, x, y, z.
  activity: Float32Array;  // Per step: one value per unit.
};

async function loadLoop(): Promise<Loop> {
  const response = await fetch(`${CHECKPOINT}/demo-loop.json`);
  if (!response.ok) throw new Error(`No cached demo loop (${response.status}).`);
  const raw = await response.json();
  const unpack = (text: string) => {
    const bytes = Uint8Array.from(atob(text), ch => ch.charCodeAt(0));
    return new Float32Array(bytes.buffer);
  };
  return {
    ...raw,
    geomPose: { xpos: unpack(raw.geomPose.xpos), xmat: unpack(raw.geomPose.xmat) },
    poses: unpack(raw.poses),
    activity: unpack(raw.activity),
  };
}

// Plays the loop end to end. Each pass is moved by the loop's `wrap` (a turn about the vertical and
// a shift) once more than the last, so the rat carries on walking instead of jumping back.
class LoopPlayer {
  private index = 0;
  private step = 0;
  private turn = 0;
  private dx = 0;
  private dy = 0;
  constructor(private loop: Loop) {}

  next(): { bodyXpos: Float32Array; bodyXmat: Float32Array; activity: Activity; snap: boolean } {
    const { loop } = this;
    const { nbody } = loop;
    const [c, s] = [Math.cos(this.turn), Math.sin(this.turn)];
    // The pass's turn as a quaternion about z, applied before each body's own rotation.
    const [qw, qz] = [Math.cos(this.turn / 2), Math.sin(this.turn / 2)];
    const bodyXpos = new Float32Array(3 * nbody);
    const bodyXmat = new Float32Array(9 * nbody);
    for (let b = 0; b < nbody; b++) {
      const o = 7 * (this.index * nbody + b);
      const [x, y, z, w, i, j, k] = loop.poses.subarray(o, o + 7);
      bodyXpos.set([c * x - s * y + this.dx, s * x + c * y + this.dy, z], 3 * b);
      bodyXmat.set(rowsFromQuaternion([qw * w - qz * k, qw * i - qz * j, qw * j + qz * i, qw * k + qz * w]), 9 * b);
    }
    const n = loop.units.length;
    const activity: Activity = { values: loop.activity.slice(this.index * n, (this.index + 1) * n), steps: 1, step: this.step };
    const snap = this.step === 0;
    this.step++;
    this.index++;
    if (this.index === loop.steps) {
      // Compose the wrap onto this pass's move: rotate the shift so far, then add the wrap's.
      const { turn, dx, dy } = loop.wrap;
      const [wc, ws] = [Math.cos(turn), Math.sin(turn)];
      [this.dx, this.dy] = [wc * this.dx - ws * this.dy + dx, ws * this.dx + wc * this.dy + dy];
      this.turn += turn;
      this.index = 0;
    }
    return { bodyXpos, bodyXmat, activity, snap };
  }
}

type Status = 'cached' | 'loading' | 'ready' | { error: string };

export default function RatDemo(): JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const renderer = useRef<SlenderRenderer | null>(null);
  const worker = useRef<Worker | null>(null);
  const player = useRef<{ player: LoopPlayer; loop: Loop; start: number; done: number } | null>(null);
  const timeline = useRef(new Timeline());
  const extWas = useRef<Record<string, number>>({});
  const [status, setStatus] = useState<Status>('cached');
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [timescale, setTimescale] = useState(DEFAULT_TIMESCALE);
  const [visible, setVisible] = useState(true);
  const [, redraw] = useReducer((x: number) => x + 1, 0);

  const send = useCallback((message: ToWorker) => worker.current?.postMessage(message), []);

  // One control step's worth of pose and activity, from the loop or the simulation.
  const show = useCallback((geomXpos: Float32Array, geomXmat: Float32Array, body: { xpos: Float32Array; xmat: Float32Array }, activity: Activity, snap: boolean) => {
    const r = renderer.current!;
    r.update(geomXpos, geomXmat, [], snap, body);
    // An extensor switching on marks the ground under its foot.
    const n = RG_UNITS.length;
    for (let k = 0; k < activity.steps; k++) {
      for (const [unit, foot] of Object.entries(FEET)) {
        const v = activity.values[k * n + unitIndex.get(unit)!];
        if (v >= EXT_ON && (extWas.current[unit] ?? 0) < EXT_ON) r.addMark(foot, MARK_COLOR);
        extWas.current[unit] = v;
      }
    }
    timeline.current.push(activity);
  }, []);

  useEffect(() => {
    // The rat as its kinematic skeleton inside the outline of its skin.
    renderer.current = new SlenderRenderer(viewport.current!, {
      floor: false, background: '#ffffff', camera: 'side', distance: 400, pitch: -0.14, headingLag: 0,
      skin: `${CHECKPOINT}/skin/rat.glb`, skinStyle: 'outline', skeleton: true,
    });
    let cancelled = false;
    loadLoop().then(loop => {
      if (cancelled || worker.current) return;
      renderer.current!.set_geoms(loop.geoms);
      player.current = { player: new LoopPlayer(loop), loop, start: performance.now(), done: 0 };
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ratGeoms = loop.geoms;
    }).catch(error => setStatus({ error: String(error) }));
    return () => {
      cancelled = true;
      worker.current?.terminate();
      renderer.current?.dispose();
    };
  }, []);

  // The first touch of a control starts the simulation.
  const wake = useCallback(() => {
    if (worker.current) return;
    setStatus('loading');
    const w = new Worker(new URL('./app/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === 'ready') {
        renderer.current!.set_geoms(message.geoms);
        w.postMessage({ type: 'set_auto_reset', value: true } satisfies ToWorker);
        player.current = null;
        extWas.current = {};
        setStatus('ready');
      } else if (message.type === 'frame') {
        if (player.current) return;
        show(message.xpos, message.xmat, { xpos: message.body_xpos, xmat: message.body_xmat }, message.activity, message.snap);
      } else if (message.type === 'error') {
        setStatus({ error: message.message });
      }
    };
    w.onerror = event => setStatus({ error: event.message || 'The simulation failed to load.' });
    w.postMessage({ type: 'init', checkpoint: CHECKPOINT } satisfies ToWorker);
  }, [show]);

  // Commands follow the controls once the simulation is ready.
  useEffect(() => {
    if (status === 'ready') send({ type: 'set_target_vx', value: speed });
  }, [status, speed, send]);
  useEffect(() => {
    if (status !== 'ready') return;
    if (timescale > 0) send({ type: 'set_rate', value: timescale });
    send({ type: 'pause', value: timescale === 0 || !visible });
  }, [status, timescale, visible, send]);

  // Only run while the demo is on screen.
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(row.current!);
    return () => observer.disconnect();
  }, []);

  const timescaleRef = useRef(timescale);
  timescaleRef.current = timescale;
  useEffect(() => {
    // The renderer draws in its own loop; it stops too while the demo is off screen.
    renderer.current?.setRunning(visible);
    if (!visible) return;
    let frame = 0;
    let last = performance.now();
    const loop = () => {
      // Advance the cached loop by the steps due at the current timescale.
      const p = player.current;
      const now = performance.now();
      if (p) {
        const rate = timescaleRef.current;
        p.start += rate > 0 ? 0 : now - last;
        const due = rate > 0 ? Math.floor(((now - p.start) * rate) / (CONTROL_DT * 1000)) - p.done : 0;
        for (let k = 0; k < Math.min(due, MAX_STEPS_PER_FRAME); k++) {
          const next = p.player.next();
          show(p.loop.geomPose.xpos, p.loop.geomPose.xmat, { xpos: next.bodyXpos, xmat: next.bodyXmat }, next.activity, next.snap);
          p.done++;
        }
        if (due > MAX_STEPS_PER_FRAME) p.done += due - MAX_STEPS_PER_FRAME;
      }
      last = now;
      redraw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [visible, show]);
  // Changing the timescale restarts the cached loop's clock from where it is.
  useEffect(() => {
    const p = player.current;
    if (p) p.start = performance.now() - (p.done * CONTROL_DT * 1000) / Math.max(timescale, 1e-6);
  }, [timescale]);

  const rate = visible ? timescale : 0;
  const display = timeline.current.displayStep(rate);
  const value = (unit: string, lag = 0) => timeline.current.value(unit, display - lag);
  if (import.meta.env.DEV) {
    // Lets browser tests read the circuit's recent activity.
    (window as unknown as Record<string, unknown>).__ratDemo = { timeline: timeline.current, send, status };
  }
  const caption = useCallback((node: string) => (node === 'bc' ? `${speed.toFixed(1)} m/s` : null), [speed]);

  const panel: CSSProperties = { border: '1px solid #e3e6ea', borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#ffffff' };
  // While the simulation loads, the cached loop keeps playing under a gray shade.
  const shade = status === 'loading' && <div style={{ position: 'absolute', inset: 0, background: 'rgba(120, 124, 130, 0.28)', pointerEvents: 'none' }}/>;
  const error = typeof status === 'object' && (
    <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: MUTED, fontSize: 12 }}>The simulation could not start: {status.error}</div>
  );

  return (
    <Row ref={row} style={{ marginBottom: 24 }}>
      {/* Side by side: simulation, circuit, controls. Stacked on narrow screens: controls first. */}
      <style>{`
        .rat-demo-panel { height: ${PANEL_HEIGHT}px; }
        @media (max-width: 767.98px) { .rat-demo-controls { height: auto; } }
        .rat-demo-slider:focus { outline: none; }
        .rat-demo-slider:focus-visible { outline: 2px solid ${INK}; outline-offset: 3px; }
      `}</style>
      <Col xs={{ span: 12, order: 3 }} md={{ span: 4, order: 1 }} style={{ marginBottom: 12 }}>
        <div className='rat-demo-panel' style={panel}>
          <div ref={viewport} style={{ position: 'absolute', inset: 0 }} aria-label='Simulated rat walking' role='img'/>
          {shade}
          {error}
        </div>
      </Col>
      <Col xs={{ span: 12, order: 2 }} md={{ span: 4, order: 2 }} style={{ marginBottom: 12 }}>
        <div className='rat-demo-panel' style={{ ...panel, padding: 6 }}>
          <GraphView doc={circuit} value={value} caption={caption} showText={false}/>
          {shade}
        </div>
      </Col>
      <Col xs={{ span: 12, order: 1 }} md={{ span: 4, order: 3 }} style={{ marginBottom: 12 }}>
        <div className='rat-demo-panel rat-demo-controls' style={{ ...panel, padding: '20px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28 }}>
          <BlockSlider label='Speed [m/s]' value={speed} onChange={setSpeed} onInteract={wake} min={0.2}/>
          <BlockSlider label='Timescale' value={timescale} onChange={setTimescale}/>
        </div>
      </Col>
    </Row>
  );
}

const THUMB_WIDTH = 52;
const TRACK_HEIGHT = 40;

// A rectangular track with a same-height box that slides inside it and shows the value. At the
// minimum the box's center sits on the track's left edge (half of it hangs past), at the maximum on
// the right edge.
function BlockSlider({ label, value, onChange, onInteract, min = 0, max = 1, step = 0.1 }: {
  label: string; value: number; onChange: (value: number) => void; onInteract?: () => void; min?: number; max?: number; step?: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const snap = (v: number) => Math.round(Math.max(min, Math.min(max, v)) / step) * step;
  // Measured against the track, so a press out where the box overhangs reads as the minimum or
  // maximum.
  const fromPointer = (event: ReactPointerEvent) => {
    const rect = track.current!.getBoundingClientRect();
    onChange(+snap(min + ((event.clientX - rect.left) / rect.width) * (max - min)).toFixed(6));
  };
  const onKey = (event: ReactKeyboardEvent) => {
    onInteract?.();
    const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[event.key as string];
    if (delta !== undefined) {
      event.preventDefault();
      onChange(+snap(value + delta).toFixed(6));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onChange(event.key === 'Home' ? min : max);
    }
  };
  const fraction = (value - min) / (max - min);
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, color: INK, marginBottom: 8, userSelect: 'none' }}>{label}</div>
      <div className='rat-demo-slider' role='slider' tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
        aria-valuetext={value.toFixed(1)} onKeyDown={onKey}
        onPointerDown={event => {
          event.preventDefault();
          onInteract?.();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
        }}
        style={{ padding: `0 ${THUMB_WIDTH / 2}px`, cursor: 'pointer', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <div ref={track} style={{ position: 'relative', height: TRACK_HEIGHT, background: '#eceff3' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: THUMB_WIDTH, left: `calc(${fraction * 100}% - ${THUMB_WIDTH / 2}px)`,
            background: INK, color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none',
          }}>
            {value.toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
}
