import { Color, Scene } from './model';
import { MeshItem, projectScene, ShapeItem } from './project';

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
function drawMesh(ctx: CanvasRenderingContext2D, { polygons, lines, fill, border, highlight }: MeshItem) {
  const path = new Path2D();
  for (const polygon of polygons) {
    polygon.forEach(({ x, y }, i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
  }
  const borderWidth = border?.width ?? 0;
  if (borderWidth > 0 || highlight) {
    const outline = new Path2D(path);
    for (const [from, to] of lines) {
      outline.moveTo(from.x, from.y);
      outline.lineTo(to.x, to.y);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Everything but its outermost ring gets painted over, which leaves only the perimeter lit.
    if (highlight) {
      ctx.strokeStyle = toCssColor({ ...highlight, a: 1 });
      ctx.lineWidth = (borderWidth + HIGHLIGHT_WIDTH) * 2;
      ctx.stroke(outline);
    }
    if (border && borderWidth > 0) {
      ctx.strokeStyle = toCssColor(border.color);
      ctx.lineWidth = borderWidth * 2;
      ctx.stroke(outline);
    }
    ctx.lineCap = 'butt';
  }
  ctx.fillStyle = toCssColor({ ...fill, a: 1 });
  ctx.fill(path, 'nonzero');
}

// Redraws the whole frame from vectors, at the canvas's device resolution.
export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, view: View, pixelRatio: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = toCssColor(scene.background);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const scale = pixelRatio * view.zoom;
  ctx.setTransform(scale, 0, 0, scale, pixelRatio * view.panX, pixelRatio * view.panY);
  for (const item of projectScene(scene, FLATTENING_TOLERANCE / scale)) {
    if (item.kind === 'shape') {
      drawShape(ctx, item);
    } else {
      drawMesh(ctx, item);
    }
  }
}
