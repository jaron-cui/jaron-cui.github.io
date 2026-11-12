// What every generator section on the gears page shares: the section layout, parameter fields,
// drawing sheets on a 10 mm grid, dimension lines and labels, and the dimension table. Drawings are
// static: each fits its contents to the sheet and draws in pixels, so text and arrows keep their size.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, InputAdornment, TextField } from '@mui/material';
import { Col, Row, Table } from 'react-bootstrap';
import { Download } from 'react-bootstrap-icons';
import { downloadFile } from '../../../lib/psave/files';
import { BUTTON_STYLE, DEFAULT_FONT } from '../../../util/styles';
import type { Vec2 } from './profile';

export const INK = '#222222';
export const MUTED = '#777777';
export const DIM = '#1f4e8c';
export const WARN = '#b5530b';
export const GEAR_FILL = '#e4e4e4';
export const MATE_FILL = '#d3dceb';
export const PITCH = '#2e7d4f';
export const BASE = '#7a4fb0';
export const VIEW_HEIGHT = 460;

export const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
export const polar = (r: number, angle: number): Vec2 => ({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
// Turns points a quarter turn counterclockwise, so tooth 0 (on +x) points up.
export const turnUp = (points: Vec2[]): Vec2[] => points.map(p => ({ x: -p.y, y: p.x }));

// State remembered in localStorage, merged over the defaults so new fields get their default values.
export function usePersistent<T extends object>(key: string, defaults: T): [T, (patch: Partial<T>) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (saved && typeof saved === 'object') {
        return { ...defaults, ...saved };
      }
    } catch {
      // No storage, or something unreadable in it: start from the defaults.
    }
    return defaults;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Remembering the last values is only a convenience.
    }
  }, [key, value]);
  return [value, patch => setValue(v => ({ ...v, ...patch })), () => setValue(defaults)];
}

// One generator: a heading and blurb, its fields and buttons on the left, its drawings and table on
// the right.
export function GeneratorSection({ id, title, blurb, fields, actions, notes, children }: {
  id: string; title: string; blurb: ReactNode; fields: ReactNode; actions: ReactNode; notes: string[]; children: ReactNode;
}) {
  return (
    <section id={id} style={{ marginBottom: 56 }}>
      <h5 style={{ marginBottom: 6 }}>{title}</h5>
      <p style={{ color: MUTED, maxWidth: 760 }}>{blurb}</p>
      <Row>
        <Col lg={3} md={4} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{fields}</div>
          {notes.map(note => <p key={note} style={{ color: WARN, fontSize: 14, marginTop: 12, marginBottom: 0 }}>{note}</p>)}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>{actions}</div>
        </Col>
        <Col lg={9} md={8}>{children}</Col>
      </Row>
    </section>
  );
}

export function SiteButton({ onClick, children, download }: { onClick: () => void; children: ReactNode; download?: boolean }) {
  return (
    <Button sx={{ ...BUTTON_STYLE, color: INK, textTransform: 'none', fontFamily: 'inherit' }} startIcon={download ? <Download size={14}/> : undefined} onClick={onClick}>
      {children}
    </Button>
  );
}

export function ExportButton({ label, name, svg }: { label: string; name: string; svg: () => string }) {
  return <SiteButton download onClick={() => downloadFile(name, svg(), 'image/svg+xml')}>{label}</SiteButton>;
}

// A number field that applies each valid value as it is typed and clamps it on blur.
export function NumberField({ label, unit, value, min, max, integer, onChange }: {
  label: ReactNode; unit?: string; value: number; min: number; max: number; integer?: boolean; onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(current => (Number(current) === value ? current : String(value)));
  }, [value]);
  const clamp = (v: number) => Math.min(max, Math.max(min, integer ? Math.round(v) : v));
  return (
    <TextField size='small' type='number' label={label} value={text}
      onChange={e => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v) && clamp(v) === v) {
          onChange(v);
        }
      }}
      onBlur={() => {
        const v = Number(text);
        const next = text.trim() !== '' && Number.isFinite(v) ? clamp(v) : value;
        onChange(next);
        setText(String(next));
      }}
      InputProps={{ endAdornment: unit ? <InputAdornment position='end'>{unit}</InputAdornment> : undefined }}/>
  );
}

export function FieldGroup({ title }: { title: string }) {
  return <div style={{ color: MUTED, fontSize: 14, marginTop: 4 }}>{title}</div>;
}

export function Caption({ children }: { children: ReactNode }) {
  return <div style={{ color: MUTED, fontSize: 14, marginBottom: 4 }}>{children}</div>;
}

export type Size = { w: number; h: number };

// A white drawing sheet that measures itself and draws its contents at that size.
export function Sheet({ children, height = VIEW_HEIGHT }: { children: (size: Size) => ReactNode; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ height, border: '1px solid #dddddd', borderRadius: 3, background: '#ffffff', overflow: 'hidden' }}>
      {width > 0 && (
        <svg width={width} height={height} style={{ display: 'block' }}>
          {children({ w: width, h: height })}
        </svg>
      )}
    </div>
  );
}

// World millimeters (y up) to sheet pixels.
export type View = { x: number; y: number; z: number; size: Size };
export const toScreen = (v: View, p: Vec2): Vec2 => ({ x: v.size.w / 2 + (p.x - v.x) * v.z, y: v.size.h / 2 - (p.y - v.y) * v.z });

export type Box = { left: number; right: number; bottom: number; top: number };

// Fits a world box into the sheet, leaving pixel margins for the dimensions.
export function fitView(size: Size, box: Box, pad: { left: number; right: number; top: number; bottom: number }): View {
  const z = Math.min((size.w - pad.left - pad.right) / (box.right - box.left), (size.h - pad.top - pad.bottom) / (box.top - box.bottom));
  return {
    x: (box.left + box.right) / 2 + (pad.right - pad.left) / 2 / z,
    y: (box.top + box.bottom) / 2 + (pad.top - pad.bottom) / 2 / z,
    z,
    size,
  };
}

export const boxOf = (points: Vec2[]): Box => ({
  left: Math.min(...points.map(p => p.x)),
  right: Math.max(...points.map(p => p.x)),
  bottom: Math.min(...points.map(p => p.y)),
  top: Math.max(...points.map(p => p.y)),
});

// 10 mm lines, with 1 mm lines between them once those are far enough apart to read.
export function Grid({ view }: { view: View }) {
  const { size, z } = view;
  const left = view.x - size.w / 2 / z;
  const right = view.x + size.w / 2 / z;
  const bottom = view.y - size.h / 2 / z;
  const top = view.y + size.h / 2 / z;
  const lines: ReactNode[] = [];
  const spacings: [number, string][] = z >= 7 ? [[1, '#f1f1f1'], [10, '#d6d6d6']] : [[10, '#d6d6d6']];
  for (const [step, color] of spacings) {
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      if (step === 1 && Math.round(x) % 10 === 0) continue;
      const sx = toScreen(view, { x, y: 0 }).x;
      lines.push(<line key={`x${step}${x}`} x1={sx} x2={sx} y1={0} y2={size.h} stroke={color} strokeWidth={1}/>);
    }
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      if (step === 1 && Math.round(y) % 10 === 0) continue;
      const sy = toScreen(view, { x: 0, y }).y;
      lines.push(<line key={`y${step}${y}`} x1={0} x2={size.w} y1={sy} y2={sy} stroke={color} strokeWidth={1}/>);
    }
  }
  return <g shapeRendering='crispEdges'>{lines}</g>;
}

// A 10 mm bar in the corner. Draw it last so nothing covers it.
export function ScaleBar({ view }: { view: View }) {
  const bar = 10 * view.z;
  return (
    <g transform={`translate(12 ${view.size.h - 14})`}>
      <line x1={0} x2={bar} y1={0} y2={0} stroke={INK} strokeWidth={2}/>
      <line x1={0} x2={0} y1={-4} y2={4} stroke={INK}/>
      <line x1={bar} x2={bar} y1={-4} y2={4} stroke={INK}/>
      <Label x={bar + 6} y={4} anchor='start'>10 mm</Label>
    </g>
  );
}

export const pathOf = (view: View, points: Vec2[], close = true) =>
  points.map((p, i) => {
    const s = toScreen(view, p);
    return `${i ? 'L' : 'M'}${s.x.toFixed(2)} ${s.y.toFixed(2)}`;
  }).join('') + (close ? 'Z' : '');

// A filled part: loops of world points, filled even-odd so inner loops are holes, plus round holes.
export function Part({ view, loops, holes = [], fill = GEAR_FILL }: { view: View; loops: Vec2[][]; holes?: { center: Vec2; r: number }[]; fill?: string }) {
  return (
    <>
      <path d={loops.map(loop => pathOf(view, loop)).join('')} fill={fill} fillOpacity={0.85} fillRule='evenodd' stroke={INK} strokeWidth={1.2} strokeLinejoin='round'/>
      {holes.filter(h => h.r > 0).map(({ center, r }, i) => {
        const c = toScreen(view, center);
        return <circle key={i} cx={c.x} cy={c.y} r={r * view.z} fill='#ffffff' stroke={INK} strokeWidth={1.2}/>;
      })}
    </>
  );
}

export function Circle({ view, r, center = { x: 0, y: 0 }, color, dash }: { view: View; r: number; center?: Vec2; color: string; dash?: string }) {
  const c = toScreen(view, center);
  return <circle cx={c.x} cy={c.y} r={r * view.z} fill='none' stroke={color} strokeWidth={1} strokeDasharray={dash}/>;
}

export const CENTER_DASH = '10 3 2 3';

// Horizontal and vertical center lines through a point, reaching `reach` mm each way.
export function CenterMark({ view, center = { x: 0, y: 0 }, reach }: { view: View; center?: Vec2; reach: number }) {
  const c = toScreen(view, center);
  const r = reach * view.z;
  return (
    <>
      <line x1={c.x - r} x2={c.x + r} y1={c.y} y2={c.y} stroke={MUTED} strokeWidth={0.8} strokeDasharray={CENTER_DASH}/>
      <line y1={c.y - r} y2={c.y + r} x1={c.x} x2={c.x} stroke={MUTED} strokeWidth={0.8} strokeDasharray={CENTER_DASH}/>
    </>
  );
}

// Text with a white halo, so it reads over the grid and the parts.
export function Label({ x, y, anchor = 'middle', children, color = DIM, size = 13 }: {
  x: number; y: number; anchor?: 'start' | 'middle' | 'end'; children: ReactNode; color?: string; size?: number;
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fill={color} stroke='#ffffff' strokeWidth={4} strokeLinejoin='round' paintOrder='stroke'
      style={{ fontFamily: DEFAULT_FONT.fontFamily }}>
      {children}
    </text>
  );
}

// A symbol (with an optional subscript) and its value, as one label.
export function DimText({ x, y, anchor = 'middle', name, sub, value }: { x: number; y: number; anchor?: 'start' | 'middle' | 'end'; name: string; sub?: string; value: string }) {
  return (
    <Label x={x} y={y} anchor={anchor}>
      <tspan fontStyle='italic'>{name}</tspan>
      {sub && <tspan fontStyle='italic' fontSize={10} dy={3}>{sub}</tspan>}
      <tspan dy={sub ? -3 : 0}>{` ${value}`}</tspan>
    </Label>
  );
}

// An arrowhead at `tip`, pointing away from `toward`.
export function Arrow({ tip, toward }: { tip: Vec2; toward: Vec2 }) {
  const dx = tip.x - toward.x;
  const dy = tip.y - toward.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const L = 8;
  const W = 3;
  return <path d={`M${tip.x} ${tip.y}L${tip.x - ux * L - uy * W} ${tip.y - uy * L + ux * W}L${tip.x - ux * L + uy * W} ${tip.y - uy * L - ux * W}Z`} fill={DIM}/>;
}

export function Line({ a, b, dash, width = 1, color = DIM }: { a: Vec2; b: Vec2; dash?: string; width?: number; color?: string }) {
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeDasharray={dash}/>;
}

// A dimension line between two screen points with arrows at both ends.
export function DimLine({ a, b }: { a: Vec2; b: Vec2 }) {
  return (
    <>
      <Line a={a} b={b}/>
      <Arrow tip={a} toward={b}/>
      <Arrow tip={b} toward={a}/>
    </>
  );
}

// A screen-space arc of points around `center`, from angle `from` to `to` (radians, screen axes).
export function screenArc(center: Vec2, radius: number, from: number, to: number, steps = 24): Vec2[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps;
    return { x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) };
  });
}

export const screenPath = (points: Vec2[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');

// An arc dimension with arrows at both ends.
export function ArcDim({ points }: { points: Vec2[] }) {
  const n = points.length - 1;
  return (
    <>
      <path d={screenPath(points)} fill='none' stroke={DIM} strokeWidth={1}/>
      <Arrow tip={points[0]} toward={points[1]}/>
      <Arrow tip={points[n]} toward={points[n - 1]}/>
    </>
  );
}

// An angle marked at a screen point between two screen directions (unit vectors), with its label
// just outside the arc. Takes the shorter way around.
export function AngleMark({ at, from, to, radius, label }: { at: Vec2; from: Vec2; to: Vec2; radius: number; label: ReactNode }) {
  const a = Math.atan2(from.y, from.x);
  let b = Math.atan2(to.y, to.x);
  if (b - a > Math.PI) b -= 2 * Math.PI;
  if (a - b > Math.PI) b += 2 * Math.PI;
  const mid = (a + b) / 2;
  const lx = at.x + (radius + 10) * Math.cos(mid);
  return (
    <>
      <path d={screenPath(screenArc(at, radius, a, b))} fill='none' stroke={DIM} strokeWidth={1}/>
      <g transform={`translate(${lx} ${at.y + (radius + 10) * Math.sin(mid) + 4})`}>
        <g textAnchor={Math.cos(mid) >= 0 ? 'start' : 'end'}>{label}</g>
      </g>
    </>
  );
}

// A horizontal diameter dimension at screen height `y`, for a circle of radius `r` mm around a world
// center, with extension lines from the circle's sides. A label too wide for the line sits beside it.
export function DiameterDim({ view, center = { x: 0, y: 0 }, r, y, name }: { view: View; center?: Vec2; r: number; y: number; name: string }) {
  const c = toScreen(view, center);
  const a = { x: c.x - r * view.z, y };
  const b = { x: c.x + r * view.z, y };
  const reach = y < c.y ? -5 : 5;
  const text = `${name} ${fmt(2 * r)}`;
  const width = text.length * 7;
  const inside = width < b.x - a.x - 16;
  const right = b.x + 8 + width < view.size.w;
  return (
    <g>
      <Line a={{ x: a.x, y: c.y }} b={{ x: a.x, y: y + reach }} width={0.6}/>
      <Line a={{ x: b.x, y: c.y }} b={{ x: b.x, y: y + reach }} width={0.6}/>
      <DimLine a={a} b={b}/>
      <Label x={inside ? c.x : right ? b.x + 8 : a.x - 8} y={inside ? y - 5 : y + 4} anchor={inside ? 'middle' : right ? 'start' : 'end'}>{text}</Label>
    </g>
  );
}

// A straight dimension between two world points, drawn `offset` pixels to the left of the direction
// a → b, with extension lines and a label beside its middle.
export function LinearDim({ view, a, b, offset, label, labelSide = 1 }: { view: View; a: Vec2; b: Vec2; offset: number; label: ReactNode; labelSide?: 1 | -1 }) {
  const sa = toScreen(view, a);
  const sb = toScreen(view, b);
  const d = { x: sb.x - sa.x, y: sb.y - sa.y };
  const len = Math.hypot(d.x, d.y) || 1;
  // Left of a → b on screen (y down), so the offset reads the same as in world axes.
  const n = { x: d.y / len, y: -d.x / len };
  const pa = { x: sa.x + n.x * offset, y: sa.y + n.y * offset };
  const pb = { x: sb.x + n.x * offset, y: sb.y + n.y * offset };
  const sign = Math.sign(offset) || 1;
  const mid = { x: (pa.x + pb.x) / 2 + n.x * sign * labelSide * 10, y: (pa.y + pb.y) / 2 + n.y * sign * labelSide * 10 + 4 };
  const anchor = Math.abs(n.x) < 0.3 ? 'middle' : (n.x * sign * labelSide > 0 ? 'start' : 'end');
  return (
    <g>
      <Line a={sa} b={{ x: pa.x + n.x * sign * 5, y: pa.y + n.y * sign * 5 }} width={0.6}/>
      <Line a={sb} b={{ x: pb.x + n.x * sign * 5, y: pb.y + n.y * sign * 5 }} width={0.6}/>
      <DimLine a={pa} b={pb}/>
      <g transform={`translate(${mid.x} ${mid.y})`}><g textAnchor={anchor}>{label}</g></g>
    </g>
  );
}

// A label's contents for use inside a positioned group: symbol, optional subscript, value.
export function Sym({ name, sub, value }: { name: string; sub?: string; value: string }) {
  return (
    <text fontSize={13} fill={DIM} stroke='#ffffff' strokeWidth={4} strokeLinejoin='round' paintOrder='stroke' style={{ fontFamily: DEFAULT_FONT.fontFamily }}>
      <tspan fontStyle='italic'>{name}</tspan>
      {sub && <tspan fontStyle='italic' fontSize={10} dy={3}>{sub}</tspan>}
      <tspan dy={sub ? -3 : 0}>{` ${value}`}</tspan>
    </text>
  );
}

export type DimensionRow = { symbol: ReactNode; name: string; value: string; formula: ReactNode };

// Every dimension in a section's drawings, with the formula relating it to the parameters.
export function DimensionTable({ rows }: { rows: DimensionRow[] }) {
  return (
    <Table size='sm' style={{ fontSize: 14, marginTop: 8 }}>
      <thead>
        <tr><th></th><th>Dimension</th><th style={{ textAlign: 'right' }}>mm</th><th>From the parameters</th></tr>
      </thead>
      <tbody>
        {rows.map(({ symbol, name, value, formula }) => (
          <tr key={name}>
            <td style={{ fontStyle: 'italic', color: DIM }}>{symbol}</td>
            <td>{name}</td>
            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</td>
            <td style={{ color: MUTED }}>{formula}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// Names a circle where it leaves the sheet's left edge.
export function CircleName({ view, r, center = { x: 0, y: 0 }, name, color }: { view: View; r: number; center?: Vec2; name: string; color: string }) {
  const leftX = view.x - view.size.w / 2 / view.z + 4 / view.z - center.x;
  if (Math.abs(leftX) >= r) return null;
  const p = toScreen(view, { x: center.x + leftX, y: center.y + Math.sqrt(r * r - leftX * leftX) });
  return (
    <text x={p.x} y={p.y - 4} fontSize={11} fill={color} stroke='#ffffff' strokeWidth={3} paintOrder='stroke' style={{ fontFamily: DEFAULT_FONT.fontFamily }}>
      {name}
    </text>
  );
}
