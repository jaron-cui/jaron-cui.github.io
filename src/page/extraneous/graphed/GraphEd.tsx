// GraphEd: an editor for animated circuit-style graphs. Nodes hold units with activity; connections
// between units are drawn along a hand-built wire graph, as in a vertex chain in Slender:
// E extrudes, G grabs, F joins, X deletes. Middle-drag pans and the wheel zooms.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { createRunner } from './animation';
import { connectionLines, nodeShapes } from './draw';
import type { Runner } from './animation';
import { FILE_EXTENSION, loadSession, pickFileToOpen, saveFile, saveSession } from './files';
import type { FileHandle } from './files';
import {
  addConnection, addSegment, addVertex, angleOf, buildIndex, bundleChosen, bundlePorts, findPath, pruneRoutes, routeAlongWire, spreadPorts, clampPortAngle, connectionPorts, emptyDoc,
  endKey, mergeInto, pointOf, portPoint, reflect, removeConnection, removeNode, removeVertex, rimPoint,
  routeFor, subdivide, twinConnection, twinOf, uid, unbundlePort, unrouted, validate,
} from './model';
import type { GNode, GraphDoc, Index, LabelAt, NodeShape, Route, Vec } from './model';

const INK = '#1d2330';
const MUTED = '#5b6575';
const SELECT = '#e0a100';
const HOVER = '#2e9d57';
const EXC = '#c42020';
// Length of a connection-end stub, in screen pixels.
const STUB = 28;
const INH = '#1c4ec4';

type Grab = {
  kind: 'grab'; ids: string[]; start: Record<string, Vec>; mouse0: Vec; axis: 'x' | 'y' | null;
  before: GraphDoc; base: GraphDoc; onUp: boolean; moved: boolean; hover: string | null; screen0: Vec;
};
type Modal = Grab | { kind: 'box'; a: Vec; b: Vec; additive: boolean } | { kind: 'pan'; s0: Vec; cam0: Vec };

type UI = {
  cam: { x: number; y: number; zoom: number };
  size: { w: number; h: number };
  selection: string[];
  conns: string[];
  // The connections in view for the selection (all of a selected node's, say); `conns` is the
  // ticked subset that bundling and the guides act on.
  pool: string[];
  // Which of the selected port's or vertex's unrouted connections the next extrusion carries;
  // null means all of them.
  carry: string[] | null;
  modal: Modal | null;
  mouse: Vec;
  mouseScreen: Vec;
  snap: boolean;
  mirror: boolean;
  showVertices: boolean;
  playing: boolean;
  slow: boolean;
  preset: string;
  menu: { screen: Vec; world: Vec } | null;
};

function serialize(doc: GraphDoc): string {
  const record = (r: Record<string, unknown>) => {
    const entries = Object.entries(r).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return entries.length ? `{\n${entries.join(',\n')}\n  }` : '{}';
  };
  return `{\n  "kind": "graphed",\n  "version": 1,\n  "name": ${JSON.stringify(doc.name)},\n  "style": ${JSON.stringify(doc.style)},\n`
    + `  "nodes": ${record(doc.nodes)},\n  "connections": ${record(doc.connections)},\n  "ports": ${record(doc.ports)},\n`
    + `  "vertices": ${record(doc.vertices)},\n  "segments": ${record(doc.segments)},\n`
    + `  "animation": ${JSON.stringify(doc.animation, null, 2).replace(/\n/g, '\n  ')}\n}\n`;
}

const clone = (doc: GraphDoc) => structuredClone(doc);
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function segmentDistance(p: Vec, a: Vec, b: Vec): { d: number; at: Vec } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  const at = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: dist(p, at), at };
}

export default function GraphEd(): JSX.Element {
  const [doc, setDocState] = useState<GraphDoc>(() => emptyDoc('Untitled'));
  const docRef = useRef(doc);
  const setDoc = (d: GraphDoc) => {
    docRef.current = d;
    setDocState(d);
  };
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [file, setFile] = useState<{ name: string | null; handle: FileHandle | null; savedText: string | null }>({ name: null, handle: null, savedText: null });
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const undo = useRef<GraphDoc[]>([]);
  const redo = useRef<GraphDoc[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const ui = useRef<UI>({
    cam: { x: 0, y: 0, zoom: 1 }, size: { w: 800, h: 600 }, selection: [], conns: [], pool: [], carry: null, modal: null,
    mouse: { x: 0, y: 0 }, mouseScreen: { x: 0, y: 0 }, snap: true, mirror: true, showVertices: true,
    playing: true, slow: true, preset: '', menu: null,
  });
  const u = ui.current;
  if (import.meta.env.DEV) {
    // Lets browser tests read and load state.
    (window as unknown as Record<string, unknown>).__graphed = {
      doc: () => docRef.current, ui: () => ui.current, load: (t: string) => setDoc(validate(JSON.parse(t))), frame: () => frameAll(),
    };
  }

  const index = useMemo(() => buildIndex(doc), [doc]);
  const routes = useMemo(() => {
    const out: Record<string, Route | null> = {};
    for (const id of Object.keys(doc.connections)) out[id] = routeFor(doc, index, id);
    return out;
  }, [doc, index]);
  const text = useMemo(() => serialize(doc), [doc]);
  const dirty = file.savedText !== text;

  // Session: restore on load, keep on change.
  useEffect(() => {
    loadSession().then(session => {
      if (session) {
        try {
          setDoc(validate(JSON.parse(session.text)));
          setFile({ name: session.fileName, handle: session.handle, savedText: session.savedText });
        } catch {
          // Start fresh.
        }
      }
      setLoaded(true);
      requestAnimationFrame(frameAll);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => saveSession({ text, fileName: file.name, handle: file.handle, savedText: file.savedText }), 400);
    return () => clearTimeout(timer);
  }, [text, file, loaded]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty && file.name) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, file.name]);

  // Animation: tick samples, interpolated for display one tick behind the newest.
  const animationKey = JSON.stringify(doc.animation);
  const runner = useMemo<Runner>(() => createRunner(doc.animation), [animationKey]);
  const sim = useRef({ samples: [] as Record<string, number>[], clock: 0, tickStart: 0 });
  useEffect(() => {
    sim.current = { samples: [], clock: 0, tickStart: 0 };
  }, [runner]);
  const presets = doc.animation.presets;
  const preset = presets.some(p => p.key === u.preset) ? u.preset : presets[0]?.key ?? '';
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = sim.current;
      const tick = Math.max(0.001, docRef.current.animation.tick);
      const key = ui.current.preset || docRef.current.animation.presets[0]?.key || '';
      while (s.samples.length < 3) s.samples.push(runner.step(key));
      if (ui.current.playing) {
        s.clock += dt * (ui.current.slow ? 0.1 : 1);
        let steps = 0;
        while (s.clock - s.tickStart >= tick && steps++ < 50) {
          s.tickStart += tick;
          s.samples = [...s.samples.slice(-2), runner.step(key)];
        }
        if (s.clock - s.tickStart >= tick) s.tickStart = s.clock;
        bump();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runner]);
  const s = sim.current;
  const f = Math.min(1, (s.clock - s.tickStart) / Math.max(0.001, doc.animation.tick));
  const value = (key: string, lag = 0): number => {
    if (s.samples.length < 3) return 0;
    const [older, prev, cur] = s.samples;
    const t = f - lag;
    const lerp = (p: Record<string, number>, q: Record<string, number>, k: number) => (p[key] ?? 0) + ((q[key] ?? 0) - (p[key] ?? 0)) * k;
    return t >= 0 ? lerp(prev, cur, t) : lerp(older, prev, 1 + t);
  };

  // Editing.
  const commit = (fn: (d: GraphDoc, index: Index) => void) => {
    const prev = docRef.current;
    const d = clone(prev);
    fn(d, buildIndex(d));
    pruneRoutes(d);
    undo.current.push(prev);
    if (undo.current.length > 300) undo.current.shift();
    redo.current = [];
    setDoc(d);
  };
  const history = (back: boolean) => {
    const [from, to] = back ? [undo, redo] : [redo, undo];
    const d = from.current.pop();
    if (d) {
      to.current.push(docRef.current);
      setDoc(d);
      u.selection = u.selection.filter(id => pointOf(d, id) || d.segments[id]);
    }
  };

  const toWorld = (sx: number, sy: number): Vec => ({ x: u.cam.x + (sx - u.size.w / 2) / u.cam.zoom, y: u.cam.y + (sy - u.size.h / 2) / u.cam.zoom });
  const screenOf = (event: { clientX: number; clientY: number }): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };
  const snapPoint = (p: Vec, invert: boolean): Vec => {
    const g = docRef.current.style.grid;
    return u.snap !== invert && g > 0 ? { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g } : { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  };

  function frameAll() {
    const d = docRef.current;
    const pts: Vec[] = [];
    for (const n of Object.values(d.nodes)) {
      const r = n.shape === 'box' ? Math.max(n.w, n.h) / 2 : n.r;
      pts.push({ x: n.x - r - 30, y: n.y - r }, { x: n.x + r, y: n.y + r });
    }
    for (const v of Object.values(d.vertices)) pts.push(v);
    if (!pts.length) {
      u.cam = { x: 0, y: 0, zoom: 1 };
    } else {
      const x0 = Math.min(...pts.map(p => p.x));
      const x1 = Math.max(...pts.map(p => p.x));
      const y0 = Math.min(...pts.map(p => p.y));
      const y1 = Math.max(...pts.map(p => p.y));
      u.cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.min(4, u.size.w / (x1 - x0 + 80), u.size.h / (y1 - y0 + 80)) };
    }
    bump();
  }

  type Hit = { kind: 'vertex' | 'port' | 'segment' | 'node'; id: string; at?: Vec };
  const pick = (p: Vec, exclude: string[] = []): Hit | null => {
    const d = docRef.current;
    const tol = 8 / u.cam.zoom;
    let best: Hit | null = null;
    let bestD = tol;
    for (const v of Object.values(d.vertices)) {
      if (exclude.includes(v.id)) continue;
      const k = dist(p, v);
      if (k < bestD) [best, bestD] = [{ kind: 'vertex', id: v.id }, k];
    }
    if (best) return best;
    for (const port of Object.values(d.ports)) {
      if (exclude.includes(port.id)) continue;
      const k = dist(p, portPoint(d, port));
      if (k < bestD) [best, bestD] = [{ kind: 'port', id: port.id }, k];
    }
    if (best) return best;
    bestD = 5 / u.cam.zoom;
    for (const seg of Object.values(d.segments)) {
      const a = pointOf(d, seg.a);
      const b = pointOf(d, seg.b);
      if (!a || !b) continue;
      const k = segmentDistance(p, a, b);
      if (k.d < bestD) [best, bestD] = [{ kind: 'segment', id: seg.id, at: k.at }, k.d];
    }
    if (best) return best;
    const nodes = Object.values(d.nodes).reverse();
    for (const n of nodes) {
      const inside = n.shape === 'box' ? Math.abs(p.x - n.x) <= n.w / 2 && Math.abs(p.y - n.y) <= n.h / 2 : dist(p, n) <= n.r;
      if (inside) return { kind: 'node', id: n.id };
    }
    return null;
  };

  const movable = (d: GraphDoc, id: string) => Boolean(d.vertices[id] || d.nodes[id] || d.ports[id]);

  const startGrab = (ids: string[], base: GraphDoc, before: GraphDoc, onUp: boolean) => {
    const start: Record<string, Vec> = {};
    for (const id of ids) start[id] = pointOf(base, id)!;
    undo.current.push(before);
    redo.current = [];
    u.modal = { kind: 'grab', ids, start, mouse0: u.mouse, axis: null, before, base, onUp, moved: false, hover: null, screen0: u.mouseScreen };
  };

  const updateGrab = (g: Grab, invertSnap: boolean) => {
    if (dist(u.mouseScreen, g.screen0) > 3) g.moved = true;
    if (!g.moved) return;
    const delta = { x: u.mouse.x - g.mouse0.x, y: u.mouse.y - g.mouse0.y };
    if (g.axis === 'x') delta.y = 0;
    if (g.axis === 'y') delta.x = 0;
    const d = clone(g.base);
    const index = buildIndex(d);
    const order = [...g.ids].sort((a, b) => Number(Boolean(d.ports[a])) - Number(Boolean(d.ports[b])));
    const moved = new Set(g.ids);
    const mirrorTo = (id: string) => {
      if (!u.mirror) return;
      const t = twinOf(d, index, id);
      if (!t || t === id || moved.has(t)) return;
      if (d.vertices[id]) Object.assign(d.vertices[t], reflect(d.vertices[id]));
      else if (d.nodes[id]) Object.assign(d.nodes[t], reflect(d.nodes[id]));
      else if (d.ports[id]) {
        const tp = d.ports[t];
        tp.angle = clampPortAngle(d.nodes[tp.node], tp.unit, -d.ports[id].angle);
      }
    };
    for (const id of order) {
      const target = { x: g.start[id].x + delta.x, y: g.start[id].y + delta.y };
      if (d.vertices[id]) Object.assign(d.vertices[id], snapPoint(target, invertSnap));
      else if (d.nodes[id]) Object.assign(d.nodes[id], snapPoint(target, invertSnap));
      else if (d.ports[id]) {
        const port = d.ports[id];
        const n = d.nodes[port.node];
        port.angle = Math.round(clampPortAngle(n, port.unit, angleOf({ x: target.x - n.x, y: target.y - n.y })));
      }
      mirrorTo(id);
    }
    g.hover = null;
    if (g.ids.length === 1 && d.vertices[g.ids[0]]) {
      const twin = twinOf(d, index, g.ids[0]);
      const hit = pick(u.mouse, [g.ids[0], ...(twin ? [twin] : [])]);
      if (hit && (hit.kind === 'vertex' || hit.kind === 'port')) g.hover = hit.id;
    }
    setDoc(d);
  };

  const confirmGrab = (g: Grab) => {
    u.modal = null;
    if (g.onUp && !g.moved) {
      undo.current.pop();
      setDoc(g.before);
      return;
    }
    if (g.hover) {
      const d = clone(docRef.current);
      const index = buildIndex(d);
      const v = g.ids[0];
      const tv = u.mirror ? twinOf(d, index, v) : null;
      const th = u.mirror ? twinOf(d, index, g.hover) : null;
      mergeInto(d, v, g.hover);
      if (tv && th && tv !== v && th !== g.hover && d.vertices[tv]) mergeInto(d, tv, th);
      pruneRoutes(d);
      u.selection = [g.hover];
      setDoc(d);
    }
    bump();
  };

  const cancelModal = () => {
    const m = u.modal;
    u.modal = null;
    if (m?.kind === 'grab') {
      undo.current.pop();
      setDoc(m.before);
    }
    bump();
  };

  const selectConnectionsOf = (id: string) => {
    const d = docRef.current;
    u.carry = null;
    if (d.ports[id]) u.conns = d.ports[id].ends.map(e => e.connection);
    else if (d.segments[id]) u.conns = [...d.segments[id].conns];
    else if (d.vertices[id]) u.conns = [...new Set((index.adjacency.get(id) ?? []).flatMap(x => d.segments[x.segment]?.conns ?? []))];
    else if (d.nodes[id]) {
      const units = new Set(d.nodes[id].units.map(x => x.id));
      u.conns = Object.values(d.connections).filter(c => units.has(c.from) || units.has(c.to)).map(c => c.id);
    } else u.conns = [];
    u.pool = [...u.conns];
  };

  const extrude = () => {
    const before = docRef.current;
    const sources = u.selection.filter(id => before.vertices[id] || before.ports[id]);
    if (!sources.length) {
      setMessage('Select a port or vertex to extrude from.');
      return;
    }
    const d = clone(before);
    const index = buildIndex(d);
    const created: string[] = [];
    for (const src of sources) {
      const open = unrouted(d, index, src);
      const conns = sources.length === 1 && u.carry ? open.filter(c => u.carry!.includes(c)) : open;
      const v = addVertex(d, pointOf(d, src)!);
      addSegment(d, src, v, conns);
      created.push(v);
      const t = u.mirror ? twinOf(d, index, src) : null;
      if (t && t !== src && !sources.includes(t)) {
        const tv = addVertex(d, pointOf(d, t)!);
        addSegment(d, t, tv, conns.map(c => twinConnection(d, index, c)).filter((c): c is string => Boolean(c)));
        d.vertices[v].twin = tv;
        d.vertices[tv].twin = v;
      }
    }
    setDoc(d);
    u.selection = created;
    u.carry = null;
    startGrab(created, d, before, false);
    (u.modal as Grab).moved = true;
    bump();
  };

  const join = () => {
    const ends = u.selection.filter(id => docRef.current.vertices[id] || docRef.current.ports[id]);
    if (ends.length !== 2) {
      setMessage('Select exactly two vertices or ports to join.');
      return;
    }
    commit((d, index) => {
      // The new piece carries whatever is unrouted at both ends.
      const atB = new Set(unrouted(d, index, ends[1]));
      const conns = unrouted(d, index, ends[0]).filter(c => atB.has(c));
      addSegment(d, ends[0], ends[1], conns);
      const a = u.mirror ? twinOf(d, index, ends[0]) : null;
      const b = u.mirror ? twinOf(d, index, ends[1]) : null;
      if (a && b && !(a === ends[0] && b === ends[1])) {
        addSegment(d, a, b, conns.map(c => twinConnection(d, index, c)).filter((c): c is string => Boolean(c)));
      }
    });
  };

  const deleteSelection = () => {
    const d0 = docRef.current;
    const nodes = u.selection.filter(id => d0.nodes[id]);
    if (nodes.length && !window.confirm(`Delete ${nodes.length} node(s) and their connections?`)) return;
    commit((d, index) => {
      const twins = (id: string) => (u.mirror ? twinOf(d, index, id) : null);
      const segs = new Set<string>();
      for (const id of u.selection) {
        if (d.segments[id]) {
          segs.add(id);
          const t = twins(id);
          if (t) segs.add(t);
        }
      }
      const verts = new Set<string>();
      for (const id of u.selection) {
        if (d.vertices[id]) {
          verts.add(id);
          const t = twins(id);
          if (t) verts.add(t);
        }
      }
      for (const id of segs) delete d.segments[id];
      for (const id of verts) if (d.vertices[id]) removeVertex(d, id);
      for (const id of nodes) if (d.nodes[id]) removeNode(d, id);
    });
    u.selection = [];
    u.conns = [];
    u.pool = [];
  };

  const addNodeAt = (shape: NodeShape, at: Vec) => {
    const id = uid('n');
    const p = snapPoint(at, false);
    const node: GNode = {
      id, label: shape === 'box' ? 'Box' : 'N', shape, x: p.x, y: p.y, r: shape === 'split' ? 40 : 13, w: 110, h: 72, angle: 90,
      units: shape === 'split' ? [{ id: id + '_a', label: 'a' }, { id: id + '_b', label: 'b' }] : [{ id, label: shape === 'box' ? 'Box' : 'N' }],
      labelAt: shape === 'split' ? 'left' : 'inside',
    };
    commit(d => {
      d.nodes[id] = node;
    });
    u.selection = [id];
    u.menu = null;
  };

  const bundle = (side: 'from' | 'to') => {
    commit((d, index) => {
      const conns = new Set(u.conns);
      if (u.mirror) for (const c of u.conns) {
        const t = twinConnection(d, index, c);
        if (t) conns.add(t);
      }
      const groups = new Map<string, string[]>();
      for (const c of conns) {
        const port = index.endPort.get(endKey(c, side));
        if (!port) continue;
        const unit = d.ports[port].unit;
        if (!groups.has(unit)) groups.set(unit, []);
        if (!groups.get(unit)!.includes(port)) groups.get(unit)!.push(port);
      }
      for (const ports of groups.values()) bundlePorts(d, ports);
    });
  };

  const bundleSelectedPorts = () => {
    const ports = u.selection.filter(id => docRef.current.ports[id]);
    if (ports.length < 2) {
      setMessage('Select two or more ports (Shift+click) to bundle them.');
      return;
    }
    let made = 0;
    commit((d, index) => {
      const chosen = new Set(ports);
      if (u.mirror) for (const id of ports) {
        const t = twinOf(d, index, id);
        if (t) chosen.add(t);
      }
      made = bundleChosen(d, [...chosen]);
    });
    setMessage(made ? `Made ${made} bundle(s).` : 'Nothing to bundle: a bundle needs two or more ports on the same unit, all outputs or all inputs.');
    u.selection = u.selection.filter(id => docRef.current.ports[id]);
  };

  // Pointer input.
  const onPointerDown = (event: React.PointerEvent) => {
    const screen = screenOf(event);
    u.mouseScreen = screen;
    u.mouse = toWorld(screen.x, screen.y);
    if (u.menu) {
      u.menu = null;
      bump();
    }
    if (event.button === 1) {
      event.preventDefault();
      u.modal = { kind: 'pan', s0: screen, cam0: { x: u.cam.x, y: u.cam.y } };
      svgRef.current!.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 2) {
      if (u.modal?.kind === 'grab') cancelModal();
      return;
    }
    if (event.button !== 0) return;
    if (u.modal?.kind === 'grab') {
      confirmGrab(u.modal);
      return;
    }
    svgRef.current!.setPointerCapture(event.pointerId);
    const hit = pick(u.mouse);
    const additive = event.shiftKey || event.ctrlKey;
    if (!hit) {
      u.modal = { kind: 'box', a: u.mouse, b: u.mouse, additive };
      bump();
      return;
    }
    if (additive) {
      u.selection = u.selection.includes(hit.id) ? u.selection.filter(x => x !== hit.id) : [...u.selection, hit.id];
      const d = docRef.current;
      const conns = u.selection.flatMap(id => d.ports[id]?.ends.map(e => e.connection) ?? d.segments[id]?.conns ?? []);
      u.conns = [...new Set(conns)];
      u.pool = [...u.conns];
      u.carry = null;
      bump();
      return;
    }
    if (!u.selection.includes(hit.id)) u.selection = [hit.id];
    selectConnectionsOf(hit.id);
    const d = docRef.current;
    const ids = u.selection.filter(id => movable(d, id));
    if (hit.kind !== 'segment' && ids.length) startGrab(ids, d, d, true);
    bump();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const screen = screenOf(event);
    u.mouseScreen = screen;
    u.mouse = toWorld(screen.x, screen.y);
    const m = u.modal;
    if (m?.kind === 'pan') {
      u.cam = { ...u.cam, x: m.cam0.x - (screen.x - m.s0.x) / u.cam.zoom, y: m.cam0.y - (screen.y - m.s0.y) / u.cam.zoom };
    } else if (m?.kind === 'grab') {
      updateGrab(m, event.ctrlKey);
    } else if (m?.kind === 'box') {
      m.b = u.mouse;
    }
    bump();
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const m = u.modal;
    if (m?.kind === 'pan' && event.button === 1) u.modal = null;
    if (m?.kind === 'grab' && m.onUp && event.button === 0) confirmGrab(m);
    if (m?.kind === 'box' && event.button === 0) {
      u.modal = null;
      const d = docRef.current;
      const x0 = Math.min(m.a.x, m.b.x);
      const x1 = Math.max(m.a.x, m.b.x);
      const y0 = Math.min(m.a.y, m.b.y);
      const y1 = Math.max(m.a.y, m.b.y);
      const inside = (p: Vec | null) => Boolean(p) && p!.x >= x0 && p!.x <= x1 && p!.y >= y0 && p!.y <= y1;
      const tiny = (x1 - x0) * u.cam.zoom < 3 && (y1 - y0) * u.cam.zoom < 3;
      // A box around wire selects only the wire (as edit mode does), so that grabbing it never
      // drags along a node or port that happened to fall inside; a box with no wire selects nodes.
      const wire = tiny ? [] : [
        ...Object.keys(d.vertices).filter(id => inside(pointOf(d, id))),
        ...Object.values(d.segments).filter(sg => inside(pointOf(d, sg.a)) && inside(pointOf(d, sg.b))).map(sg => sg.id),
      ];
      const found = tiny ? [] : wire.length ? wire : Object.keys(d.nodes).filter(id => inside(pointOf(d, id)));
      u.selection = m.additive ? [...new Set([...u.selection, ...found])] : found;
      if (!m.additive) u.conns = [];
    }
    bump();
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const screen = screenOf(event);
    const hit = pick(toWorld(screen.x, screen.y));
    if (hit?.kind !== 'segment' || !hit.at) return;
    // Splits the segment with a new vertex, to make a corner or a fork.
    let created = '';
    commit((d, index) => {
      const at = snapPoint(hit.at!, true);
      const twin = u.mirror ? twinOf(d, index, hit.id) : null;
      created = subdivide(d, hit.id, at);
      if (twin && twin !== hit.id && d.segments[twin]) {
        const tv = subdivide(d, twin, reflect(at));
        d.vertices[created].twin = tv;
        d.vertices[tv].twin = created;
      }
    });
    u.selection = [created];
  };

  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const screen = screenOf(event);
      const before = toWorld(screen.x, screen.y);
      const zoom = Math.max(0.05, Math.min(40, u.cam.zoom * Math.exp(-event.deltaY * 0.0015)));
      u.cam = { zoom, x: before.x - (screen.x - u.size.w / 2) / zoom, y: before.y - (screen.y - u.size.h / 2) / zoom };
      bump();
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    const observer = new ResizeObserver(([entry]) => {
      u.size = { w: entry.contentRect.width, h: entry.contentRect.height };
      bump();
    });
    observer.observe(svg);
    return () => {
      svg.removeEventListener('wheel', onWheel);
      observer.disconnect();
    };
  }, []);

  // Files.
  const openFile = async () => {
    if (dirty && file.name && !window.confirm('Discard unsaved changes?')) return;
    try {
      const picked = await pickFileToOpen();
      if (!picked) return;
      const d = validate(JSON.parse(picked.text));
      setDoc(d);
      undo.current = [];
      redo.current = [];
      u.selection = [];
      u.conns = [];
      u.pool = [];
      setFile({ name: picked.name, handle: picked.handle, savedText: serialize(d) });
      setMessage(`Opened ${picked.name}.`);
      requestAnimationFrame(frameAll);
    } catch (error) {
      setMessage('Could not open: ' + (error as Error).message);
    }
  };
  const save = async (as: boolean) => {
    const name = file.name ?? (docRef.current.name || 'graph').replace(/[^\w-]+/g, '-') + FILE_EXTENSION;
    try {
      const saved = await saveFile(text, name, as ? null : file.handle);
      if (!saved) return;
      setFile({ name: saved.name, handle: saved.handle, savedText: text });
      setMessage(`${saved.downloaded ? 'Downloaded' : 'Saved'} ${saved.name}.`);
    } catch (error) {
      setMessage('Could not save: ' + (error as Error).message);
    }
  };
  const newFile = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setDoc(emptyDoc('Untitled'));
    undo.current = [];
    redo.current = [];
    u.selection = [];
    u.conns = [];
    u.pool = [];
    setFile({ name: null, handle: null, savedText: null });
    u.cam = { x: 0, y: 0, zoom: 1 };
  };

  // Keyboard.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (mod && key === 's') {
      event.preventDefault();
      save(event.shiftKey);
      return;
    }
    if (mod && key === 'b') {
      event.preventDefault();
      bundleSelectedPorts();
      bump();
      return;
    }
    if (mod && key === 'o') {
      event.preventDefault();
      openFile();
      return;
    }
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (u.modal) cancelModal();
      history(key === 'z' && !event.shiftKey);
      return;
    }
    const m = u.modal;
    if (m?.kind === 'grab') {
      if (key === 'escape') cancelModal();
      else if (key === 'enter') confirmGrab(m);
      else if (key === 'x' || key === 'y') {
        m.axis = m.axis === key ? null : key;
        updateGrab(m, event.ctrlKey);
      }
      bump();
      return;
    }
    if (mod) return;
    if (key === 'escape') {
      u.selection = [];
      u.conns = [];
      u.pool = [];
      u.menu = null;
    } else if (key === 'g') {
      const d = docRef.current;
      const ids = u.selection.filter(id => movable(d, id));
      if (ids.length) startGrab(ids, d, d, false);
      if (u.modal) (u.modal as Grab).moved = true;
    } else if (key === 'e') extrude();
    else if (key === 'f') join();
    else if (key === 'x' || key === 'delete' || key === 'backspace') deleteSelection();
    else if (key === 'a' && event.shiftKey) u.menu = { screen: u.mouseScreen, world: u.mouse };
    else if (key === 'a' && event.altKey) {
      u.selection = [];
      u.conns = [];
      u.pool = [];
    } else if (key === 'a') u.selection = Object.keys(docRef.current.vertices);
    else if (key === 'home' || key === '.') frameAll();
    else return;
    event.preventDefault();
    bump();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Drawing.
  const z = u.cam.zoom;
  const { w, h } = u.size;
  const selected = new Set(u.selection);
  const highlightPorts = new Set<string>();
  const focus = u.selection.length === 1 && (doc.ports[u.selection[0]] || doc.vertices[u.selection[0]]) ? u.selection[0] : null;
  const open = focus ? unrouted(doc, index, focus) : [];
  const lit = focus ? open.filter(c => !u.carry || u.carry.includes(c)) : u.conns;
  // Pulse where the connections need to go, not the selected node's own ports, which show stubs.
  for (const c of lit) {
    for (const p of connectionPorts(index, c)) if (p && p !== focus && !selected.has(doc.ports[p].node)) highlightPorts.add(p);
  }
  const wiredPorts = new Set<string>();
  for (const sg of Object.values(doc.segments)) {
    if (doc.ports[sg.a]) wiredPorts.add(sg.a);
    if (doc.ports[sg.b]) wiredPorts.add(sg.b);
  }
  const pulse = 1 + 0.35 * Math.sin(performance.now() / 180);
  const grabHover = u.modal?.kind === 'grab' ? u.modal.hover : null;

  // An infinite grid: lines every grid step (coarsened by fives when zoomed out) over the view.
  const grid: JSX.Element[] = [];
  {
    let step = Math.max(1, doc.style.grid);
    while (step * z < 8) step *= 5;
    const x0 = u.cam.x - w / 2 / z;
    const x1 = u.cam.x + w / 2 / z;
    const y0 = u.cam.y - h / 2 / z;
    const y1 = u.cam.y + h / 2 / z;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const major = Math.round(x / step) % 5 === 0;
      grid.push(<line key={'x' + x} x1={x} y1={y0} x2={x} y2={y1} stroke={major ? '#d3d8e0' : '#e7eaef'} strokeWidth={1} vectorEffect='non-scaling-stroke'/>);
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const major = Math.round(y / step) % 5 === 0;
      grid.push(<line key={'y' + y} x1={x0} y1={y} x2={x1} y2={y} stroke={major ? '#d3d8e0' : '#e7eaef'} strokeWidth={1} vectorEffect='non-scaling-stroke'/>);
    }
    grid.push(<line key='ax' x1={x0} y1={0} x2={x1} y2={0} stroke='rgba(214, 80, 80, 0.55)' strokeWidth={1.5} vectorEffect='non-scaling-stroke'/>);
    grid.push(<line key='ay' x1={0} y1={y0} x2={0} y2={y1} stroke='rgba(70, 160, 90, 0.55)' strokeWidth={1.5} vectorEffect='non-scaling-stroke'/>);
  }

  const skeleton = Object.values(doc.segments).map(sg => {
    const a = pointOf(doc, sg.a);
    const b = pointOf(doc, sg.b);
    if (!a || !b) return null;
    const pending = sg.conns.some(c => !routes[c]);
    return <line key={sg.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={pending ? SELECT : '#9aa3b1'} strokeWidth={pending ? 2 : 1.5}
      strokeDasharray={sg.conns.length ? undefined : '4 3'} vectorEffect='non-scaling-stroke'/>;
  });

  const lines = connectionLines(doc, routes, value, u.conns);

  // Dashed guides for unwired connections: from the selected port or vertex to whichever end its
  // wire has not reached yet, or else between the two ports.
  const reach = (from: string, c: string) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const at = queue.shift()!;
      if (at !== from && doc.ports[at]) continue;
      for (const { to, segment } of index.adjacency.get(at) ?? []) {
        if (!seen.has(to) && doc.segments[segment].conns.includes(c)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen;
  };
  const ghosts = lit.filter(c => doc.connections[c] && !routes[c]).map(c => {
    const [a, b] = connectionPorts(index, c);
    let from = a;
    let to = b;
    if (focus && a && b) {
      const seen = reach(focus, c);
      from = focus;
      to = seen.has(b) && !seen.has(a) ? a : b;
    }
    // A guide leaves a port from the tip of its stub.
    const tipOf = (k: string | undefined) => {
      if (!k) return null;
      const port = doc.ports[k];
      return port ? rimPoint(doc.nodes[port.node], port.angle, STUB / z) : pointOf(doc, k);
    };
    const pa = tipOf(from);
    const pb = tipOf(to);
    if (!pa || !pb) return null;
    return <line key={'g' + c} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={doc.connections[c].weight > 0 ? EXC : INH} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray='6 5' vectorEffect='non-scaling-stroke'/>;
  });

  const nodes = nodeShapes(doc, value, id => runner.caption(id), selected);

  const handle = 1 / z;
  const stubPool = new Set([...u.pool, ...lit]);
  const stubs: JSX.Element[] = [];
  for (const p of Object.values(doc.ports)) {
    const ends = p.ends.filter(e => stubPool.has(e.connection));
    if (!ends.length) continue;
    const open = new Set(unrouted(doc, index, p.id));
    const shown = ends.filter(e => open.has(e.connection));
    shown.forEach((e, k) => {
      const c = doc.connections[e.connection];
      if (!c) return;
      const node = doc.nodes[p.node];
      const angle = p.angle + (k - (shown.length - 1) / 2) * 9;
      const base = rimPoint(node, angle, 1 / z);
      const dir = { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) };
      const len = STUB / z;
      const outer = { x: base.x + dir.x * len, y: base.y + dir.y * len };
      const out = e.side === 'from';
      // The arrowhead or bar sits where the signal arrives: the outer end for an output, the rim for an input.
      const tipAt = out ? outer : base;
      const toward = out ? dir : { x: -dir.x, y: -dir.y };
      const nrm = { x: -toward.y, y: toward.x };
      const color = c.weight > 0 ? EXC : INH;
      const strong = u.conns.includes(c.id);
      const head = c.weight > 0
        ? <path d={`M${tipAt.x} ${tipAt.y}L${tipAt.x - toward.x * 10 / z + nrm.x * 5.5 / z} ${tipAt.y - toward.y * 10 / z + nrm.y * 5.5 / z}L${tipAt.x - toward.x * 10 / z - nrm.x * 5.5 / z} ${tipAt.y - toward.y * 10 / z - nrm.y * 5.5 / z}Z`} fill={color}/>
        : <line x1={tipAt.x + nrm.x * 7 / z} y1={tipAt.y + nrm.y * 7 / z} x2={tipAt.x - nrm.x * 7 / z} y2={tipAt.y - nrm.y * 7 / z} stroke={color} strokeWidth={3} strokeLinecap='round' vectorEffect='non-scaling-stroke'/>;
      const lineEnd = out && c.weight > 0 ? { x: outer.x - dir.x * 9 / z, y: outer.y - dir.y * 9 / z } : outer;
      const lineStart = !out && c.weight > 0 ? { x: base.x + dir.x * 9 / z, y: base.y + dir.y * 9 / z } : base;
      stubs.push(
        <g key={'stub' + p.id + e.connection} opacity={strong ? 1 : 0.45}>
          <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y} stroke={color} strokeWidth={2.75} strokeLinecap='round' vectorEffect='non-scaling-stroke'/>
          {head}
        </g>,
      );
    });
  }

  const ports = Object.values(doc.ports).map(p => {
    const at = portPoint(doc, p);
    const lit = highlightPorts.has(p.id);
    const sel = selected.has(p.id);
    return (
      <g key={p.id}>
        {lit && <circle cx={at.x} cy={at.y} r={8 * pulse * handle} fill='none' stroke={SELECT} strokeWidth={2.5} vectorEffect='non-scaling-stroke'/>}
        {grabHover === p.id && <circle cx={at.x} cy={at.y} r={9 * handle} fill='none' stroke={HOVER} strokeWidth={2.5} vectorEffect='non-scaling-stroke'/>}
        <circle cx={at.x} cy={at.y} r={(sel ? 5 : p.ends.length > 1 ? 4.2 : 3.2) * handle} fill={sel || lit ? SELECT : wiredPorts.has(p.id) ? INK : '#ffffff'}
          stroke={sel ? INK : '#7d8796'} strokeWidth={1.2} vectorEffect='non-scaling-stroke'/>
      </g>
    );
  });

  const vertices = Object.values(doc.vertices).filter(v => u.showVertices || selected.has(v.id)).map(v => (
    <g key={v.id}>
      {grabHover === v.id && <circle cx={v.x} cy={v.y} r={9 * handle} fill='none' stroke={HOVER} strokeWidth={2.5} vectorEffect='non-scaling-stroke'/>}
      <circle cx={v.x} cy={v.y} r={(selected.has(v.id) ? 4.5 : 3.5) * handle} fill={selected.has(v.id) ? SELECT : '#ffffff'} stroke={INK} strokeWidth={1.3} vectorEffect='non-scaling-stroke'/>
    </g>
  ));

  const selectedSegments = u.selection.filter(id => doc.segments[id]).map(id => {
    const a = pointOf(doc, doc.segments[id].a);
    const b = pointOf(doc, doc.segments[id].b);
    return a && b ? <line key={'sel' + id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SELECT} strokeWidth={4} vectorEffect='non-scaling-stroke'/> : null;
  });

  const box = u.modal?.kind === 'box' ? u.modal : null;
  const grab = u.modal?.kind === 'grab' ? u.modal : null;

  const status = grab
    ? `Moving ${grab.ids.length} · click or Enter to place, right-click or Esc to cancel · X/Y lock an axis${grab.axis ? ` (${grab.axis} locked)` : ''} · Ctrl toggles snapping${grab.hover ? ' · release to join' : ''}`
    : 'E extrude · G grab · F join · X delete · double-click a wire to add a vertex · Shift+A add node · middle-drag pan · wheel zoom · Home frame all';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1, display: 'flex', flexDirection: 'column', background: '#eef0f4', fontFamily: 'Inter, system-ui, sans-serif', color: INK, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', background: '#ffffff', borderBottom: '1px solid #d9dee5' }}>
        <span style={{ fontWeight: 700, marginRight: 4 }}>GraphEd</span>
        <Button onClick={newFile}>New</Button>
        <Button onClick={openFile}>Open</Button>
        <Button onClick={() => save(false)}>Save</Button>
        <Button onClick={() => save(true)}>Save as</Button>
        <span style={{ color: MUTED, minWidth: 140 }}>{(file.name ?? 'Unsaved') + (dirty ? ' •' : '')}</span>
        <Divider/>
        {presets.map(p => (
          <Button key={p.key} active={preset === p.key} onClick={() => {
            u.preset = p.key;
            bump();
          }}>{p.label}</Button>
        ))}
        {presets.length > 0 && <Divider/>}
        <Button active={u.playing} onClick={() => {
          u.playing = !u.playing;
          bump();
        }}>{u.playing ? 'Pause' : 'Play'}</Button>
        <Button active={u.slow} onClick={() => {
          u.slow = !u.slow;
          bump();
        }}>10× slower</Button>
        <Divider/>
        <Toggle label='Snap' value={u.snap} set={v => (u.snap = v)} bump={bump}/>
        <Toggle label='Mirror' value={u.mirror} set={v => (u.mirror = v)} bump={bump}/>
        <Toggle label='Vertices' value={u.showVertices} set={v => (u.showVertices = v)} bump={bump}/>
        <Button onClick={frameAll}>Frame all</Button>
        <span style={{ color: MUTED, fontVariantNumeric: 'tabular-nums', minWidth: 110 }}>x {Math.round(u.mouse.x)}, y {Math.round(u.mouse.y)}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block', background: '#f7f8fa', touchAction: 'none', userSelect: 'none', cursor: grab ? 'move' : 'default' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick}
            onContextMenu={event => event.preventDefault()}>
            <g transform={`translate(${w / 2 - u.cam.x * z} ${h / 2 - u.cam.y * z}) scale(${z})`} fontFamily='Inter, system-ui, sans-serif'>
              {grid}
              {skeleton}
              {lines}
              {ghosts}
              {nodes}
              {selectedSegments}
              {stubs}
              {ports}
              {vertices}
              {box && <rect x={Math.min(box.a.x, box.b.x)} y={Math.min(box.a.y, box.b.y)} width={Math.abs(box.b.x - box.a.x)} height={Math.abs(box.b.y - box.a.y)}
                fill='rgba(224, 161, 0, 0.08)' stroke={SELECT} strokeWidth={1} strokeDasharray='4 3' vectorEffect='non-scaling-stroke'/>}
            </g>
          </svg>
          <div style={{ position: 'absolute', left: 10, bottom: 8, right: 10, color: MUTED, fontSize: 12, pointerEvents: 'none' }}>{status}</div>
          {u.menu && (
            <div style={{ position: 'absolute', left: u.menu.screen.x, top: u.menu.screen.y, background: '#ffffff', border: '1px solid #c9cfd8', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 4, display: 'flex', flexDirection: 'column', minWidth: 140 }}
              onPointerDown={event => event.stopPropagation()}>
              <div style={{ padding: '4px 8px', color: MUTED, fontSize: 11 }}>Add node</div>
              {(['circle', 'split', 'box'] as NodeShape[]).map(shape => (
                <button key={shape} type='button' style={menuItem} onClick={() => {
                  addNodeAt(shape, u.menu!.world);
                  bump();
                }}>{{ circle: 'Circle unit', split: 'Split oscillator', box: 'Box' }[shape]}</button>
              ))}
            </div>
          )}
        </div>
        <Panel doc={doc} index={index} routes={routes} ui={u} bump={bump} commit={commit} bundle={bundle} runner={runner} open={open} bundlePorts={bundleSelectedPorts}
          message={message} text={text} setDocFromText={t => {
            try {
              const d = validate(JSON.parse(t));
              commit(target => Object.assign(target, d));
              setMessage('Applied.');
            } catch (error) {
              setMessage('Could not apply: ' + (error as Error).message);
            }
          }}/>
      </div>
    </div>
  );
}

const menuItem = { textAlign: 'left' as const, padding: '6px 8px', border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', borderRadius: 5 };

type PanelProps = {
  doc: GraphDoc; index: Index; routes: Record<string, Route | null>; ui: UI; bump: () => void;
  commit: (fn: (d: GraphDoc, index: Index) => void) => void; bundle: (side: 'from' | 'to') => void; runner: Runner;
  message: string; text: string; setDocFromText: (text: string) => void; open: string[]; bundlePorts: () => void;
};

function Panel({ doc, index, routes, ui, bump, commit, bundle, runner, message, text, setDocFromText, open, bundlePorts: bundleSelected }: PanelProps) {
  const sel = ui.selection;
  const one = sel.length === 1 ? sel[0] : null;
  const unitLabel = (unit: string) => {
    const n = doc.nodes[index.unitNode.get(unit) ?? ''];
    if (!n) return unit;
    return n.shape === 'split' ? `${n.label} ${n.units.find(x => x.id === unit)?.label ?? ''}` : n.label;
  };
  const selectConns = (ids: string[], additive: boolean) => {
    ui.conns = additive ? [...new Set([...ui.conns, ...ids])].filter(id => !(ui.conns.includes(id) && ids.includes(id) && ids.length === 1)) : ids;
    ui.pool = [...ui.conns];
    ui.selection = [];
    bump();
  };
  const wiredCount = Object.values(routes).filter(Boolean).length;
  const partial = new Set(Object.values(doc.segments).flatMap(sg => sg.conns));
  const bySource = new Map<string, string[]>();
  for (const c of Object.values(doc.connections)) {
    const node = index.unitNode.get(c.from) ?? '?';
    if (!bySource.has(node)) bySource.set(node, []);
    bySource.get(node)!.push(c.id);
  }

  return (
    <div style={{ width: 340, flexShrink: 0, overflowY: 'auto', background: '#ffffff', borderLeft: '1px solid #d9dee5', padding: 14, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ui.pool.length > 1 && (
        <Section title={`In view · ${ui.conns.length} of ${ui.pool.length} ticked`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflowY: 'auto' }}>
            {ui.pool.filter(c => doc.connections[c]).map(id => {
              const c = doc.connections[id];
              const node = one && doc.nodes[one] ? doc.nodes[one] : null;
              const out = node ? node.units.some(x => x.id === c.from) : null;
              return (
                <label key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                  <input type='checkbox' checked={ui.conns.includes(id)} onChange={event => {
                    ui.conns = event.target.checked ? [...ui.conns, id] : ui.conns.filter(x => x !== id);
                    bump();
                  }}/>
                  <StubIcon out={out ?? true} excitatory={c.weight > 0}/>
                  {out !== null && <span style={{ width: 22, color: MUTED }}>{out ? 'out' : 'in'}</span>}
                  <span style={{ flex: 1 }}>{unitLabel(c.from)} → {unitLabel(c.to)}</span>
                  <span style={{ color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{c.weight}</span>
                  <span style={{ width: 12, color: routes[id] ? '#2e9d57' : '#b9c1cc' }}>{routes[id] ? '✓' : '○'}</span>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <SmallButton onClick={() => { ui.conns = [...ui.pool]; bump(); }}>All</SmallButton>
            <SmallButton onClick={() => { ui.conns = ui.pool.filter(c => !routes[c]); bump(); }}>Unwired</SmallButton>
            <SmallButton onClick={() => { ui.conns = []; bump(); }}>None</SmallButton>
          </div>
        </Section>
      )}

      {one && doc.nodes[one] && <NodeInspector node={doc.nodes[one]} doc={doc} index={index} commit={commit} runner={runner} ui={ui} bump={bump}/>}
      {one && doc.vertices[one] && (
        <Section title='Vertex'>
          <Row label='x'><NumberInput value={doc.vertices[one].x} onChange={x => commit(d => { d.vertices[one].x = x; })}/></Row>
          <Row label='y'><NumberInput value={doc.vertices[one].y} onChange={y => commit(d => { d.vertices[one].y = y; })}/></Row>
          <Row label='Corner radius'>
            <NumberInput value={doc.vertices[one].corner ?? doc.style.corner} min={0} onChange={c => commit(d => { d.vertices[one].corner = Math.max(0, c); })}/>
            <SmallButton onClick={() => commit(d => { delete d.vertices[one].corner; })}>Default</SmallButton>
          </Row>
          <Hint>{doc.vertices[one].twin ? 'Mirrored by another vertex.' : 'No mirror twin.'} A large corner radius makes a smooth curve.</Hint>
        </Section>
      )}
      {one && (doc.ports[one] || doc.vertices[one]) && (
        <Section title={`Unrouted here · ${open.length}`}>
          {open.length === 0
            ? <Hint>Every connection through here continues on a wire.</Hint>
            : <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto' }}>
                {open.map(c => (
                  <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                    <input type='checkbox' checked={!ui.carry || ui.carry.includes(c)} onChange={event => {
                      const current = ui.carry ?? open;
                      ui.carry = event.target.checked ? [...current, c] : current.filter(x => x !== c);
                      bump();
                    }}/>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: (doc.connections[c]?.weight ?? 0) > 0 ? '#c42020' : '#1c4ec4' }}/>
                    {unitLabel(doc.connections[c]?.from ?? '')} → {unitLabel(doc.connections[c]?.to ?? '')}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <SmallButton onClick={() => { ui.carry = null; bump(); }}>All</SmallButton>
                <SmallButton onClick={() => { ui.carry = []; bump(); }}>None</SmallButton>
              </div>
              <Hint>E extrudes a wire carrying the ticked connections; their other ends pulse. Drop the wire on a port or vertex to join it.</Hint>
            </>}
        </Section>
      )}
      {sel.length > 1 && sel.every(id => doc.vertices[id]) && (
        <Section title={`${sel.length} vertices`}>
          <Row label='Corner radius'>
            <NumberInput value={doc.vertices[sel[0]].corner ?? doc.style.corner} min={0} onChange={c => commit(d => { for (const id of sel) d.vertices[id].corner = Math.max(0, c); })}/>
          </Row>
        </Section>
      )}
      {sel.length > 1 && sel.every(id => doc.ports[id]) && (
        <Section title={`${sel.length} ports`}>
          <Button onClick={bundleSelected}>Bundle ports (Ctrl+B)</Button>
          <Hint>Ports bundle in groups on the same unit (for a split oscillator, the same half) going the same way: all outputs or all inputs. Signs may mix.</Hint>
          <div style={{ color: MUTED, fontSize: 12 }}>{message}</div>
        </Section>
      )}
      {one && doc.ports[one] && (
        <Section title={`Port on ${unitLabel(doc.ports[one].unit)}`}>
          <Row label='Angle'><NumberInput value={doc.ports[one].angle} onChange={a => commit(d => {
            const p = d.ports[one];
            p.angle = clampPortAngle(d.nodes[p.node], p.unit, a);
          })}/></Row>
          <Hint>{doc.ports[one].ends.length > 1 ? `Bundle of ${doc.ports[one].ends.length} connection ends.` : 'One connection end.'} Highlighted ports are where its connections need to go.</Hint>
          {doc.ports[one].ends.length > 1 && <Button onClick={() => commit(d => { unbundlePort(d, one); })}>Unbundle</Button>}
        </Section>
      )}
      {one && doc.segments[one] && (
        <Section title={`Wire segment · carries ${doc.segments[one].conns.length}`}>
          {doc.segments[one].conns.map(c => (
            <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
              <input type='checkbox' checked onChange={() => commit(d => { d.segments[one].conns = d.segments[one].conns.filter(x => x !== c); })}/>
              {unitLabel(doc.connections[c]?.from ?? '')} → {unitLabel(doc.connections[c]?.to ?? '')}
            </label>
          ))}
          <Hint>Untick to take a connection off this piece of wire. Gray wire carries nothing; amber wire carries connections that do not reach their target yet. Double-click the wire to add a vertex; X deletes it.</Hint>
        </Section>
      )}

      {ui.conns.length > 0 && (
        <Section title={ui.conns.length === 1 ? 'Connection' : `${ui.conns.length} connections`}>
          {ui.conns.length === 1 && doc.connections[ui.conns[0]] && (() => {
            const c = doc.connections[ui.conns[0]];
            return (
              <>
                <div>{unitLabel(c.from)} → {unitLabel(c.to)} · {routes[c.id] ? 'wired' : 'not wired'}</div>
                <Row label='Weight'><NumberInput value={c.weight} step={0.05} onChange={wt => commit(d => { d.connections[c.id].weight = wt; })}/></Row>
              </>
            );
          })()}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button onClick={() => bundle('from')}>Bundle sources</Button>
            <Button onClick={() => bundle('to')}>Bundle targets</Button>
            <Button onClick={() => {
              if (!window.confirm(`Delete ${ui.conns.length} connection(s)?`)) return;
              commit(d => { for (const c of ui.conns) removeConnection(d, c); });
              ui.conns = [];
              ui.pool = [];
            }}>Delete</Button>
          </div>
          <Hint>Bundle sources merges the ticked connections' output ends that leave the same unit into one port; Bundle targets does the same for input ends arriving at the same unit{ui.mirror ? ', on both sides of the mirror' : ''}. Signs may mix. Wire a bundle as a trunk, then extrude branches from a vertex on it to fork.</Hint>
        </Section>
      )}

      {(() => {
        const unwired = Object.keys(doc.connections).filter(c => !routes[c]);
        const reachable = unwired.filter(c => {
          const [a, b] = connectionPorts(index, c);
          return a && b && findPath(doc, index, null, a, b);
        });
        const segs = sel.filter(id => doc.segments[id]);
        if (!reachable.length && !(segs.length && ui.conns.length)) return null;
        return (
          <Section title='Repair wiring'>
            {reachable.length > 0 && <>
              <Button onClick={() => commit(d => { routeAlongWire(d, reachable); })}>Route {reachable.length} along drawn wire</Button>
              <Hint>These connections are not wired, but drawn wire already joins their two ports. This routes each along the shortest such way.</Hint>
            </>}
            {segs.length > 0 && ui.conns.length > 0 && <>
              <Button onClick={() => commit(d => {
                for (const id of segs) d.segments[id].conns = [...new Set([...d.segments[id].conns, ...ui.conns])];
              })}>Carry {ui.conns.length} ticked on {segs.length} selected segment(s)</Button>
              <Hint>Adds the ticked connections to the selected pieces of wire. Shift+click segments to select several.</Hint>
            </>}
          </Section>
        );
      })()}

      <Section title={`Connections · ${wiredCount} of ${Object.keys(doc.connections).length} wired`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 280, overflowY: 'auto', border: '1px solid #e3e7ec', borderRadius: 6 }}>
          {[...bySource.entries()].map(([node, ids]) => (
            <div key={node}>
              <div style={{ padding: '4px 8px', background: '#f3f5f8', color: MUTED, fontSize: 11, cursor: 'pointer' }}
                onClick={event => selectConns(ids, event.shiftKey || event.ctrlKey)}>{doc.nodes[node]?.label ?? node} · {node}</div>
              {ids.map(id => {
                const c = doc.connections[id];
                const on = ui.conns.includes(id);
                return (
                  <div key={id} onClick={event => selectConns([id], event.shiftKey || event.ctrlKey)}
                    style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 8px', cursor: 'pointer', background: on ? '#fff3d1' : 'transparent', fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: c.weight > 0 ? '#c42020' : '#1c4ec4', flexShrink: 0 }}/>
                    <span style={{ flex: 1 }}>{unitLabel(c.from)} → {unitLabel(c.to)}</span>
                    <span style={{ color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{c.weight}</span>
                    <span style={{ width: 14, color: routes[id] ? '#2e9d57' : partial.has(id) ? SELECT : '#b9c1cc' }}>{routes[id] ? '✓' : partial.has(id) ? '◐' : '○'}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <Hint>Click to select (Shift or Ctrl to add); click a group header to select all of a node's outputs.</Hint>
      </Section>

      <DocumentSection doc={doc} commit={commit} message={message} text={text} setDocFromText={setDocFromText}/>
    </div>
  );
}

function NodeInspector({ node, doc, index, commit, runner, ui, bump }: {
  node: GNode; doc: GraphDoc; index: Index; commit: PanelProps['commit']; runner: Runner; ui: UI; bump: () => void;
}) {
  const id = node.id;
  const [target, setTarget] = useState('');
  const [fromUnit, setFromUnit] = useState(node.units[0]?.id ?? '');
  const [weight, setWeight] = useState(1);
  const set = (fn: (n: GNode, d: GraphDoc) => void) => commit((d, idx) => {
    fn(d.nodes[id], d);
    const t = ui.mirror ? twinOf(d, idx, id) : null;
    if (t && t !== id) {
      const a = d.nodes[id];
      const b = d.nodes[t];
      Object.assign(b, { r: a.r, w: a.w, h: a.h, shape: a.shape, labelAt: a.labelAt, x: a.x, y: -a.y, angle: -a.angle });
    }
  });
  const allUnits = Object.values(doc.nodes).flatMap(n => n.units.map(un => ({ id: un.id, label: n.shape === 'split' ? `${n.label} ${un.label}` : n.label })));
  return (
    <Section title={`Node · ${id}`}>
      <Row label='Label'><TextInput value={node.label} onChange={v => set(n => { n.label = v; if (n.shape !== 'split' && n.units[0]) n.units[0].label = v; })}/></Row>
      <Row label='Shape'>
        <select value={node.shape} style={selectStyle} onChange={event => set(n => {
          const shape = event.target.value as NodeShape;
          if ((shape === 'split') !== (n.shape === 'split')) {
            window.alert('Changing between split and whole nodes would change its units; make a new node instead.');
            return;
          }
          n.shape = shape;
        })}>
          {node.shape === 'split' ? <option value='split'>Split</option> : <><option value='circle'>Circle</option><option value='box'>Box</option></>}
        </select>
      </Row>
      <Row label='x'><NumberInput value={node.x} onChange={x => set(n => { n.x = x; })}/></Row>
      <Row label='y'><NumberInput value={node.y} onChange={y => set(n => { n.y = y; })}/></Row>
      {node.shape === 'box'
        ? <>
          <Row label='Width'><NumberInput value={node.w} min={4} onChange={v => set(n => { n.w = Math.max(4, v); })}/></Row>
          <Row label='Height'><NumberInput value={node.h} min={4} onChange={v => set(n => { n.h = Math.max(4, v); })}/></Row>
        </>
        : <Row label='Radius'><NumberInput value={node.r} min={2} onChange={v => set(n => { n.r = Math.max(2, v); })}/></Row>}
      {node.shape === 'split' && <Row label='Facing (°)'><NumberInput value={node.angle} step={15} onChange={v => set(n => { n.angle = v; })}/></Row>}
      <Row label='Label at'>
        <select value={node.labelAt} style={selectStyle} onChange={event => set(n => { n.labelAt = event.target.value as LabelAt; })}>
          {['inside', 'left', 'right', 'top', 'bottom', 'none'].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </Row>
      <Row label='Mirror twin'>
        <select value={node.twin ?? ''} style={selectStyle} onChange={event => commit(d => {
          const t = event.target.value;
          if (d.nodes[id].twin && d.nodes[d.nodes[id].twin!]) delete d.nodes[d.nodes[id].twin!].twin;
          if (t) {
            d.nodes[id].twin = t;
            d.nodes[t].twin = id;
          } else delete d.nodes[id].twin;
        })}>
          <option value=''>{Math.abs(node.y) < 0.5 ? '(on the axis)' : 'none'}</option>
          {Object.values(doc.nodes).filter(n => n.id !== id).map(n => <option key={n.id} value={n.id}>{n.label} · {n.id}</option>)}
        </select>
      </Row>
      {node.units.map((unit, i) => (
        <div key={unit.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #eef0f4', paddingTop: 8 }}>
          <div style={{ color: MUTED }}>Unit {unit.id}</div>
          {node.shape === 'split' && <Row label='Label'><TextInput value={unit.label} onChange={v => commit(d => { d.nodes[id].units[i].label = v; })}/></Row>}
          <Row label='Color (r, g, b)'><TextInput value={unit.color ?? ''} onChange={v => commit(d => { d.nodes[id].units[i].color = v || undefined; })}/></Row>
          <Row label='Activity'>
            <TextInput value={doc.animation.activity[unit.id] ?? ''} onChange={v => commit(d => {
              if (v) d.animation.activity[unit.id] = v;
              else delete d.animation.activity[unit.id];
            })}/>
          </Row>
          {runner.errors[unit.id] && <div style={{ color: '#c42020', fontSize: 12 }}>{runner.errors[unit.id]}</div>}
        </div>
      ))}
      <Row label='Caption'>
        <TextInput value={doc.animation.captions[id] ?? ''} onChange={v => commit(d => {
          if (v) d.animation.captions[id] = v;
          else delete d.animation.captions[id];
        })}/>
      </Row>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #eef0f4', paddingTop: 8 }}>
        <div style={{ color: MUTED }}>New connection</div>
        {node.units.length > 1 && (
          <select value={fromUnit} style={selectStyle} onChange={event => setFromUnit(event.target.value)}>
            {node.units.map(un => <option key={un.id} value={un.id}>from {un.label}</option>)}
          </select>
        )}
        <select value={target} style={selectStyle} onChange={event => setTarget(event.target.value)}>
          <option value=''>to…</option>
          {allUnits.map(un => <option key={un.id} value={un.id}>{un.label} · {un.id}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberInput value={weight} step={0.05} onChange={setWeight}/>
          <Button disabled={!target} onClick={() => {
            const from = node.units.length > 1 ? fromUnit : node.units[0].id;
            commit((d, idx) => {
              const made = addConnection(d, idx, from, target, weight);
              if (made && ui.mirror) {
                const tf = twinOf(d, idx, idx.unitNode.get(from)!);
                if (tf) {
                  const fresh = buildIndex(d);
                  const a = twinUnitOf(d, fresh, from);
                  const b = twinUnitOf(d, fresh, target);
                  if (a && b && !(a === from && b === target)) addConnection(d, fresh, a, b, weight);
                }
              }
            });
            setTarget('');
            ui.conns = [`${from}->${target}`];
            bump();
          }}>Add</Button>
        </div>
      </div>
      <Button onClick={() => commit((d, idx) => {
        spreadPorts(d, id);
        const t = ui.mirror ? twinOf(d, idx, id) : null;
        if (t && t !== id) spreadPorts(d, t);
      })}>Spread ports</Button>
      <Button onClick={() => {
        if (!window.confirm('Delete this node and its connections?')) return;
        commit(d => removeNode(d, id));
        ui.selection = [];
      }}>Delete node</Button>
    </Section>
  );
}

function twinUnitOf(doc: GraphDoc, index: Index, unit: string): string | null {
  const node = index.unitNode.get(unit);
  if (!node) return null;
  const t = twinOf(doc, index, node);
  if (!t) return null;
  if (t === node) return unit;
  const i = doc.nodes[node].units.findIndex(x => x.id === unit);
  return doc.nodes[t].units[i]?.id ?? null;
}

function DocumentSection({ doc, commit, message, text, setDocFromText }: {
  doc: GraphDoc; commit: PanelProps['commit']; message: string; text: string; setDocFromText: (t: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [presetDraft, setPresetDraft] = useState<string | null>(null);
  const presetText = JSON.stringify({ tick: doc.animation.tick, ease: doc.animation.ease, cyclic: doc.animation.cyclic, presets: doc.animation.presets }, null, 1);
  return (
    <>
      <Section title='Document'>
        <Row label='Name'><TextInput value={doc.name} onChange={v => commit(d => { d.name = v; })}/></Row>
        <Row label='Grid step'><NumberInput value={doc.style.grid} min={1} onChange={v => commit(d => { d.style.grid = Math.max(1, v); })}/></Row>
        <Row label='Line width ×'><NumberInput value={doc.style.lineWidth} step={0.1} min={0.1} onChange={v => commit(d => { d.style.lineWidth = Math.max(0.1, v); })}/></Row>
        <Row label='Corner radius'><NumberInput value={doc.style.corner} min={0} onChange={v => commit(d => { d.style.corner = Math.max(0, v); })}/></Row>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type='checkbox' checked={doc.style.borders ?? true} onChange={event => commit(d => { d.style.borders = event.target.checked; })}/>
          Node borders
        </label>
      </Section>
      <Section title='Animation presets'>
        <textarea value={presetDraft ?? presetText} onChange={event => setPresetDraft(event.target.value)} spellCheck={false} style={codeArea(150)}/>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button disabled={presetDraft === null} onClick={() => {
            try {
              const p = JSON.parse(presetDraft!);
              commit(d => Object.assign(d.animation, { tick: p.tick, ease: p.ease, cyclic: p.cyclic ?? [], presets: p.presets }));
              setPresetDraft(null);
            } catch (error) {
              window.alert((error as Error).message);
            }
          }}>Apply</Button>
          <Button disabled={presetDraft === null} onClick={() => setPresetDraft(null)}>Revert</Button>
        </div>
        <Hint>Each preset sets variables that units' activity expressions use. A `period` variable sets the cycle length; names listed in `cyclic` ease around the wrap.</Hint>
      </Section>
      <Section title='Document JSON'>
        <textarea value={draft ?? text} onChange={event => setDraft(event.target.value)} spellCheck={false} style={codeArea(160)}/>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button onClick={() => navigator.clipboard.writeText(text)}>Copy</Button>
          <Button disabled={draft === null} onClick={() => {
            setDocFromText(draft!);
            setDraft(null);
          }}>Apply edited JSON</Button>
        </div>
        <div style={{ minHeight: 18, color: MUTED }}>{message}</div>
      </Section>
    </>
  );
}

const selectStyle = { height: 28, border: '1px solid #c9cfd8', borderRadius: 6, font: 'inherit', padding: '0 4px', maxWidth: 200 };
const codeArea = (height: number) => ({ width: '100%', height, boxSizing: 'border-box' as const, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, border: '1px solid #c9cfd8', borderRadius: 6, padding: 6 });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 100, flexShrink: 0, color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.45 }}>{children}</div>;
}

// Keeps its own text while focused, so partial entries are allowed; commits each valid number.
function NumberInput({ value, step = 1, min, onChange }: { value: number; step?: number; min?: number; onChange: (v: number) => void }) {
  const [textValue, setText] = useState<string | null>(null);
  return (
    <input type='number' value={textValue ?? String(Math.round(value * 1000) / 1000)} step={step} min={min}
      onChange={event => {
        setText(event.target.value);
        const v = parseFloat(event.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      onBlur={() => setText(null)}
      style={{ width: 80, height: 28, boxSizing: 'border-box', border: '1px solid #c9cfd8', borderRadius: 6, padding: '0 6px', fontVariantNumeric: 'tabular-nums' }}/>
  );
}

// Commits when focus leaves or Enter is pressed, so typing does not flood the undo history.
function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [textValue, setText] = useState<string | null>(null);
  const done = () => {
    if (textValue !== null && textValue !== value) onChange(textValue);
    setText(null);
  };
  return (
    <input value={textValue ?? value} onChange={event => setText(event.target.value)} onBlur={done}
      onKeyDown={event => event.key === 'Enter' && done()}
      style={{ flex: 1, minWidth: 0, height: 28, boxSizing: 'border-box', border: '1px solid #c9cfd8', borderRadius: 6, padding: '0 6px', font: 'inherit', fontSize: 12 }}/>
  );
}

function Toggle({ label, value, set, bump }: { label: string; value: boolean; set: (v: boolean) => void; bump: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
      <input type='checkbox' checked={value} onChange={event => {
        set(event.target.checked);
        bump();
      }}/>
      {label}
    </label>
  );
}

function Button({ active = false, disabled = false, onClick, children }: { active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type='button' disabled={disabled} onClick={onClick}
      style={{
        minHeight: 30, padding: '0 11px', borderRadius: 7, border: `1.5px solid ${INK}`, cursor: disabled ? 'default' : 'pointer',
        font: 'inherit', fontWeight: 500, opacity: disabled ? 0.4 : 1, background: active ? INK : '#ffffff', color: active ? '#ffffff' : INK,
      }}>
      {children}
    </button>
  );
}

// The stub drawn on the canvas, as a legend: out of or into a node, ending in an arrowhead or a bar.
function StubIcon({ out, excitatory }: { out: boolean; excitatory: boolean }) {
  const color = excitatory ? EXC : INH;
  const tip = out ? 15 : 3;
  const back = out ? -6 : 6;
  return (
    <svg width={18} height={12} viewBox='0 0 18 12' style={{ flexShrink: 0 }}>
      <line x1={out ? 3 : 15} y1={6} x2={excitatory ? tip - back : tip} y2={6} stroke={color} strokeWidth={2}/>
      {excitatory
        ? <path d={`M${tip} 6L${tip + back} 2L${tip + back} 10Z`} fill={color}/>
        : <line x1={tip} y1={1.5} x2={tip} y2={10.5} stroke={color} strokeWidth={2.5} strokeLinecap='round'/>}
      <line x1={out ? 1 : 17} y1={1} x2={out ? 1 : 17} y2={11} stroke='#9aa3b1' strokeWidth={1.5}/>
    </svg>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type='button' onClick={onClick} style={{ height: 26, border: '1px solid #c9cfd8', borderRadius: 6, background: '#ffffff', cursor: 'pointer', font: 'inherit', fontSize: 12 }}>{children}</button>;
}

function Divider() {
  return <div style={{ width: 1, height: 22, background: '#d9dee5' }}/>;
}
