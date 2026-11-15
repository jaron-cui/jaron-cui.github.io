// SVG import: each shape becomes a mesh object, with its anchor points as vertices, its segments as
// lines that curve the way SVG's do (curves.ts), and its filled areas as faces. Holes, found by the
// fill rule, are bridged into their face with a zero-width cut. Shapes lie in the plane the front view
// faces, scaled to about 400 units across, and later elements sit slightly nearer the camera so SVG's
// painting order holds.
//
// Parsing and geometry are plain functions over text and numbers; only collectShapes() reads a DOM.
import type { Edge, Face, Rgb, Vec3 } from '../../../lib/vrender/model';
import { curveAt, setCurve, splitCurve } from './curves';
import { addFolder, addObject, renameFolder, updateObject } from './document';
import type { EditorDocument } from './document';
import type { CurveShape, EdgeCurve } from './curves';

export type Point = { x: number; y: number };
export type Segment =
  | { kind: 'line'; to: Point }
  | { kind: 'quadratic'; control: Point; to: Point }
  | { kind: 'cubic'; c1: Point; c2: Point; to: Point }
  // rotation in degrees, as SVG writes it.
  | { kind: 'arc'; rx: number; ry: number; rotation: number; large: boolean; sweep: boolean; to: Point };
export type Subpath = { start: Point; segments: Segment[]; closed: boolean };

// ---- Path data ----

// Every SVG path command, absolute and relative, with implicit repeats, H/V, the smooth S/T forms,
// and arc flags written without separators.
export function parsePathData(d: string): Subpath[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  const subpaths: Subpath[] = [];
  // Set in begin(), which TypeScript can't see through, hence the cast.
  let current = null as Subpath | null;
  let point: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  // The last control point, for S and T, and which kind of segment made it.
  let lastControl: Point | null = null;
  let lastKind: 'cubic' | 'quadratic' | null = null;
  let command = '';
  const isCommand = (t: string | undefined) => t !== undefined && /^[a-zA-Z]$/.test(t);
  const number = () => Number(tokens[i++]);
  // An arc flag may be glued to what follows ("01" is two flags), so it's read one character at a time.
  const flag = () => {
    const t = tokens[i];
    if (t.length > 1 && (t[0] === '0' || t[0] === '1')) {
      tokens[i] = t.slice(1);
      return t[0] === '1';
    }
    i++;
    return t === '1';
  };
  const begin = (at: Point) => {
    current = { start: at, segments: [], closed: false };
    subpaths.push(current);
    start = at;
  };
  const add = (segment: Segment) => {
    if (!current) begin(point);
    current!.segments.push(segment);
    point = segment.to;
  };
  while (i < tokens.length) {
    if (isCommand(tokens[i])) {
      command = tokens[i++];
    } else if (!command) {
      i++;
      continue;
    }
    const relative = command === command.toLowerCase();
    const at = (x: number, y: number): Point => (relative ? { x: point.x + x, y: point.y + y } : { x, y });
    const upper = command.toUpperCase();
    if (upper === 'Z') {
      if (current) {
        current.closed = true;
        point = start;
        current = null;
      }
      lastKind = null;
      continue;
    }
    if (upper === 'M') {
      const to = at(number(), number());
      point = to;
      begin(to);
      // Further pairs after a move are lines.
      command = relative ? 'l' : 'L';
      lastKind = null;
      continue;
    }
    if (upper === 'L') {
      add({ kind: 'line', to: at(number(), number()) });
      lastKind = null;
    } else if (upper === 'H') {
      const x = number();
      add({ kind: 'line', to: { x: relative ? point.x + x : x, y: point.y } });
      lastKind = null;
    } else if (upper === 'V') {
      const y = number();
      add({ kind: 'line', to: { x: point.x, y: relative ? point.y + y : y } });
      lastKind = null;
    } else if (upper === 'C' || upper === 'S') {
      const c1: Point = upper === 'C'
        ? at(number(), number())
        : lastKind === 'cubic' && lastControl ? { x: 2 * point.x - lastControl.x, y: 2 * point.y - lastControl.y } : point;
      const c2 = at(number(), number());
      const to = at(number(), number());
      add({ kind: 'cubic', c1, c2, to });
      lastControl = c2;
      lastKind = 'cubic';
    } else if (upper === 'Q' || upper === 'T') {
      const control: Point = upper === 'Q'
        ? at(number(), number())
        : lastKind === 'quadratic' && lastControl ? { x: 2 * point.x - lastControl.x, y: 2 * point.y - lastControl.y } : point;
      const to = at(number(), number());
      add({ kind: 'quadratic', control, to });
      lastControl = control;
      lastKind = 'quadratic';
    } else if (upper === 'A') {
      const rx = number();
      const ry = number();
      const rotation = number();
      const large = flag();
      const sweep = flag();
      const to = at(number(), number());
      add({ kind: 'arc', rx, ry, rotation, large, sweep, to });
      lastKind = null;
    } else {
      // An unknown command: skip its numbers.
      while (i < tokens.length && !isCommand(tokens[i])) i++;
    }
    if (Number.isNaN(point.x) || Number.isNaN(point.y)) break;
  }
  return subpaths.filter(s => s.segments.length > 0 || s.closed);
}

// ---- Transforms: [a, b, c, d, e, f], mapping (x, y) to (a x + c y + e, b x + d y + f). ----

export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function multiplyAffine(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function parseTransform(text: string | null | undefined): Affine {
  let result = IDENTITY;
  if (!text) return result;
  for (const [, name, args] of text.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = (args.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let m: Affine = IDENTITY;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    if (name === 'matrix' && v.length === 6) m = v as Affine;
    else if (name === 'translate') m = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (name === 'scale') m = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (name === 'rotate') {
      const [c, s] = [Math.cos(rad(v[0] ?? 0)), Math.sin(rad(v[0] ?? 0))];
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      m = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
    } else if (name === 'skewX') m = [1, 0, Math.tan(rad(v[0] ?? 0)), 1, 0, 0];
    else if (name === 'skewY') m = [1, Math.tan(rad(v[0] ?? 0)), 0, 1, 0, 0];
    result = multiplyAffine(result, m);
  }
  return result;
}

const apply = (m: Affine, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

// An arc after an affine map: its ellipse maps to another ellipse, whose radii and turn come from the
// singular values of the map times the ellipse's own frame. A reflection reverses the sweep.
function transformArc(m: Affine, segment: Extract<Segment, { kind: 'arc' }>): Extract<Segment, { kind: 'arc' }> {
  const phi = (segment.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(phi), Math.sin(phi)];
  // The 2×2 map times R(φ)·diag(rx, ry).
  const a = (m[0] * c + m[2] * s) * segment.rx;
  const b = (m[1] * c + m[3] * s) * segment.rx;
  const cc = (-m[0] * s + m[2] * c) * segment.ry;
  const d = (-m[1] * s + m[3] * c) * segment.ry;
  // Singular values of [[a, cc], [b, d]].
  const e = (a + d) / 2, f = (a - d) / 2, g = (b + cc) / 2, h = (b - cc) / 2;
  const q = Math.hypot(e, h), r = Math.hypot(f, g);
  const sx = q + r, sy = Math.abs(q - r);
  const angle = (Math.atan2(g, f) + Math.atan2(h, e)) / 2;
  const det = m[0] * m[3] - m[1] * m[2];
  return {
    kind: 'arc', rx: sx, ry: sy, rotation: (angle * 180) / Math.PI, large: segment.large,
    sweep: det < 0 ? !segment.sweep : segment.sweep, to: apply(m, segment.to),
  };
}

export function transformSubpaths(m: Affine, subpaths: Subpath[]): Subpath[] {
  if (m.every((v, i) => v === IDENTITY[i])) return subpaths;
  return subpaths.map(({ start, segments, closed }) => ({
    start: apply(m, start),
    closed,
    segments: segments.map((s): Segment => {
      if (s.kind === 'line') return { kind: 'line', to: apply(m, s.to) };
      if (s.kind === 'quadratic') return { kind: 'quadratic', control: apply(m, s.control), to: apply(m, s.to) };
      if (s.kind === 'cubic') return { kind: 'cubic', c1: apply(m, s.c1), c2: apply(m, s.c2), to: apply(m, s.to) };
      return transformArc(m, s);
    }),
  }));
}

// ---- Shapes ----

const num = (v: string | null | undefined, fallback = 0) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
};

// The outline of a basic shape (rect, circle, ellipse, line, polyline, polygon) or a path.
export function shapeSubpaths(tag: string, attr: (name: string) => string | null): Subpath[] {
  const arcTo = (r: Point, to: Point): Segment => ({ kind: 'arc', rx: r.x, ry: r.y, rotation: 0, large: false, sweep: true, to });
  if (tag === 'path') return parsePathData(attr('d') ?? '');
  if (tag === 'rect') {
    const [x, y, w, h] = [num(attr('x')), num(attr('y')), num(attr('width')), num(attr('height'))];
    if (w <= 0 || h <= 0) return [];
    let rx = attr('rx') !== null ? num(attr('rx')) : NaN;
    let ry = attr('ry') !== null ? num(attr('ry')) : NaN;
    if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
    if (Number.isNaN(ry)) ry = rx;
    rx = Math.min(Math.max(rx, 0), w / 2);
    ry = Math.min(Math.max(ry, 0), h / 2);
    if (rx === 0 || ry === 0) {
      return [{ start: { x, y }, closed: true, segments: [{ kind: 'line', to: { x: x + w, y } }, { kind: 'line', to: { x: x + w, y: y + h } }, { kind: 'line', to: { x, y: y + h } }] }];
    }
    const r = { x: rx, y: ry };
    const segments: Segment[] = [
      { kind: 'line', to: { x: x + w - rx, y } }, arcTo(r, { x: x + w, y: y + ry }),
      { kind: 'line', to: { x: x + w, y: y + h - ry } }, arcTo(r, { x: x + w - rx, y: y + h }),
      { kind: 'line', to: { x: x + rx, y: y + h } }, arcTo(r, { x, y: y + h - ry }),
      { kind: 'line', to: { x, y: y + ry } }, arcTo(r, { x: x + rx, y }),
    ];
    return [{ start: { x: x + rx, y }, closed: true, segments }];
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const [cx, cy] = [num(attr('cx')), num(attr('cy'))];
    const rx = tag === 'circle' ? num(attr('r')) : num(attr('rx'));
    const ry = tag === 'circle' ? rx : num(attr('ry'));
    if (rx <= 0 || ry <= 0) return [];
    const r = { x: rx, y: ry };
    // Four quarter arcs, so no two segments share both ends.
    return [{
      start: { x: cx + rx, y: cy }, closed: true,
      segments: [arcTo(r, { x: cx, y: cy + ry }), arcTo(r, { x: cx - rx, y: cy }), arcTo(r, { x: cx, y: cy - ry }), arcTo(r, { x: cx + rx, y: cy })],
    }];
  }
  if (tag === 'line') {
    return [{ start: { x: num(attr('x1')), y: num(attr('y1')) }, closed: false, segments: [{ kind: 'line', to: { x: num(attr('x2')), y: num(attr('y2')) } }] }];
  }
  if (tag === 'polyline' || tag === 'polygon') {
    const v = (attr('points')?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    const points: Point[] = [];
    for (let k = 0; k + 1 < v.length; k += 2) points.push({ x: v[k], y: v[k + 1] });
    if (points.length < 2) return [];
    return [{ start: points[0], closed: tag === 'polygon', segments: points.slice(1).map((to): Segment => ({ kind: 'line', to })) }];
  }
  return [];
}

// ---- Styles ----

export type Style = { fill: Rgb | null; stroke: Rgb | null; strokeWidth: number; fillRule: 'nonzero' | 'evenodd'; visible: boolean };
export const DEFAULT_STYLE: Style = { fill: { r: 0, g: 0, b: 0 }, stroke: null, strokeWidth: 1, fillRule: 'nonzero', visible: true };

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', navy: '#000080', teal: '#008080',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff', pink: '#ffc0cb',
  brown: '#a52a2a', gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee', crimson: '#dc143c', coral: '#ff7f50', tomato: '#ff6347',
  salmon: '#fa8072', khaki: '#f0e68c', tan: '#d2b48c', beige: '#f5f5dc', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', skyblue: '#87ceeb', steelblue: '#4682b4', royalblue: '#4169e1', darkgreen: '#006400',
  forestgreen: '#228b22', seagreen: '#2e8b57', darkred: '#8b0000', darkblue: '#00008b', slategray: '#708090', whitesmoke: '#f5f5f5',
};

// A color, or null for none. Gradients and patterns, which can't be shown, fall back to gray.
export function parseColor(value: string | null | undefined): Rgb | null | undefined {
  if (value === null || value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'inherit') return undefined;
  if (v === 'none' || v === 'transparent') return null;
  if (v === 'currentcolor') return { r: 0, g: 0, b: 0 };
  if (v.startsWith('url(')) return { r: 0.6, g: 0.6, b: 0.6 };
  const hex = (NAMED[v] ?? v).match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
  }
  const rgb = v.match(/^rgba?\(([^)]*)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const channel = (p: string) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255);
    return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]) };
  }
  return undefined;
}

// An element's style: its parent's, overridden by its presentation attributes, then its style="".
export function styleOf(parent: Style, attr: (name: string) => string | null): Style {
  const declared = new Map<string, string>();
  for (const name of ['fill', 'stroke', 'stroke-width', 'fill-rule', 'display', 'visibility']) {
    const value = attr(name);
    if (value !== null) declared.set(name, value);
  }
  for (const part of (attr('style') ?? '').split(';')) {
    const [name, ...rest] = part.split(':');
    if (name && rest.length) declared.set(name.trim(), rest.join(':').trim());
  }
  const fill = parseColor(declared.get('fill'));
  const stroke = parseColor(declared.get('stroke'));
  const width = parseFloat(declared.get('stroke-width') ?? '');
  const rule = declared.get('fill-rule');
  return {
    fill: fill === undefined ? parent.fill : fill,
    stroke: stroke === undefined ? parent.stroke : stroke,
    strokeWidth: Number.isFinite(width) ? width : parent.strokeWidth,
    fillRule: rule === 'evenodd' || rule === 'nonzero' ? rule : parent.fillRule,
    visible: parent.visible && declared.get('display') !== 'none' && declared.get('visibility') !== 'hidden',
  };
}

// ---- Reading a document ----

export type Shape = { name: string; subpaths: Subpath[]; style: Style; scale: number };
export type Collected = { shapes: Shape[]; skipped: Map<string, number> };

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const PASS = new Set(['g', 'svg', 'a', 'switch']);
const IGNORE = new Set(['defs', 'title', 'desc', 'metadata', 'style', 'script', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'filter', 'symbol', 'marker']);

// Walks an SVG element tree, composing transforms and styles, and collects its shapes in painting
// order. Elements it can't show (text, images, <use>) are counted in `skipped`.
export function collectShapes(root: Element): Collected {
  const shapes: Shape[] = [];
  const skipped = new Map<string, number>();
  const walk = (element: Element, transform: Affine, style: Style) => {
    const tag = element.localName;
    const attr = (name: string) => element.getAttribute(name);
    if (IGNORE.has(tag)) return;
    const own = styleOf(style, attr);
    const m = multiplyAffine(transform, parseTransform(attr('transform')));
    if (SHAPES.has(tag)) {
      if (!own.visible) return;
      const subpaths = transformSubpaths(m, shapeSubpaths(tag, attr));
      if (subpaths.length) {
        // Stroke widths scale with the transform's average stretch.
        const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        shapes.push({ name: attr('id') ?? tag, subpaths, style: own, scale });
      }
      return;
    }
    if (PASS.has(tag)) {
      // A nested <svg> places its content at its x, y.
      const inner = tag === 'svg' && element !== root ? multiplyAffine(m, [1, 0, 0, 1, num(attr('x')), num(attr('y'))]) : m;
      for (const child of Array.from(element.children)) walk(child, inner, own);
      return;
    }
    skipped.set(tag, (skipped.get(tag) ?? 0) + 1);
  };
  walk(root, IDENTITY, DEFAULT_STYLE);
  return { shapes, skipped };
}

// ---- Geometry ----

export type ImportedMesh = {
  name: string;
  position: Vec3;
  vertices: Vec3[];
  faces: Face[];
  edges: Edge[];
  curves: EdgeCurve[];
  fill: Rgb;
  border: { color: Rgb; width: number };
};

const area2 = (points: Point[]) => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;

function contains(polygon: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Builds every shape's mesh: SVG's x to the right becomes world x, its y downward becomes world −z,
// scaled by `scale` about `center`, each shape nearer the camera (−y) than the last by `step`.
export function buildMeshes(shapes: Shape[], options: { scale: number; center: Point; step: number }): ImportedMesh[] {
  const { scale: k, center, step } = options;
  const meshes: ImportedMesh[] = [];
  shapes.forEach((shape, order) => {
    const filled = shape.style.fill !== null;
    const stroked = shape.style.stroke !== null && shape.style.strokeWidth > 0;
    if (!filled && !stroked) return;
    const y = -order * step;
    const world = (p: Point): Vec3 => ({ x: (p.x - center.x) * k, y, z: -(p.y - center.y) * k });
    const vector = (p: Point, q: Point): Vec3 => ({ x: (p.x - q.x) * k, y: 0, z: -(p.y - q.y) * k });
    const vertices: Vec3[] = [];
    const edges: Edge[] = [];
    let curves: EdgeCurve[] = [];
    const pairs = new Set<string>();
    const pairKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    // Each closed outline's vertex loop, for faces.
    const loops: number[][] = [];
    // Adds a line a → b with an optional curve. A second line between the same two vertices (a
    // two-arc circle, say) is split at its middle, since a pair holds one curve.
    const link = (a: number, b: number, shape: CurveShape | null, loop: number[]) => {
      if (a === b) return;
      if (pairs.has(pairKey(a, b))) {
        const s = shape ?? { kind: 'quadratic' as const, control: { x: 0, y: 0, z: 0 } };
        const { middle, first, second } = splitCurve(s, vertices[a], vertices[b]);
        const m = vertices.push(middle) - 1;
        loop.push(m);
        link(a, m, shape ? first : null, loop);
        link(m, b, shape ? second : null, loop);
        return;
      }
      pairs.add(pairKey(a, b));
      edges.push([a, b]);
      if (shape) curves = setCurve(curves, a, b, shape);
    };
    const curveFor = (from: Point, segment: Segment): CurveShape | null => {
      const a = world(from), b = world(segment.to);
      if (segment.kind === 'line') return null;
      if (segment.kind === 'quadratic') {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        const c = world(segment.control);
        return { kind: 'quadratic', control: { x: c.x - mid.x, y: 0, z: c.z - mid.z } };
      }
      if (segment.kind === 'cubic') return { kind: 'cubic', out: vector(segment.c1, from), in: vector(segment.c2, segment.to) };
      if (segment.rx === 0 || segment.ry === 0) return null;
      const phi = (segment.rotation * Math.PI) / 180;
      // SVG's x and y become world x and −z, whose cross product is +y: that's the arc's normal, so
      // the sweep flag keeps its meaning.
      return {
        kind: 'arc', radii: { x: Math.abs(segment.rx) * k, y: Math.abs(segment.ry) * k },
        axis: { x: Math.cos(phi), y: 0, z: -Math.sin(phi) }, normal: { x: 0, y: 1, z: 0 }, large: segment.large, sweep: segment.sweep,
      };
    };
    const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
    for (const subpath of shape.subpaths) {
      // Filled outlines close on their own, as SVG fills them.
      const closes = subpath.closed || filled;
      const first = vertices.push(world(subpath.start)) - 1;
      const loop = [first];
      let previous = first;
      let from = subpath.start;
      subpath.segments.forEach((segment, i) => {
        const last = i === subpath.segments.length - 1;
        if (same(segment.to, from) && segment.kind === 'line') return;
        const ends = last && closes && same(segment.to, subpath.start);
        const to = ends ? first : vertices.push(world(segment.to)) - 1;
        link(previous, to, curveFor(from, segment), loop);
        if (!ends) loop.push(to);
        previous = to;
        from = segment.to;
      });
      if (closes && previous !== first) link(previous, first, null, loop);
      if (closes && loop.length >= 3) loops.push(loop);
    }
    const faces: Face[] = filled ? facesFrom(loops, vertices, curves, shape.style.fillRule) : [];
    // Lines that are sides of faces needn't be listed again.
    const sides = new Set<string>();
    faces.forEach(face => face.forEach((a, i) => sides.add(pairKey(a, face[(i + 1) % face.length]))));
    const loose = edges.filter(([a, b]) => !sides.has(pairKey(a, b)));
    // Center each object on its own vertices.
    const xs = vertices.map(v => v.x), zs = vertices.map(v => v.z);
    const position = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    const strokeWidth = stroked ? (shape.style.strokeWidth * shape.scale * k) : 0;
    meshes.push({
      name: shape.name,
      position,
      vertices: vertices.map(v => ({ x: v.x - position.x, y: 0, z: v.z - position.z })),
      faces,
      edges: loose,
      curves,
      fill: shape.style.fill ?? shape.style.stroke ?? { r: 0, g: 0, b: 0 },
      // SVG's stroke straddles the outline; Slender's border lies outside it, and lines draw twice its
      // width, so half the stroke serves for both.
      border: { color: shape.style.stroke ?? shape.style.fill ?? { r: 0, g: 0, b: 0 }, width: strokeWidth / 2 },
    });
  });
  return meshes;
}

// Faces from closed outlines by the fill rule. Each outline is flattened along its curves to find which
// contain which; a filled region keeps its directly enclosed holes, bridged in with a zero-width cut
// from the hole's rightmost vertex to the nearest vertex of the region.
function facesFrom(loops: number[][], vertices: Vec3[], curves: EdgeCurve[], rule: Style['fillRule']): Face[] {
  const flat = loops.map(loop => loop.flatMap((a, i) => {
    const b = loop[(i + 1) % loop.length];
    const found = curves.find(c => (c.a === a && c.b === b) || (c.a === b && c.b === a));
    const points: Point[] = [{ x: vertices[a].x, y: vertices[a].z }];
    if (found) {
      for (let t = 1; t < 8; t++) {
        const p = found.a === a ? curveAt(found.shape, vertices[a], vertices[b], t / 8) : curveAt(found.shape, vertices[b], vertices[a], 1 - t / 8);
        points.push({ x: p.x, y: p.z });
      }
    }
    return points;
  }));
  const areas = flat.map(area2);
  // Each outline's parent: the smallest larger outline containing its first point.
  const parent = loops.map((_, i) => {
    let best = -1;
    flat.forEach((polygon, j) => {
      if (j === i || Math.abs(areas[j]) <= Math.abs(areas[i])) return;
      if (contains(polygon, flat[i][0]) && (best < 0 || Math.abs(areas[j]) < Math.abs(areas[best]))) best = j;
    });
    return best;
  });
  // Filled or not: even-odd by depth; nonzero by the winding the outline adds to its ancestors'.
  const filled = loops.map((_, i) => {
    let depth = 0, winding = 0;
    for (let j = i; j >= 0; j = parent[j]) {
      depth++;
      winding += Math.sign(areas[j]);
    }
    return rule === 'evenodd' ? depth % 2 === 1 : winding !== 0;
  });
  const faces: Face[] = [];
  loops.forEach((loop, i) => {
    if (!filled[i]) return;
    // The region counterclockwise (in x, z), its holes clockwise.
    let face = areas[i] >= 0 ? [...loop] : [...loop].reverse();
    loops.forEach((hole, j) => {
      if (parent[j] !== i || filled[j]) return;
      const h = areas[j] < 0 ? [...hole] : [...hole].reverse();
      const at = (v: number) => vertices[v];
      const right = h.reduce((best, v, k) => (at(v).x > at(h[best]).x ? k : best), 0);
      const near = face.reduce((best, v, k) => {
        const [p, q] = [at(v), at(h[right])];
        const [pb, d] = [at(face[best]), Math.hypot(p.x - q.x, p.z - q.z)];
        return d < Math.hypot(pb.x - q.x, pb.z - q.z) ? k : best;
      }, 0);
      const into = [...h.slice(right), ...h.slice(0, right), h[right]];
      face = [...face.slice(0, near + 1), ...into, ...face.slice(near)];
    });
    faces.push(face);
  });
  return faces;
}

// ---- Into a document ----

// The size an imported drawing is scaled to, across its larger side.
export const IMPORT_SIZE = 400;

// Every point the shapes pass through or bend toward, for their extent.
function extent(shapes: Shape[]) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  const see = (p: Point) => {
    left = Math.min(left, p.x); right = Math.max(right, p.x);
    top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
  };
  for (const { subpaths } of shapes) {
    for (const { start, segments } of subpaths) {
      see(start);
      for (const s of segments) {
        see(s.to);
        if (s.kind === 'quadratic') see(s.control);
        if (s.kind === 'cubic') { see(s.c1); see(s.c2); }
      }
    }
  }
  return { left, right, top, bottom };
}

export type SvgImport = { meshes: ImportedMesh[]; skipped: Map<string, number> };

// Reads SVG text into meshes, centered on the origin and scaled to IMPORT_SIZE across.
export function importSvg(text: string): SvgImport {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length) {
    throw new Error('That file is not an SVG drawing.');
  }
  const { shapes, skipped } = collectShapes(root);
  if (shapes.length === 0) {
    return { meshes: [], skipped };
  }
  const { left, right, top, bottom } = extent(shapes);
  const size = Math.max(right - left, bottom - top) || 1;
  const scale = IMPORT_SIZE / size;
  // Flat: the stack keeps the layers in order, so none needs moving toward the camera.
  const meshes = buildMeshes(shapes, { scale, center: { x: (left + right) / 2, y: (top + bottom) / 2 }, step: 0 });
  return { meshes, skipped };
}

// Adds imported meshes to a document as objects in a new folder, placed around `at`, and selects them.
export function addImportedMeshes(document: EditorDocument, folderName: string, meshes: ImportedMesh[], at: Vec3): EditorDocument {
  let next = addFolder(document);
  const folder = next.folders[next.folders.length - 1].id;
  next = renameFolder(next, folder, folderName);
  const ids: string[] = [];
  for (const mesh of meshes) {
    const position = { x: at.x + mesh.position.x, y: at.y + mesh.position.y, z: at.z + mesh.position.z };
    next = addObject(next, mesh.name, { vertices: mesh.vertices, faces: mesh.faces, edges: mesh.edges }, null, position);
    const id = next.activeObject!;
    // One stack for the drawing, in SVG's order, so its layers paint as SVG paints them from any angle.
    const stack = { id: folder, index: ids.length };
    next = updateObject(next, id, object => ({ ...object, curves: mesh.curves, fill: mesh.fill, border: mesh.border, folder, stack }));
    ids.push(id);
  }
  return { ...next, selectedObjects: ids, activeObject: ids[ids.length - 1] ?? next.activeObject };
}
