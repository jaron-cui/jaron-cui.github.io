// Drawing a GraphEd document as SVG: connections whose width and colour follow their source's
// activity, and nodes filled by their units' activity. Shared by the editor and read-only views.
import { useMemo } from 'react';
import type { JSX } from 'react';
import { buildIndex, pathOf, rimPoint, routeFor, slice, unitCenter } from './model';
import type { GraphDoc, Route } from './model';

export const INK = '#1d2330';
const SELECT = '#e0a100';
// A signal takes one tick to cross a connection, so a line is drawn in pieces, each showing its
// source's activity from as long ago as the signal takes to get that far.
const CHUNKS = 6;

// A unit's activity (0..1), `lag` ticks in the past.
export type ValueAt = (unit: string, lag?: number) => number;

// A unit's fill: its colour at an opacity that rises with activity, from a floor that is higher
// without borders so a resting node still shows on white.
const fillFor = (a: number, rgb = '29, 35, 48', rest = 0.07) => `rgba(${rgb}, ${(rest + (0.92 - rest) * a).toFixed(3)})`;
const textFor = (a: number) => (a > 0.5 ? '#ffffff' : INK);
const mix = (p: number[], q: number[], t: number) => `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',')})`;

// Excitatory red, inhibitory blue; pale and thin at rest, dark and wide when active.
function look(doc: GraphDoc, weight: number, a: number) {
  const exc = weight > 0;
  const t = Math.max(0, Math.min(1, a));
  const base = (0.7 + 1.2 * Math.sqrt(Math.abs(weight))) * doc.style.lineWidth;
  return { color: mix(exc ? [240, 196, 196] : [190, 208, 238], exc ? [196, 32, 32] : [28, 78, 196], t), width: base * (1 + 1.1 * t) };
}

export function routesOf(doc: GraphDoc): Record<string, Route | null> {
  const index = buildIndex(doc);
  const out: Record<string, Route | null> = {};
  for (const id of Object.keys(doc.connections)) out[id] = routeFor(doc, index, id);
  return out;
}

export function connectionLines(doc: GraphDoc, routes: Record<string, Route | null>, value: ValueAt, highlight: string[] = []): JSX.Element[] {
  const out: JSX.Element[] = [];
  for (const c of Object.values(doc.connections)) {
    const r = routes[c.id];
    if (!r) continue;
    const exc = c.weight > 0;
    const n = { x: -r.dir.y, y: r.dir.x };
    const end = r.end;
    // The terminal shows what the target receives now: the activity that left one tick ago.
    const arriving = look(doc, c.weight, value(c.from, 1));
    const tip = exc
      ? `M${end.x} ${end.y}L${end.x - r.dir.x * 9 + n.x * 5} ${end.y - r.dir.y * 9 + n.y * 5}L${end.x - r.dir.x * 9 - n.x * 5} ${end.y - r.dir.y * 9 - n.y * 5}Z`
      : `M${end.x + n.x * 7} ${end.y + n.y * 7}L${end.x - n.x * 7} ${end.y - n.y * 7}`;
    const pieces = [];
    for (let i = CHUNKS - 1; i >= 0; i--) {
      const piece = look(doc, c.weight, value(c.from, (i + 0.5) / CHUNKS));
      pieces.push(<path key={i} d={pathOf(slice(r, i / CHUNKS, (i + 1) / CHUNKS))} fill='none' stroke={piece.color} strokeWidth={piece.width} strokeLinecap='round' strokeLinejoin='round'/>);
    }
    out.push(
      <g key={c.id}>
        {highlight.includes(c.id) && <path d={pathOf(r.points)} fill='none' stroke={SELECT} strokeOpacity={0.4} strokeWidth={9} strokeLinecap='round' strokeLinejoin='round'/>}
        {pieces}
        <path d={tip} fill={exc ? arriving.color : 'none'} stroke={arriving.color} strokeWidth={exc ? 1 : 3} strokeLinecap='round' strokeLinejoin='round'/>
      </g>,
    );
  }
  return out;
}

// With `showText` false, nothing is labelled: for small views.
export function nodeShapes(doc: GraphDoc, value: ValueAt, caption: (node: string) => string | null, selected: Set<string> = new Set(), showText = true): JSX.Element[] {
  const borders = doc.style.borders ?? true;
  const stroke = borders ? INK : 'none';
  const rest = borders ? 0.07 : 0.28;
  const fill = (a: number, rgb?: string) => fillFor(a, rgb, rest);
  return Object.values(doc.nodes).map(n => {
    const text = showText ? caption(n.id) : null;
    let body: JSX.Element;
    if (n.shape === 'split') {
      const halves = n.units.slice(0, 2).map((unit, i) => {
        const a = value(unit.id);
        const p1 = rimPoint(n, n.angle + (i ? 90 : -90));
        const p2 = rimPoint(n, n.angle + (i ? 270 : 90));
        const c = unitCenter(n, unit.id);
        return (
          <g key={unit.id}>
            <path d={`M${p1.x} ${p1.y}A${n.r} ${n.r} 0 0 1 ${p2.x} ${p2.y}Z`} fill={fill(a, unit.color)} stroke={stroke} strokeWidth={2}/>
            {showText && <text x={c.x} y={c.y} fontSize={Math.max(8, n.r * 0.26)} fontWeight={500} fill={textFor(a)} textAnchor='middle' dominantBaseline='central'>{unit.label}</text>}
          </g>
        );
      });
      body = <>{halves}</>;
    } else if (n.shape === 'box') {
      const a = value(n.units[0]?.id ?? n.id);
      // Text shrinks to fit the box: about 0.58 em per character, and a share of the height.
      const fit = (size: number, chars: number, share: number) => Math.min(size, (n.w * 0.88) / (Math.max(1, chars) * 0.58), n.h * share);
      const both = showText && n.labelAt === 'inside' && text;
      body = (
        <>
          <rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={Math.min(10, n.h / 4)} fill={fill(a, n.units[0]?.color)} stroke={stroke} strokeWidth={2}/>
          {showText && n.labelAt === 'inside' && <text x={n.x} y={both ? n.y - n.h * 0.2 : n.y} fontSize={fit(11, n.label.length, both ? 0.3 : 0.5)} fontWeight={500} fill={textFor(a)} textAnchor='middle' dominantBaseline='central'>{n.label}</text>}
          {text && <text x={n.x} y={both ? n.y + n.h * 0.17 : n.y} fontSize={fit(18, text.length, both ? 0.42 : 0.6)} fontWeight={600} fill={textFor(a)} textAnchor='middle' dominantBaseline='central'>{text}</text>}
        </>
      );
    } else {
      const a = value(n.units[0]?.id ?? n.id);
      body = (
        <>
          <circle cx={n.x} cy={n.y} r={n.r} fill={fill(a, n.units[0]?.color)} stroke={stroke} strokeWidth={1.5}/>
          {showText && n.labelAt === 'inside' && <text x={n.x} y={n.y} fontSize={Math.max(6, n.r * 0.68)} fontWeight={600} fill={textFor(a)} textAnchor='middle' dominantBaseline='central'>{n.label}</text>}
        </>
      );
    }
    let pill: JSX.Element | null = null;
    if (showText && n.labelAt !== 'inside' && n.labelAt !== 'none' && n.label) {
      const half = n.shape === 'box' ? { x: n.w / 2, y: n.h / 2 } : { x: n.r, y: n.r };
      const at = { left: { x: n.x - half.x, y: n.y }, right: { x: n.x + half.x, y: n.y }, top: { x: n.x, y: n.y - half.y }, bottom: { x: n.x, y: n.y + half.y } }[n.labelAt];
      const pw = Math.max(30, n.label.length * 8 + 12);
      pill = (
        <g>
          <rect x={at.x - pw / 2} y={at.y - 11} width={pw} height={22} rx={11} fill='#ffffff' stroke={INK} strokeWidth={1.5}/>
          <text x={at.x} y={at.y} fontSize={12} fontWeight={600} fill={INK} textAnchor='middle' dominantBaseline='central'>{n.label}</text>
        </g>
      );
    }
    const outline = selected.has(n.id) && (n.shape === 'box'
      ? <rect x={n.x - n.w / 2 - 5} y={n.y - n.h / 2 - 5} width={n.w + 10} height={n.h + 10} rx={14} fill='none' stroke={SELECT} strokeWidth={2} strokeDasharray='5 4' vectorEffect='non-scaling-stroke'/>
      : <circle cx={n.x} cy={n.y} r={n.r + 5} fill='none' stroke={SELECT} strokeWidth={2} strokeDasharray='5 4' vectorEffect='non-scaling-stroke'/>);
    return <g key={n.id}>{body}{pill}{outline}</g>;
  });
}

// The area a document's drawing covers: nodes with their label pills, and wire.
export function bounds(doc: GraphDoc, routes: Record<string, Route | null>, showText = true) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of Object.values(doc.nodes)) {
    const half = n.shape === 'box' ? { x: n.w / 2, y: n.h / 2 } : { x: n.r, y: n.r };
    const pill = (n.labelAt === 'left' || n.labelAt === 'right') && showText ? Math.max(30, n.label.length * 8 + 12) / 2 : 0;
    xs.push(n.x - half.x - (n.labelAt === 'left' ? pill : 0), n.x + half.x + (n.labelAt === 'right' ? pill : 0));
    ys.push(n.y - half.y - (n.labelAt === 'top' && showText ? 11 : 0), n.y + half.y + (n.labelAt === 'bottom' && showText ? 11 : 0));
  }
  for (const r of Object.values(routes)) {
    if (!r) continue;
    for (const p of r.points) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (!xs.length) return { x: -100, y: -100, width: 200, height: 200 };
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 };
}

// A read-only, animated drawing of a document, scaled to fit its box.
export function GraphView({ doc, value, caption = () => null, padding = 12, showText = true }: {
  doc: GraphDoc; value: ValueAt; caption?: (node: string) => string | null; padding?: number; showText?: boolean;
}) {
  const routes = useMemo(() => routesOf(doc), [doc]);
  const box = useMemo(() => bounds(doc, routes, showText), [doc, routes, showText]);
  return (
    <svg viewBox={`${box.x - padding} ${box.y - padding} ${box.width + 2 * padding} ${box.height + 2 * padding}`}
      style={{ width: '100%', height: '100%', display: 'block' }} fontFamily='Inter, system-ui, sans-serif' role='img'
      aria-label={doc.name}>
      {connectionLines(doc, routes, value)}
      {nodeShapes(doc, value, caption, undefined, showText)}
    </svg>
  );
}
