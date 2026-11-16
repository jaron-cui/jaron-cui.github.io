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

// Strokes every triangle edge at twice the border's width, then paints the fill over everything
// inside the silhouette. Only the outer half of the silhouette's stroke remains visible.
function drawMesh(ctx: CanvasRenderingContext2D, { polygons, lines, marks, outline: outlined, fill, border, highlight }: MeshItem) {
  const path = new Path2D();
  for (const polygon of polygons) {
    polygon.forEach(({ x, y }, i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
  }
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
  // Marked edges go over the fill at the border's width, the same weight as the visible outline.
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

// As a mesh draws: the border stroked at twice its width, then the opaque fill over its inner half.
function drawEllipsoid(ctx: CanvasRenderingContext2D, item: EllipsoidItem) {
  const path = ellipsoidOutline(item);
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
  ctx.fillStyle = toCssColor({ ...item.fill, a: 1 });
  ctx.fill(path);
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
