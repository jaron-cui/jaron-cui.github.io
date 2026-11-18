import { Color, Scene } from './model';
import { EllipsoidItem, MeshItem, projectScene, ShapeItem } from './project';

// The largest error from flattening curves, in device pixels.
const FLATTENING_TOLERANCE = 0.25;
const HIGHLIGHT_WIDTH = 2.5;

// How the viewer looks at the camera's image: zoom about the image origin, then pan in CSS pixels.
// This is not part of the scene, and does not change what the camera sees.
export type View = { panX: number; panY: number; zoom: number };

function toCssColor({ r, g, b, a }: Color): string {
  return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
}

function drawShape(ctx: CanvasRenderingContext2D, { runs, fill, stroke }: ShapeItem) {
  const path = new Path2D();
  for (const { points, closed } of runs) {
    points.forEach(({ x, y }, i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    if (closed) {
      path.closePath();
    }
  }
  if (fill) {
    ctx.fillStyle = toCssColor(fill);
    ctx.fill(path);
  }
  if (stroke && stroke.width > 0) {
    ctx.strokeStyle = toCssColor(stroke.color);
    ctx.lineWidth = stroke.width;
    ctx.lineJoin = 'miter';
    ctx.stroke(path);
  }
}

type Bounds = { x0: number; y0: number; x1: number; y1: number };

// Unfilled items are stroked on this scratch canvas, have their inside cut away there, and are copied
// back over their own bounds, so only the outer half of the stroke reaches the canvas, as when the
// fill covers the inner half.
let scratch: OffscreenCanvas | HTMLCanvasElement | null = null;

function scratchFor(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  const { width, height } = ctx.canvas;
  scratch ??= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }
  return scratch.getContext('2d') as unknown as CanvasRenderingContext2D;
}

// Runs `paint` on the scratch canvas within `bounds` (image space), cuts away the inside of `inside`,
// and copies the result onto `ctx`.
function drawUnfilled(ctx: CanvasRenderingContext2D, bounds: Bounds, inside: Path2D, paint: (target: CanvasRenderingContext2D) => void) {
  const transform = ctx.getTransform();
  const corners = [[bounds.x0, bounds.y0], [bounds.x1, bounds.y0], [bounds.x0, bounds.y1], [bounds.x1, bounds.y1]]
    .map(([x, y]) => transform.transformPoint({ x, y }));
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...corners.map(p => p.x))));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...corners.map(p => p.y))));
  if (x1 <= x0 || y1 <= y0) {
    return;
  }
  const layer = scratchFor(ctx);
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(x0, y0, x1 - x0, y1 - y0);
  layer.beginPath();
  layer.rect(x0, y0, x1 - x0, y1 - y0);
  layer.clip();
  layer.setTransform(transform);
  paint(layer);
  layer.globalCompositeOperation = 'destination-out';
  layer.fill(inside, 'nonzero');
  layer.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

function boundsOf(points: Iterable<{ x: number; y: number }>, pad: number): Bounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const { x, y } of points) {
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
  }
  return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
}

// Strokes every triangle edge at twice the border's width, then paints the fill over everything
// inside the silhouette. Only the outer half of the silhouette's stroke remains visible. Unfilled,
// the inside is cut away instead (drawUnfilled).
function drawMesh(ctx: CanvasRenderingContext2D, item: MeshItem) {
  const { polygons, lines, border, highlight } = item;
  const path = new Path2D();
  for (const polygon of polygons) {
    polygon.forEach(({ x, y }, i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
  }
  const borderWidth = border?.width ?? 0;
  if (item.filled === false) {
    if (borderWidth > 0 || highlight) {
      const pad = 2 * (borderWidth + (highlight ? HIGHLIGHT_WIDTH : 0)) + 1;
      const points = [...polygons.flat(), ...lines.flat()];
      drawUnfilled(ctx, boundsOf(points, pad), path, target => strokeMesh(target, item, path));
    }
  } else {
    strokeMesh(ctx, item, path);
    fillMesh(ctx, item, path);
  }
  drawMarks(ctx, item);
}

// The border (and any selection highlight) round the silhouette, at twice their widths, and the
// standalone lines.
function strokeMesh(ctx: CanvasRenderingContext2D, { lines, outline: outlined, border, highlight }: MeshItem, path: Path2D) {
  const borderWidth = border?.width ?? 0;
  if (borderWidth > 0 || highlight) {
    const linePath = new Path2D();
    for (const [from, to] of lines) {
      linePath.moveTo(from.x, from.y);
      linePath.lineTo(to.x, to.y);
    }
    const outline = new Path2D(path);
    outline.addPath(linePath);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Everything but its outermost ring gets painted over, which leaves only the perimeter lit. A
    // selection shows round the whole silhouette, outlined or not.
    if (highlight) {
      ctx.strokeStyle = toCssColor({ ...highlight, a: 1 });
      ctx.lineWidth = (borderWidth + HIGHLIGHT_WIDTH) * 2;
      ctx.stroke(outline);
    }
    if (border && borderWidth > 0 && (outlined !== false || lines.length)) {
      ctx.strokeStyle = toCssColor(border.color);
      ctx.lineWidth = borderWidth * 2;
      ctx.stroke(outlined === false ? linePath : outline);
    }
    ctx.lineCap = 'butt';
  }
}

function fillMesh(ctx: CanvasRenderingContext2D, { outline: outlined, fill }: MeshItem, path: Path2D) {
  ctx.fillStyle = toCssColor({ ...fill, a: 1 });
  ctx.fill(path, 'nonzero');
  // Without an outline, pieces that meet edge to edge would leave a faint anti-aliased seam between
  // them. A pixel-wide stroke in the fill's own color closes it.
  if (outlined === false) {
    const { a, b } = ctx.getTransform();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1 / (Math.hypot(a, b) || 1);
    ctx.lineJoin = 'bevel';
    ctx.stroke(path);
  }
}

// Marked edges go over the fill at the border's width, the same weight as the visible outline.
function drawMarks(ctx: CanvasRenderingContext2D, { marks, border }: MeshItem) {
  const borderWidth = border?.width ?? 0;
  if (marks?.length && border && borderWidth > 0) {
    const marked = new Path2D();
    for (const run of marks) {
      run.forEach(({ x, y }, i) => (i === 0 ? marked.moveTo(x, y) : marked.lineTo(x, y)));
    }
    ctx.strokeStyle = toCssColor(border.color);
    ctx.lineWidth = borderWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(marked);
    ctx.lineCap = 'butt';
  }
}

export function ellipsoidOutline({ arcs }: Pick<EllipsoidItem, 'arcs'>): Path2D {
  const path = new Path2D();
  for (const { x, y, radiusX, radiusY, angle, start, end } of arcs) {
    path.ellipse(x, y, radiusX, radiusY, angle, start, end);
  }
  path.closePath();
  return path;
}

// As a mesh draws: the border stroked at twice its width, then the opaque fill over its inner half,
// or, unfilled, the inside cut away.
function drawEllipsoid(ctx: CanvasRenderingContext2D, item: EllipsoidItem) {
  const path = ellipsoidOutline(item);
  if (item.filled === false) {
    const pad = 2 * ((item.border?.width ?? 0) + (item.highlight ? HIGHLIGHT_WIDTH : 0)) + 1;
    const extents = item.arcs.flatMap(({ x, y, radiusX, radiusY }) => {
      const r = Math.max(radiusX, radiusY);
      return [{ x: x - r, y: y - r }, { x: x + r, y: y + r }];
    });
    drawUnfilled(ctx, boundsOf(extents, pad), path, target => strokeEllipsoid(target, item, path));
    return;
  }
  strokeEllipsoid(ctx, item, path);
  ctx.fillStyle = toCssColor({ ...item.fill, a: 1 });
  ctx.fill(path);
}

function strokeEllipsoid(ctx: CanvasRenderingContext2D, item: EllipsoidItem, path: Path2D) {
  const borderWidth = item.border?.width ?? 0;
  ctx.lineJoin = 'round';
  if (item.highlight) {
    ctx.strokeStyle = toCssColor({ ...item.highlight, a: 1 });
    ctx.lineWidth = (borderWidth + HIGHLIGHT_WIDTH) * 2;
    ctx.stroke(path);
  }
  if (item.border && borderWidth > 0) {
    ctx.strokeStyle = toCssColor(item.border.color);
    ctx.lineWidth = borderWidth * 2;
    ctx.stroke(path);
  }
}

// Draws projected items in order onto a context already set to image space.
// Opaque closed shapes with no stroke, one after another in the same colour, look the same filled
// as one path, so they go to the canvas in one call. Each outline is wound the same way first, so
// overlaps add up under the nonzero rule instead of cancelling into holes.
function batchable(item: ShapeItem): boolean {
  return item.fill !== null && item.fill.a === 1 && !(item.stroke && item.stroke.width > 0) && item.runs.every(run => run.closed);
}

function addWound(path: Path2D, points: ShapeItem['runs'][number]['points']) {
  let area = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  });
  const ordered = area < 0 ? [...points].reverse() : points;
  ordered.forEach(({ x, y }, i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
}

export function drawItems(ctx: CanvasRenderingContext2D, items: ReturnType<typeof projectScene>) {
  let batch: Path2D | null = null;
  let batchFill = '';
  const flush = () => {
    if (batch) {
      ctx.fillStyle = batchFill;
      ctx.fill(batch);
      batch = null;
    }
  };
  for (const item of items) {
    if (item.kind === 'shape' && batchable(item)) {
      const fill = toCssColor(item.fill!);
      if (batch && fill !== batchFill) {
        flush();
      }
      batch ??= new Path2D();
      batchFill = fill;
      item.runs.forEach(run => addWound(batch!, run.points));
      continue;
    }
    flush();
    if (item.kind === 'shape') {
      drawShape(ctx, item);
    } else if (item.kind === 'ellipsoid') {
      drawEllipsoid(ctx, item);
    } else {
      drawMesh(ctx, item);
    }
  }
  flush();
}

// Redraws the whole frame from vectors, at the canvas's device resolution.
export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, view: View, pixelRatio: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = toCssColor(scene.background);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const scale = pixelRatio * view.zoom;
  ctx.setTransform(scale, 0, 0, scale, pixelRatio * view.panX, pixelRatio * view.panY);
  drawItems(ctx, projectScene(scene, FLATTENING_TOLERANCE / scale));
}
