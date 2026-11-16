// The homepage Slender demo: a bouncing cube (cube.slender) in a Slender viewport that swings round
// with a drag; a dope sheet showing the value curves of an object's animated properties (or one of
// them), with keyframes to drag in time and value; and an outliner of objects and their animated
// properties. Edits live in the page; Reset (or a reload) restores the original.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Col, Row } from 'react-bootstrap';
import { renderScene } from '../../../lib/vrender/render';
import { sampleTrack, track } from './animation';
import type { Ease, Key, Track } from './animation';
import { findObject, toScene, updateObject } from './document';
import type { EditorDocument } from './document';
import { toCamera } from './editing';
import { parseProject } from './projectFile';
import cubeProject from './cube.slender?raw';

const PANEL_HEIGHT = 340;
const INK = '#1d2330';
const MUTED = '#5b6575';
const LINE = '#e3e6ea';
const SELECT = '#e0a100';
const EASED: Ease = [0.42, 0, 0.58, 1];
const SWING_PER_PIXEL = 0.008;  // (rad)
const SWING_DECAY = 0.45;  // (s)

type Part = 'position' | 'rotation' | 'scale';
type Axis = 'x' | 'y' | 'z';
type Property = { id: string; object: string; objectName: string; part: Part; axis: Axis };
// What the outliner has picked: a whole object, or one of its properties.
type Focus = { kind: 'object'; id: string } | { kind: 'property'; id: string };
type Selection = { kind: 'key' | 'segment'; property: string; index: number } | null;

const PART_NAMES: Record<Part, string> = { position: 'Position', rotation: 'Rotation', scale: 'Scale' };
// With a whole object showing, each curve is coloured by axis (as Blender does) and dashed by kind.
const AXIS_COLORS: Record<Axis, string> = { x: '#d64545', y: '#3f9b4f', z: '#3b6fd6' };
const PART_DASH: Record<Part, string | undefined> = { position: undefined, rotation: '7 4', scale: '2 3' };

const initialDocument = parseProject(cubeProject).document;

function animatedProperties(document: EditorDocument): Property[] {
  const out: Property[] = [];
  for (const object of document.objects) {
    for (const part of ['position', 'rotation', 'scale'] as Part[]) {
      for (const axis of ['x', 'y', 'z'] as Axis[]) {
        const value = (object.transform[part] as Record<Axis, unknown>)[axis];
        if (value && typeof value === 'object' && (value as Track).kind === 'track') {
          out.push({ id: `${object.id}/${part}/${axis}`, object: object.id, objectName: object.name, part, axis });
        }
      }
    }
  }
  return out;
}

const trackOf = (document: EditorDocument, p: Property) => (findObject(document, p.object)!.transform[p.part] as Record<Axis, Track>)[p.axis];

function withKeys(document: EditorDocument, p: Property, keys: Key[]): EditorDocument {
  return updateObject(document, p.object, object => ({
    ...object,
    transform: { ...object.transform, [p.part]: { ...object.transform[p.part], [p.axis]: track(...keys) } },
  }));
}

// Each property's vertical range: its original curve sits in the middle third, with room to move
// keys a full spread (max - min) below the lowest value and above the highest. It stays put while
// keys are edited.
const RANGE = new Map(animatedProperties(initialDocument).map(p => {
  const t = trackOf(initialDocument, p);
  const end = Math.max(...t.keys.map(k => k.time));
  let [low, high] = [Infinity, -Infinity];
  for (const v of [...t.keys.map(k => k.value), ...Array.from({ length: 201 }, (_, i) => sampleTrack(t, (i / 200) * end))]) {
    [low, high] = [Math.min(low, v), Math.max(high, v)];
  }
  const spread = high - low > 1e-9 ? high - low : Math.max(Math.abs(high), 1);
  return [p.id, { low: low - spread, high: high + spread }];
}));
const rangeOf = (id: string) => RANGE.get(id) ?? { low: -1, high: 1 };

const easeKind = (ease: Ease | undefined) => (ease === 'linear' || ease === undefined ? 'Linear' : ease === 'bounce' ? 'Bounce' : 'Eased');

export default function SlenderDemo(): JSX.Element {
  const [document, setDocument] = useState(initialDocument);
  const properties = useMemo(() => animatedProperties(document), [document]);
  const [focus, setFocus] = useState<Focus>({ kind: 'object', id: initialDocument.objects[0]?.id ?? '' });
  const shown = properties.filter(p => (focus.kind === 'object' ? p.object === focus.id : p.id === focus.id));
  const [selection, setSelection] = useState<Selection>(null);
  const fps = document.frameRate;
  // The timeline runs to the later of the scene's end and its last key (a loop's closing key sits
  // one frame past the end, matching the first).
  const totalFrames = useMemo(() => Math.max(initialDocument.frameEnd + 1, ...animatedProperties(initialDocument).flatMap(p => trackOf(initialDocument, p).keys.map(k => Math.round(k.time * initialDocument.frameRate)))), []);
  const [range, setRange] = useState<[number, number]>([initialDocument.frameStart, totalFrames]);
  const [playing, setPlaying] = useState(true);
  const time = useRef(0);
  const scrubbing = useRef(false);
  const [visible, setVisible] = useState(true);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const row = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // How far the camera has been swung round (yaw) and tilted (pitch) from its home view, and how fast.
  const swing = useRef({ offset: 0, velocity: 0, tilt: 0, tiltVelocity: 0, dragging: false, x: 0, y: 0, time: 0 });
  const documentRef = useRef(document);
  documentRef.current = document;
  const playback = useRef({ playing, range });
  playback.current = { playing, range };

  // Anything that is not a keyframe, a curve, or the editor bar clears the selection.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('[data-slender-keep]')) setSelection(null);
    };
    window.document.addEventListener('pointerdown', onDown);
    return () => window.document.removeEventListener('pointerdown', onDown);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(row.current!);
    return () => observer.disconnect();
  }, []);

  // Playback and drawing, while on screen.
  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    let last = performance.now();
    const drawn = { time: NaN, offset: NaN, tilt: NaN, doc: null as typeof documentRef.current | null, frame: NaN, size: NaN };
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { playing: isPlaying, range: [start, end] } = playback.current;
      const doc = documentRef.current;
      if (isPlaying && !scrubbing.current) {
        let f = time.current * doc.frameRate + dt * doc.frameRate;
        if (f >= end || f < start) f = start + (((f - start) % (end - start)) + (end - start)) % (end - start);
        time.current = f / doc.frameRate;
      }
      const s = swing.current;
      if (!s.dragging) {
        s.offset += s.velocity * dt;
        s.velocity *= Math.exp(-dt / SWING_DECAY);
        s.tilt += s.tiltVelocity * dt;
        s.tiltVelocity *= Math.exp(-dt / SWING_DECAY);
      }
      const tilt = clampTilt(s.tilt);
      if (tilt !== s.tilt) [s.tilt, s.tiltVelocity] = [tilt, 0];
      // Draw only when something moved: the time, the camera, the scene, or the canvas's size.
      const size = (canvas.current?.clientWidth ?? 0) * 10000 + (canvas.current?.clientHeight ?? 0);
      if (time.current !== drawn.time || s.offset !== drawn.offset || s.tilt !== drawn.tilt || doc !== drawn.doc || size !== drawn.size) {
        draw(canvas.current, doc, time.current, s.offset, s.tilt);
        Object.assign(drawn, { time: time.current, offset: s.offset, tilt: s.tilt, doc, size });
      }
      // The panels follow the frame shown, so they re-render only when it changes, not every frame.
      const shownFrame = Math.round(time.current * doc.frameRate);
      if (shownFrame !== drawn.frame) {
        drawn.frame = shownFrame;
        redraw();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  const byId = useMemo(() => new Map(properties.map(p => [p.id, p])), [properties]);
  const keysOf = (id: string) => trackOf(document, byId.get(id)!).keys;
  const setKeys = useCallback((id: string, next: Key[]) => setDocument(d => withKeys(d, animatedProperties(d).find(p => p.id === id)!, next)), []);
  const frameNow = Math.round(time.current * fps);
  const selectedKeys = selection && byId.get(selection.property) ? keysOf(selection.property) : [];

  // Keys every shown property at the cursor's frame (an existing key there is kept).
  const insertKeys = () => {
    const at = frameNow / fps;
    let next = document;
    let firstNew: Selection = null;
    for (const p of shown) {
      const keys = trackOf(next, p).keys;
      if (keys.some(k => Math.round(k.time * fps) === frameNow)) continue;
      const before = [...keys].reverse().find(k => k.time < at);
      const added = [...keys, { time: at, value: sampleTrack(trackOf(next, p), at), ease: before?.ease ?? EASED }].sort((a, b) => a.time - b.time);
      next = withKeys(next, p, added);
      firstNew ??= { kind: 'key', property: p.id, index: added.findIndex(k => k.time === at) };
    }
    setDocument(next);
    if (shown.length === 1) {
      const keys = trackOf(next, shown[0]).keys;
      setSelection({ kind: 'key', property: shown[0].id, index: keys.findIndex(k => Math.round(k.time * fps) === frameNow) });
    } else if (firstNew) {
      setSelection(null);
    }
  };

  const reset = () => {
    setDocument(initialDocument);
    setSelection(null);
    setRange([initialDocument.frameStart, totalFrames]);
  };

  const focusName = focus.kind === 'object'
    ? document.objects.find(o => o.id === focus.id)?.name ?? ''
    : (() => {
      const p = byId.get(focus.id);
      return p ? `${p.objectName} ${PART_NAMES[p.part]} ${p.axis.toUpperCase()}` : '';
    })();

  const panel: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#ffffff' };

  return (
    <Row ref={row} style={{ marginBottom: 24 }}>
      <style>{`
        .slender-demo-panel { height: ${PANEL_HEIGHT}px; }
        @media (max-width: 767.98px) { .slender-demo-outliner { height: auto; } }
        .slender-demo button:focus { outline: none; }
        .slender-demo button:focus-visible { outline: 2px solid ${INK}; outline-offset: 2px; }
      `}</style>
      <Col xs={{ span: 12, order: 3 }} md={{ span: 4, order: 1 }} style={{ marginBottom: 12 }}>
        <div className='slender-demo-panel' style={panel}>
          <canvas ref={canvas} style={{ display: 'block', width: '100%', height: '100%', cursor: 'grab', touchAction: 'none' }}
            aria-label='A cube bouncing over its shadow, drawn by Slender' role='img'
            onPointerDown={event => {
              event.currentTarget.setPointerCapture(event.pointerId);
              swing.current = { ...swing.current, dragging: true, velocity: 0, tiltVelocity: 0, x: event.clientX, y: event.clientY, time: event.timeStamp };
              event.currentTarget.style.cursor = 'grabbing';
            }}
            onPointerMove={event => {
              const s = swing.current;
              if (!s.dragging) return;
              const turn = -(event.clientX - s.x) * SWING_PER_PIXEL;
              const lift = -(event.clientY - s.y) * SWING_PER_PIXEL;
              const dt = Math.max(1e-3, (event.timeStamp - s.time) / 1000);
              s.offset += turn;
              s.tilt = clampTilt(s.tilt + lift);
              s.velocity = s.velocity * 0.6 + (turn / dt) * 0.4;
              s.tiltVelocity = s.tiltVelocity * 0.6 + (lift / dt) * 0.4;
              s.x = event.clientX;
              s.y = event.clientY;
              s.time = event.timeStamp;
            }}
            onPointerUp={event => {
              const s = swing.current;
              s.dragging = false;
              if (event.timeStamp - s.time > 80) [s.velocity, s.tiltVelocity] = [0, 0];
              event.currentTarget.style.cursor = 'grab';
            }}/>
        </div>
      </Col>
      <Col xs={{ span: 12, order: 2 }} md={{ span: 4, order: 2 }} style={{ marginBottom: 12 }}>
        <div className='slender-demo slender-demo-panel' style={{ ...panel, display: 'flex', flexDirection: 'column' }}>
          <HeaderBar title='Dope sheet' detail={focusName}>
            <BarButton onClick={reset}>Reset</BarButton>
          </HeaderBar>
          <CurveEditor shown={shown} keysOf={keysOf} setKeys={setKeys} fps={fps} totalFrames={totalFrames} range={range}
            time={time.current} selection={selection} setSelection={setSelection} single={shown.length === 1}
            scrub={(t, active) => {
              time.current = Math.max(0, Math.min(totalFrames / fps, t));
              scrubbing.current = active;
            }}/>
          <EditorBar>
            {selection?.kind === 'key' && selectedKeys[selection.index] && <>
              <BarLabel>Keyframe</BarLabel>
              <BarButton disabled={selectedKeys.length < 2} onClick={() => {
                setKeys(selection.property, selectedKeys.filter((_, i) => i !== selection.index));
                setSelection(null);
              }}>Delete</BarButton>
            </>}
            {selection?.kind === 'segment' && selectedKeys[selection.index + 1] && <>
              <BarLabel>Interpolation</BarLabel>
              <div style={{ display: 'flex' }}>
                {(['Linear', 'Eased', 'Bounce'] as const).map((name, i) => (
                  <BarButton key={name} joined={i === 0 ? 'first' : i === 2 ? 'last' : 'middle'} active={easeKind(selectedKeys[selection.index].ease) === name}
                    onClick={() => setKeys(selection.property, selectedKeys.map((k, j) => (j === selection.index ? { ...k, ease: name === 'Linear' ? 'linear' : name === 'Bounce' ? 'bounce' : EASED } : k)))}>
                    {name}
                  </BarButton>
                ))}
              </div>
            </>}
            {!selection && <>
              <BarLabel>Dope sheet</BarLabel>
              <BarButton onClick={insertKeys}>Insert keyframe</BarButton>
            </>}
          </EditorBar>
          <div className='slender-demo' style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderTop: `1px solid ${LINE}` }}>
            <button type='button' aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(p => !p)}
              style={{ width: 36, height: 36, flexShrink: 0, border: 'none', background: INK, color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
              <svg width='14' height='14' viewBox='0 0 14 14' aria-hidden='true'>
                {playing ? <><rect x='2' y='1' width='3.5' height='12' fill='currentColor'/><rect x='8.5' y='1' width='3.5' height='12' fill='currentColor'/></> : <path d='M3 1 L13 7 L3 13 Z' fill='currentColor'/>}
              </svg>
            </button>
            <RangeSlider min={0} max={totalFrames} value={range} onChange={setRange} label='Playback range'/>
          </div>
        </div>
      </Col>
      <Col xs={{ span: 12, order: 1 }} md={{ span: 4, order: 3 }} style={{ marginBottom: 12 }}>
        <div className='slender-demo slender-demo-panel slender-demo-outliner' style={{ ...panel, display: 'flex', flexDirection: 'column' }}>
          <HeaderBar title='Animated properties'/>
          <div style={{ padding: 10, overflowY: 'auto', flex: 1 }}>
            {document.objects.filter(o => properties.some(p => p.object === o.id)).map(object => {
              const own = properties.filter(p => p.object === object.id);
              return (
                <div key={object.id} style={{ marginBottom: 8 }}>
                  <OutlinerRow on={focus.kind === 'object' && focus.id === object.id} bold onClick={() => {
                    setFocus({ kind: 'object', id: object.id });
                    setSelection(null);
                  }}>{object.name}</OutlinerRow>
                  {own.map((p, i) => (
                    <div key={p.id} style={{ position: 'relative', paddingLeft: 26, marginTop: 4 }}>
                      {/* The tree's connector: down from the object, then across to this property. */}
                      <div style={{ position: 'absolute', left: 11, top: -4, bottom: i === own.length - 1 ? '50%' : -4, borderLeft: '1.5px solid #c3c9d2' }}/>
                      <div style={{ position: 'absolute', left: 11, top: '50%', width: 12, borderTop: '1.5px solid #c3c9d2' }}/>
                      <OutlinerRow on={focus.kind === 'property' && focus.id === p.id} onClick={() => {
                        setFocus({ kind: 'property', id: p.id });
                        setSelection(null);
                      }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: AXIS_COLORS[p.axis], marginRight: 7 }}/>
                        {PART_NAMES[p.part]} {p.axis.toUpperCase()}
                      </OutlinerRow>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </Col>
    </Row>
  );
}

function OutlinerRow({ on, bold = false, onClick, children }: { on: boolean; bold?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type='button' aria-pressed={on} onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: `1.5px solid ${on ? INK : '#d9dee5'}`,
        background: on ? INK : '#ffffff', color: on ? '#ffffff' : INK, font: 'inherit', fontSize: 14, fontWeight: bold ? 600 : 400,
        cursor: 'pointer', userSelect: 'none',
      }}>
      {children}
    </button>
  );
}

function HeaderBar({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 42, padding: '0 10px', borderBottom: `1px solid ${LINE}`, background: '#f6f7f9', flexShrink: 0 }}>
      <span style={{ fontWeight: 700, fontSize: 14, color: INK }}>{title}</span>
      {detail && <span style={{ fontSize: 13, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>}
      <span style={{ flex: 1 }}/>
      {children}
    </div>
  );
}

type Drag = { kind: 'key'; property: string; index: number } | { kind: 'scrub' } | null;

// The shown properties' curves over time, each scaled to its own range (see RANGE); keys as
// diamonds to drag in time and value, segments to pick, and the time cursor.
// Pressing empty space scrubs.
function CurveEditor({ shown, keysOf, setKeys, fps, totalFrames, range, time, selection, setSelection, scrub, single }: {
  shown: Property[]; keysOf: (id: string) => Key[]; setKeys: (id: string, keys: Key[]) => void; fps: number; totalFrames: number;
  range: [number, number]; time: number; selection: Selection; setSelection: (s: Selection) => void;
  scrub: (time: number, active: boolean) => void; single: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 200 });
  const drag = useRef<Drag>(null);
  const lastScrub = useRef(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(box.current!);
    return () => observer.disconnect();
  }, []);
  const duration = totalFrames / fps;
  const L = 12, R = 12, T = 22, B = 10;
  const plotW = Math.max(10, size.w - L - R);
  const plotH = Math.max(10, size.h - T - B);
  const x = (s: number) => L + (s / duration) * plotW;
  // Values are drawn as a share of their property's range, 0 at the bottom and 1 at the top.
  const y = (share: number) => T + (1 - share) * plotH;
  const timeAt = (px: number) => ((px - L) / plotW) * duration;
  const shareAt = (py: number) => 1 - (py - T) / plotH;
  const local = (event: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { px: event.clientX - r.left, py: event.clientY - r.top };
  };
  const frameStep = totalFrames > 40 ? 10 : 5;

  const curves = shown.map(p => {
    const keys = keysOf(p.id);
    const { low, high } = rangeOf(p.id);
    const share = (v: number) => (v - low) / (high - low);
    const t = track(...keys);
    const samples = Array.from({ length: 241 }, (_, i) => {
      const s = (i / 240) * duration;
      return { time: s, share: share(sampleTrack(t, s)) };
    });
    const path = (from: number, to: number) => samples.filter(s => s.time >= from - 1e-9 && s.time <= to + 1e-9)
      .map((s, i) => `${i ? 'L' : 'M'}${x(s.time).toFixed(1)} ${y(s.share).toFixed(1)}`).join('');
    return { p, keys, share, path, color: single ? INK : AXIS_COLORS[p.axis], dash: single ? undefined : PART_DASH[p.part] };
  });

  return (
    <div ref={box} style={{ flex: 1, minHeight: 0, position: 'relative', userSelect: 'none' }}>
      <svg width={size.w} height={size.h} style={{ display: 'block', touchAction: 'none' }}
        onPointerDown={event => {
          const { px } = local(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { kind: 'scrub' };
          lastScrub.current = timeAt(px);
          scrub(lastScrub.current, true);
        }}
        onPointerMove={event => {
          const d = drag.current;
          if (!d) return;
          const { px, py } = local(event);
          if (d.kind === 'scrub') {
            lastScrub.current = timeAt(px);
            scrub(lastScrub.current, true);
            return;
          }
          // A key moves to the nearest frame between its neighbours, and to any value in the plot.
          const keys = keysOf(d.property);
          const prev = keys[d.index - 1];
          const next = keys[d.index + 1];
          let frame = Math.round(timeAt(px) * fps);
          if (prev) frame = Math.max(frame, Math.round(prev.time * fps) + 1);
          if (next) frame = Math.min(frame, Math.round(next.time * fps) - 1);
          frame = Math.max(0, Math.min(totalFrames, frame));
          const { low, high } = rangeOf(d.property);
          const value = +(low + Math.max(0, Math.min(1, shareAt(py))) * (high - low)).toPrecision(4);
          setKeys(d.property, keys.map((k, i) => (i === d.index ? { ...k, time: frame / fps, value } : k)));
        }}
        onPointerUp={() => {
          if (drag.current?.kind === 'scrub') scrub(lastScrub.current, false);
          drag.current = null;
        }}>
        {/* Outside the playback range is shaded. */}
        <rect x={L} y={T} width={Math.max(0, x(range[0] / fps) - L)} height={plotH} fill='#f1f3f6'/>
        <rect x={x(range[1] / fps)} y={T} width={Math.max(0, L + plotW - x(range[1] / fps))} height={plotH} fill='#f1f3f6'/>
        <line x1={L} x2={L + plotW} y1={y(1 / 3)} y2={y(1 / 3)} stroke='#eef0f3'/>
        <line x1={L} x2={L + plotW} y1={y(2 / 3)} y2={y(2 / 3)} stroke='#eef0f3'/>
        {Array.from({ length: Math.floor(totalFrames / frameStep) + 1 }, (_, i) => i * frameStep).map(f => (
          <g key={f}>
            <line x1={x(f / fps)} x2={x(f / fps)} y1={T} y2={T + plotH} stroke='#eef0f3'/>
            <text x={x(f / fps)} y={T - 7} fontSize={10} fill={MUTED} textAnchor='middle'>{f}</text>
          </g>
        ))}
        {/* The curves, one selectable piece per segment; before the first and after the last key, dashed. */}
        {curves.map(c => (
          <g key={c.p.id}>
            {c.keys.length > 0 && <path d={c.path(0, c.keys[0].time)} fill='none' stroke='#b3bac5' strokeWidth={1.25} strokeDasharray='4 3'/>}
            {c.keys.length > 0 && <path d={c.path(c.keys[c.keys.length - 1].time, duration)} fill='none' stroke='#b3bac5' strokeWidth={1.25} strokeDasharray='4 3'/>}
            {c.keys.slice(0, -1).map((k, i) => {
              const d = c.path(k.time, c.keys[i + 1].time);
              const on = selection?.kind === 'segment' && selection.property === c.p.id && selection.index === i;
              return (
                <g key={'s' + i} data-slender-keep style={{ cursor: 'pointer' }} onPointerDown={event => {
                  event.stopPropagation();
                  setSelection({ kind: 'segment', property: c.p.id, index: i });
                }}>
                  <path d={d} fill='none' stroke='transparent' strokeWidth={14}/>
                  <path d={d} fill='none' stroke={on ? SELECT : c.color} strokeWidth={on ? 3.5 : 2} strokeDasharray={on ? undefined : c.dash}/>
                </g>
              );
            })}
          </g>
        ))}
        {/* The time cursor. */}
        <line x1={x(time)} x2={x(time)} y1={T - 2} y2={T + plotH} stroke={INK} strokeWidth={1.5}/>
        {curves.flatMap(c => c.keys.map((k, i) => {
          const on = selection?.kind === 'key' && selection.property === c.p.id && selection.index === i;
          const [kx, ky] = [x(k.time), y(c.share(k.value))];
          return (
            <g key={`${c.p.id}-k${i}`} data-slender-keep style={{ cursor: 'move' }} onPointerDown={event => {
              event.stopPropagation();
              (event.currentTarget.ownerSVGElement ?? event.currentTarget).setPointerCapture(event.pointerId);
              setSelection({ kind: 'key', property: c.p.id, index: i });
              drag.current = { kind: 'key', property: c.p.id, index: i };
            }}>
              <rect x={kx - 11} y={ky - 11} width={22} height={22} fill='transparent'/>
              <rect x={kx - 5.5} y={ky - 5.5} width={11} height={11} transform={`rotate(45 ${kx} ${ky})`} fill={on ? SELECT : '#ffffff'} stroke={single ? INK : c.color} strokeWidth={1.75}/>
            </g>
          );
        }))}
      </svg>
    </div>
  );
}

const HOME_PITCH = -0.32;
// The tilt stays between looking nearly straight down and a little from below.
const clampTilt = (tilt: number) => Math.max(-1.45 - HOME_PITCH, Math.min(0.35 - HOME_PITCH, tilt));

// The scene at a time, seen from a camera swung `swing` radians round the cube and tilted `tilt`
// radians up from its home view.
function draw(canvas: HTMLCanvasElement | null, document: EditorDocument, time: number, swing: number, tilt: number) {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const ratio = window.devicePixelRatio || 1;
  const { clientWidth: w, clientHeight: h } = canvas;
  if (w === 0 || h === 0) return;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const camera = toCamera({ target: { x: 0, y: 0, z: 230 }, yaw: 4.2 + swing, pitch: HOME_PITCH + tilt, distance: 1350, focalLength: 800 });
  const scene = toScene(document, camera, time, null);
  renderScene(ctx, { ...scene, background: { r: 1, g: 1, b: 1, a: 1 } }, { panX: w / 2, panY: h / 2, zoom: h / 620 }, ratio);
}

function EditorBar({ children }: { children: ReactNode }) {
  return (
    <div data-slender-keep style={{ display: 'flex', alignItems: 'center', gap: 10, height: 42, padding: '0 10px', borderTop: '1px solid #e3e6ea', flexShrink: 0 }}>
      {children}
    </div>
  );
}

function BarLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontWeight: 600, fontSize: 14, color: INK, minWidth: 92 }}>{children}</span>;
}

function BarButton({ children, onClick, active = false, disabled = false, joined }: {
  children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; joined?: 'first' | 'middle' | 'last';
}) {
  return (
    <button type='button' onClick={onClick} disabled={disabled}
      style={{
        height: 30, padding: '0 12px', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
        border: `1.5px solid ${INK}`, marginLeft: joined && joined !== 'first' ? -1.5 : 0,
        background: active ? INK : '#ffffff', color: active ? '#ffffff' : INK, opacity: disabled ? 0.4 : 1,
      }}>
      {children}
    </button>
  );
}

const RANGE_BOX = 36;

// Two boxes on one track, each showing its frame. They cannot pass or overlap: dragging one into
// the other pushes it along. Pressing out past an end of the track reads as that end.
function RangeSlider({ min, max, value, onChange, label }: {
  min: number; max: number; value: [number, number]; onChange: (value: [number, number]) => void; label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const active = useRef<0 | 1 | null>(null);
  const [start, end] = value;
  const gapFrames = () => {
    const w = track.current?.getBoundingClientRect().width ?? 200;
    return Math.max(1, Math.ceil((RANGE_BOX / w) * (max - min)));
  };
  const set = (which: 0 | 1, v: number) => {
    const gap = gapFrames();
    let [a, b] = value;
    if (which === 0) {
      a = Math.max(min, Math.min(max - gap, v));
      if (b < a + gap) b = a + gap;
    } else {
      b = Math.max(min + gap, Math.min(max, v));
      if (a > b - gap) a = b - gap;
    }
    onChange([a, b]);
  };
  const frameAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(min + ((clientX - r.left) / r.width) * (max - min));
  };
  const fraction = (v: number) => (v - min) / (max - min);
  const boxStyle = (v: number, on: boolean): CSSProperties => ({
    position: 'absolute', top: 0, bottom: 0, width: RANGE_BOX, left: `calc(${fraction(v) * 100}% - ${RANGE_BOX / 2}px)`,
    background: on ? INK : '#3a4150', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none',
  });
  return (
    <div role='group' aria-label={label}
      onPointerDown={event => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const f = frameAt(event.clientX);
        active.current = Math.abs(f - start) <= Math.abs(f - end) && !(f > end) ? 0 : 1;
        set(active.current, f);
      }}
      onPointerMove={event => {
        if (active.current !== null && event.currentTarget.hasPointerCapture(event.pointerId)) set(active.current, frameAt(event.clientX));
      }}
      onPointerUp={() => {
        active.current = null;
      }}
      style={{ flex: 1, padding: `0 ${RANGE_BOX / 2}px`, cursor: 'pointer', touchAction: 'none', userSelect: 'none' }}>
      <div ref={track} style={{ position: 'relative', height: 36, background: '#eceff3' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${fraction(start) * 100}%`, width: `${(fraction(end) - fraction(start)) * 100}%`, background: '#dde2e8' }}/>
        <div style={boxStyle(start, active.current === 0)} aria-label={`${label} start`}>{start}</div>
        <div style={boxStyle(end, active.current === 1)} aria-label={`${label} end`}>{end}</div>
      </div>
    </div>
  );
}
