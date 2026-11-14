// GraphEd's document model: nodes made of units, logical connections between units, and a wire
// graph (vertices and segments) that routes each connection between ports on its nodes' rims.
// World coordinates have the origin at the center, x to the right and y down. Mirroring reflects
// across the x axis (y -> -y).

export type Vec = { x: number; y: number };

// A unit is something with activity. A circle or box node is one unit; a split node is two halves.
// `color` is an "r, g, b" string used for the unit's fill.
export type Unit = { id: string; label: string; color?: string };
export type NodeShape = 'circle' | 'split' | 'box';
export type LabelAt = 'inside' | 'left' | 'right' | 'top' | 'bottom' | 'none';
export type GNode = {
  id: string;
  label: string;
  shape: NodeShape;
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
  // For a split node, the direction (degrees, clockwise from +x) the first unit's half faces.
  angle: number;
  units: Unit[];
  labelAt: LabelAt;
  // The node's mirror image across the x axis, if it has one.
  twin?: string;
};
export type Connection = { id: string; from: string; to: string; weight: number };
export type End = { connection: string; side: 'from' | 'to' };
// Where connection ends meet a node. Several ends sharing one port form a bundle.
export type Port = { id: string; node: string; unit: string; angle: number; ends: End[] };
// `corner` overrides the document's corner radius where a line turns at this vertex.
export type Vertex = { id: string; x: number; y: number; corner?: number; twin?: string };
// A piece of wire, and the connections routed along it. A connection is wired when the segments
// carrying it join its source port to its target port.
export type Segment = { id: string; a: string; b: string; conns: string[] };
// `borders` outlines nodes in ink; without them, resting nodes keep a stronger tint of their colour.
export type Style = { lineWidth: number; corner: number; grid: number; borders?: boolean };

// How the document animates, as data. Each preset sets named variables; when the preset changes they
// ease toward the new values (wrapping around 1 for the ones listed as cyclic). Every simulated tick,
// each unit's activity is its expression evaluated over those variables; see animation.ts.
export type Preset = { key: string; label: string; vars: Record<string, number> };
export type Animation = {
  tick: number;
  ease: number;
  cyclic: string[];
  presets: Preset[];
  activity: Record<string, string>;
  captions: Record<string, string>;
};
export type GraphDoc = {
  kind: 'graphed';
  version: 1;
  name: string;
  style: Style;
  nodes: Record<string, GNode>;
  connections: Record<string, Connection>;
  ports: Record<string, Port>;
  vertices: Record<string, Vertex>;
  segments: Record<string, Segment>;
  animation: Animation;
};

export const connectionId = (from: string, to: string) => `${from}->${to}`;
export const endKey = (connection: string, side: 'from' | 'to') => `${connection}|${side}`;

export function uid(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 9);
}

export type Index = {
  unitNode: Map<string, string>;
  endPort: Map<string, string>;
  adjacency: Map<string, { to: string; segment: string }[]>;
};

export function buildIndex(doc: GraphDoc): Index {
  const unitNode = new Map<string, string>();
  for (const n of Object.values(doc.nodes)) for (const u of n.units) unitNode.set(u.id, n.id);
  const endPort = new Map<string, string>();
  for (const p of Object.values(doc.ports)) for (const e of p.ends) endPort.set(endKey(e.connection, e.side), p.id);
  const adjacency = new Map<string, { to: string; segment: string }[]>();
  const link = (a: string, b: string, segment: string) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a)!.push({ to: b, segment });
  };
  for (const s of Object.values(doc.segments)) {
    link(s.a, s.b, s.id);
    link(s.b, s.a, s.id);
  }
  return { unitNode, endPort, adjacency };
}

// Geometry.

const RAD = Math.PI / 180;
export const dirOf = (deg: number): Vec => ({ x: Math.cos(deg * RAD), y: Math.sin(deg * RAD) });
export const angleOf = (v: Vec) => Math.atan2(v.y, v.x) / RAD;
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

export function rimPoint(n: GNode, deg: number, gap = 0): Vec {
  const d = dirOf(deg);
  if (n.shape === 'box') {
    const t = Math.min(n.w / 2 / Math.max(1e-9, Math.abs(d.x)), n.h / 2 / Math.max(1e-9, Math.abs(d.y)));
    return { x: n.x + d.x * (t + gap), y: n.y + d.y * (t + gap) };
  }
  return { x: n.x + d.x * (n.r + gap), y: n.y + d.y * (n.r + gap) };
}

// The direction a unit's half faces; for a whole node, null.
export function facing(n: GNode, unit: string): number | null {
  if (n.shape !== 'split') return null;
  return n.units[0]?.id === unit ? n.angle : n.angle + 180;
}

export function unitCenter(n: GNode, unit: string): Vec {
  const f = facing(n, unit);
  if (f === null) return { x: n.x, y: n.y };
  const d = dirOf(f);
  return { x: n.x + (d.x * n.r) / 2, y: n.y + (d.y * n.r) / 2 };
}

// Keeps a port on its own half of a split node.
export function clampPortAngle(n: GNode, unit: string, deg: number): number {
  const f = facing(n, unit);
  if (f === null) return wrap(deg);
  return wrap(f + Math.max(-86, Math.min(86, wrap(deg - f))));
}

export function portPoint(doc: GraphDoc, port: Port, gap = 0): Vec {
  return rimPoint(doc.nodes[port.node], port.angle, gap);
}

export function pointOf(doc: GraphDoc, id: string): Vec | null {
  const v = doc.vertices[id];
  if (v) return { x: v.x, y: v.y };
  const p = doc.ports[id];
  if (p) return portPoint(doc, p);
  const n = doc.nodes[id];
  if (n) return { x: n.x, y: n.y };
  return null;
}

// Mirroring.

export const reflect = (p: Vec): Vec => ({ x: p.x, y: -p.y });

export function twinNode(doc: GraphDoc, id: string): string | null {
  const n = doc.nodes[id];
  if (!n) return null;
  if (n.twin && doc.nodes[n.twin]) return n.twin;
  return Math.abs(n.y) < 0.5 ? id : null;
}

export function twinUnit(doc: GraphDoc, index: Index, unit: string): string | null {
  const node = index.unitNode.get(unit);
  if (!node) return null;
  const t = twinNode(doc, node);
  if (!t) return null;
  if (t === node) return unit;
  const i = doc.nodes[node].units.findIndex(u => u.id === unit);
  return doc.nodes[t].units[i]?.id ?? null;
}

export function twinConnection(doc: GraphDoc, index: Index, id: string): string | null {
  const c = doc.connections[id];
  const from = c && twinUnit(doc, index, c.from);
  const to = c && twinUnit(doc, index, c.to);
  if (!from || !to) return null;
  const t = connectionId(from, to);
  return doc.connections[t] ? t : null;
}

export function twinOf(doc: GraphDoc, index: Index, id: string): string | null {
  if (doc.vertices[id]) {
    const t = doc.vertices[id].twin;
    return t && doc.vertices[t] ? t : null;
  }
  if (doc.ports[id]) {
    const e = doc.ports[id].ends[0];
    const c = e && twinConnection(doc, index, e.connection);
    return c ? index.endPort.get(endKey(c, e.side)) ?? null : null;
  }
  if (doc.nodes[id]) return twinNode(doc, id);
  const s = doc.segments[id];
  if (s) {
    const a = twinOf(doc, index, s.a);
    const b = twinOf(doc, index, s.b);
    if (!a || !b) return null;
    return Object.values(doc.segments).find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a))?.id ?? null;
  }
  return null;
}

// Routing.

export function connectionPorts(index: Index, id: string): [string | undefined, string | undefined] {
  return [index.endPort.get(endKey(id, 'from')), index.endPort.get(endKey(id, 'to'))];
}

// The chain of wire that carries a connection from its source port to its target port, if complete.
// With `connection` null, any wire will do: used to find where a connection could be routed.
export function findPath(doc: GraphDoc, index: Index, connection: string | null, from: string, to: string): string[] | null {
  if (from === to) return null;
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (at === to) break;
    if (at !== from && doc.ports[at]) continue;
    for (const { to: next, segment } of index.adjacency.get(at) ?? []) {
      if (prev.has(next) || (connection !== null && !doc.segments[segment].conns.includes(connection))) continue;
      prev.set(next, at);
      queue.push(next);
    }
  }
  if (!prev.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

export function isComplete(doc: GraphDoc, index: Index, connection: string): boolean {
  const [from, to] = connectionPorts(index, connection);
  return Boolean(from && to && findPath(doc, index, connection, from, to));
}

// Connections that can still be routed onward from a port or vertex: at a port, those with an end
// there that no wire at the port carries yet; at a vertex, every connection the wire brings there
// that has not yet reached both its ports (so a branch can fork off a trunk anywhere along it).
export function unrouted(doc: GraphDoc, index: Index, id: string): string[] {
  const carried = new Set<string>();
  for (const { segment } of index.adjacency.get(id) ?? []) for (const c of doc.segments[segment].conns) carried.add(c);
  const port = doc.ports[id];
  if (port) return port.ends.map(e => e.connection).filter(c => !carried.has(c));
  if (doc.vertices[id]) return [...carried].filter(c => !isComplete(doc, index, c));
  return [];
}

// Once a connection reaches both its ports, takes it off any wire it does not use, such as the
// rest of a trunk beyond the fork where its branch left.
export function pruneRoutes(doc: GraphDoc) {
  const index = buildIndex(doc);
  for (const c of Object.keys(doc.connections)) {
    const [from, to] = connectionPorts(index, c);
    const path = from && to ? findPath(doc, index, c, from, to) : null;
    if (!path) continue;
    const used = new Set<string>();
    for (let i = 0; i + 1 < path.length; i++) {
      const hop = (index.adjacency.get(path[i]) ?? []).find(x => x.to === path[i + 1]);
      if (hop) used.add(hop.segment);
    }
    for (const sg of Object.values(doc.segments)) {
      if (!used.has(sg.id) && sg.conns.includes(c)) sg.conns = sg.conns.filter(x => x !== c);
    }
  }
}

// For each given connection that is not wired, finds a way through the wire already drawn from its
// source port to its target port (whatever that wire carries) and routes it there. Returns how
// many it routed.
export function routeAlongWire(doc: GraphDoc, connections: string[]): number {
  let routed = 0;
  for (const c of connections) {
    const index = buildIndex(doc);
    if (isComplete(doc, index, c)) continue;
    const [from, to] = connectionPorts(index, c);
    const path = from && to ? findPath(doc, index, null, from, to) : null;
    if (!path) continue;
    for (let i = 0; i + 1 < path.length; i++) {
      const hop = (index.adjacency.get(path[i]) ?? []).find(x => x.to === path[i + 1]);
      const sg = hop && doc.segments[hop.segment];
      if (sg && !sg.conns.includes(c)) sg.conns.push(c);
    }
    routed++;
  }
  pruneRoutes(doc);
  return routed;
}

export type Route = { path: string[]; points: Vec[]; lengths: number[]; end: Vec; dir: Vec };

// The drawn line for a connection: straight runs between wire vertices with each turn rounded.
// A segment is shared between the two turns at its ends, except next to a port, where the turn
// may use all of it; that keeps the rounding of a shared trunk identical for every connection.
export function routeFor(doc: GraphDoc, index: Index, id: string): Route | null {
  const [from, to] = connectionPorts(index, id);
  if (!from || !to) return null;
  const path = findPath(doc, index, id, from, to);
  if (!path) return null;
  const knots = path.map(k => pointOf(doc, k)!);
  const out: Vec[] = [knots[0]];
  const line = (p: Vec, q: Vec) => {
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 10));
    for (let j = 1; j <= n; j++) out.push({ x: p.x + ((q.x - p.x) * j) / n, y: p.y + ((q.y - p.y) * j) / n });
  };
  let start = knots[0];
  for (let i = 1; i < knots.length - 1; i++) {
    const p = knots[i - 1];
    const c = knots[i];
    const q = knots[i + 1];
    const d0 = Math.hypot(c.x - p.x, c.y - p.y) || 1e-9;
    const d1 = Math.hypot(q.x - c.x, q.y - c.y) || 1e-9;
    const corner = doc.vertices[path[i]]?.corner ?? doc.style.corner;
    const r0 = Math.min(corner, doc.ports[path[i - 1]] ? d0 : d0 / 2);
    const r1 = Math.min(corner, doc.ports[path[i + 1]] ? d1 : d1 / 2);
    const a = { x: c.x + ((p.x - c.x) * r0) / d0, y: c.y + ((p.y - c.y) * r0) / d0 };
    const b = { x: c.x + ((q.x - c.x) * r1) / d1, y: c.y + ((q.y - c.y) * r1) / d1 };
    line(start, a);
    const steps = Math.max(4, Math.ceil((r0 + r1) / 6));
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const k = 1 - t;
      out.push({ x: k * k * a.x + 2 * k * t * c.x + t * t * b.x, y: k * k * a.y + 2 * k * t * c.y + t * t * b.y });
    }
    start = b;
  }
  line(start, knots[knots.length - 1]);
  const lengths = [0];
  for (let i = 1; i < out.length; i++) lengths.push(lengths[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
  const end = out[out.length - 1];
  let k = out.length - 2;
  while (k > 0 && Math.hypot(end.x - out[k].x, end.y - out[k].y) < 6) k--;
  const before = out[Math.max(0, k)];
  const l = Math.hypot(end.x - before.x, end.y - before.y) || 1;
  return { path, points: out, lengths, end, dir: { x: (end.x - before.x) / l, y: (end.y - before.y) / l } };
}

// The part of a route between two fractions of its length.
export function slice(r: Route, from: number, to: number): Vec[] {
  const total = r.lengths[r.lengths.length - 1];
  const at = (s: number) => {
    let i = 1;
    while (i < r.lengths.length - 1 && r.lengths[i] < s) i++;
    const a = r.points[i - 1];
    const b = r.points[i];
    const t = Math.max(0, Math.min(1, (s - r.lengths[i - 1]) / (r.lengths[i] - r.lengths[i - 1] || 1)));
    return { i, p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
  };
  const s = at(total * from);
  const e = at(total * to);
  return [s.p, ...r.points.slice(s.i, e.i), e.p];
}

export const pathOf = (points: Vec[]) => points.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join('');

// Edits. Each mutates the document in place; callers work on a copy.

export function addVertex(doc: GraphDoc, p: Vec): string {
  const id = uid('v');
  doc.vertices[id] = { id, x: p.x, y: p.y };
  return id;
}

export function addSegment(doc: GraphDoc, a: string, b: string, conns: string[] = []): string | null {
  if (a === b) return null;
  const existing = Object.values(doc.segments).find(s => (s.a === a && s.b === b) || (s.a === b && s.b === a));
  if (existing) {
    existing.conns = [...new Set([...existing.conns, ...conns])];
    return existing.id;
  }
  const id = uid('s');
  doc.segments[id] = { id, a, b, conns: [...conns] };
  return id;
}

export function removeVertex(doc: GraphDoc, id: string) {
  const twin = doc.vertices[id]?.twin;
  if (twin && doc.vertices[twin]) delete doc.vertices[twin].twin;
  delete doc.vertices[id];
  for (const s of Object.values(doc.segments)) if (s.a === id || s.b === id) delete doc.segments[s.id];
}

// Reconnects everything on `from` to `to` and removes `from`.
export function mergeInto(doc: GraphDoc, from: string, to: string) {
  for (const s of Object.values(doc.segments)) {
    if (s.a === from) s.a = to;
    if (s.b === from) s.b = to;
  }
  const seen = new Map<string, Segment>();
  for (const s of Object.values(doc.segments)) {
    const key = [s.a, s.b].sort().join('|');
    const kept = seen.get(key);
    if (s.a === s.b) delete doc.segments[s.id];
    else if (kept) {
      kept.conns = [...new Set([...kept.conns, ...s.conns])];
      delete doc.segments[s.id];
    } else seen.set(key, s);
  }
  removeVertex(doc, from);
}

export function subdivide(doc: GraphDoc, segment: string, p: Vec): string {
  const s = doc.segments[segment];
  const v = addVertex(doc, p);
  delete doc.segments[segment];
  addSegment(doc, s.a, v, s.conns);
  addSegment(doc, v, s.b, s.conns);
  return v;
}

const meanAngle = (angles: number[]) => angleOf(angles.reduce((acc, a) => ({ x: acc.x + dirOf(a).x, y: acc.y + dirOf(a).y }), { x: 0, y: 0 }));

// Merges ports at the same unit into one port, keeping any wiring attached to them.
export function bundlePorts(doc: GraphDoc, ports: string[]): string | null {
  const list = ports.map(id => doc.ports[id]).filter(Boolean);
  if (list.length < 2 || list.some(p => p.unit !== list[0].unit)) return null;
  const [keep, ...rest] = list;
  keep.angle = clampPortAngle(doc.nodes[keep.node], keep.unit, meanAngle(list.map(p => p.angle)));
  for (const p of rest) {
    keep.ends.push(...p.ends);
    mergeInto(doc, p.id, keep.id);
    delete doc.ports[p.id];
  }
  return keep.id;
}

// The direction of a port's connections: 'from' for outputs, 'to' for inputs.
export const portSide = (port: Port) => port.ends[0]?.side ?? 'from';

// Bundles the given ports in groups that share a unit and a direction, since a bundle is one point
// where several outputs leave (or inputs arrive at) one unit. Returns how many bundles were made.
export function bundleChosen(doc: GraphDoc, ports: string[]): number {
  const groups = new Map<string, string[]>();
  for (const id of ports) {
    const port = doc.ports[id];
    if (!port) continue;
    const key = port.unit + '|' + portSide(port);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(id);
  }
  let made = 0;
  for (const group of groups.values()) if (group.length > 1 && bundlePorts(doc, group)) made++;
  return made;
}

// Fans out a node's ports so that none sit on top of each other: on each unit, neighbours are
// pushed apart to at least `gap` degrees and `arc` units along the rim, keeping their order and
// staying on the unit's own half.
export function spreadPorts(doc: GraphDoc, nodeId: string, gap = 14, arc = 9) {
  const n = doc.nodes[nodeId];
  for (const unit of n.units) {
    const ports = Object.values(doc.ports).filter(p => p.node === nodeId && p.unit === unit.id);
    if (ports.length < 2) continue;
    const f = facing(n, unit.id);
    const ref = f ?? meanAngle(ports.map(p => p.angle));
    const limit = f === null ? 180 : 86;
    const rim = n.shape === 'box' ? Math.min(n.w, n.h) / 2 : n.r;
    const step = Math.min(Math.max(gap, (arc / Math.max(1, rim)) * (180 / Math.PI)), (2 * limit) / ports.length);
    const items = ports.map(p => ({ p, o: wrap(p.angle - ref) })).sort((a, b) => a.o - b.o);
    for (let round = 0; round < 200; round++) {
      let moved = false;
      for (let i = 0; i + 1 < items.length; i++) {
        const d = items[i + 1].o - items[i].o;
        if (d < step - 1e-6) {
          const push = (step - d) / 2;
          items[i].o -= push;
          items[i + 1].o += push;
          moved = true;
        }
      }
      // Keep the fan on the unit's own arc.
      const over = items[items.length - 1].o - limit;
      const under = -limit - items[0].o;
      if (over > 0) for (const it of items) it.o -= over;
      if (under > 0) for (const it of items) it.o += under;
      if (!moved) break;
    }
    for (const it of items) it.p.angle = Math.round(clampPortAngle(n, unit.id, ref + it.o));
  }
}

// Gives every end of a bundle its own port again. The wiring stays with the first end; the
// others are taken off the wire and need routing again.
export function unbundlePort(doc: GraphDoc, id: string): string[] {
  const p = doc.ports[id];
  const out = [id];
  const leaving = new Set(p.ends.slice(1).map(e => e.connection));
  for (const s of Object.values(doc.segments)) s.conns = s.conns.filter(c => !leaving.has(c));
  p.ends.slice(1).forEach((end, i) => {
    const nid = uid('p');
    const node = doc.nodes[p.node];
    doc.ports[nid] = { id: nid, node: p.node, unit: p.unit, angle: clampPortAngle(node, p.unit, p.angle + 8 * (i + 1)), ends: [end] };
    out.push(nid);
  });
  p.ends = p.ends.slice(0, 1);
  return out;
}

export function addConnection(doc: GraphDoc, index: Index, from: string, to: string, weight: number): string | null {
  const id = connectionId(from, to);
  if (doc.connections[id] || from === to) return null;
  const a = doc.nodes[index.unitNode.get(from)!];
  const b = doc.nodes[index.unitNode.get(to)!];
  if (!a || !b) return null;
  doc.connections[id] = { id, from, to, weight };
  const ca = unitCenter(a, from);
  const cb = unitCenter(b, to);
  const pa = uid('p');
  const pb = uid('p');
  doc.ports[pa] = { id: pa, node: a.id, unit: from, angle: clampPortAngle(a, from, angleOf({ x: cb.x - a.x, y: cb.y - a.y })), ends: [{ connection: id, side: 'from' }] };
  doc.ports[pb] = { id: pb, node: b.id, unit: to, angle: clampPortAngle(b, to, angleOf({ x: ca.x - b.x, y: ca.y - b.y })), ends: [{ connection: id, side: 'to' }] };
  return id;
}

function removePort(doc: GraphDoc, id: string) {
  delete doc.ports[id];
  for (const s of Object.values(doc.segments)) if (s.a === id || s.b === id) delete doc.segments[s.id];
}

export function removeConnection(doc: GraphDoc, id: string) {
  delete doc.connections[id];
  for (const s of Object.values(doc.segments)) s.conns = s.conns.filter(c => c !== id);
  for (const p of Object.values(doc.ports)) {
    p.ends = p.ends.filter(e => e.connection !== id);
    if (!p.ends.length) removePort(doc, p.id);
  }
}

export function removeNode(doc: GraphDoc, id: string) {
  const n = doc.nodes[id];
  const units = new Set(n.units.map(u => u.id));
  for (const c of Object.values(doc.connections)) if (units.has(c.from) || units.has(c.to)) removeConnection(doc, c.id);
  for (const p of Object.values(doc.ports)) if (p.node === id) removePort(doc, p.id);
  for (const other of Object.values(doc.nodes)) if (other.twin === id) delete other.twin;
  delete doc.nodes[id];
}

export function emptyDoc(name: string): GraphDoc {
  return {
    kind: 'graphed', version: 1, name, style: { lineWidth: 1, corner: 14, grid: 10 },
    nodes: {}, connections: {}, ports: {}, vertices: {}, segments: {},
    animation: { tick: 0.03, ease: 1.5, cyclic: [], presets: [], activity: {}, captions: {} },
  };
}

// Checks the shape of a loaded document well enough that the editor will not crash on it.
export function validate(input: any): GraphDoc {
  if (!input || input.kind !== 'graphed') throw new Error('Not a GraphEd document');
  for (const key of ['nodes', 'connections', 'ports', 'vertices', 'segments']) {
    if (!input[key] || typeof input[key] !== 'object') throw new Error('Missing ' + key);
  }
  const doc = input as GraphDoc;
  const blank = emptyDoc('');
  doc.style = { ...blank.style, ...(doc.style ?? {}) };
  doc.animation = { ...blank.animation, ...(doc.animation ?? {}) };
  for (const p of Object.values(doc.ports)) if (!doc.nodes[p.node]) throw new Error('Port on missing node ' + p.node);
  for (const s of Object.values(doc.segments)) {
    if (!pointOf(doc, s.a) || !pointOf(doc, s.b)) delete doc.segments[s.id];
    else s.conns = (s.conns ?? []).filter(c => doc.connections[c]);
  }
  return doc;
}
