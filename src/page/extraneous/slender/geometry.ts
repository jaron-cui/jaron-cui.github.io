import { Anchor, EllipseGeometry, Geometry, PathGeometry, RectGeometry } from './model';

// Handle length, as a fraction of the radius, that best fits a quarter circle with one cubic.
const KAPPA = 0.5522847498;

function anchor(x: number, y: number, inX = 0, inY = 0, outX = 0, outY = 0): Anchor {
  return { point: { x, y }, in: { x: inX, y: inY }, out: { x: outX, y: outY } };
}

// Centered on the origin, clockwise on screen, starting from the top.
function ellipseToPath({ radiusX: rx, radiusY: ry }: EllipseGeometry): PathGeometry {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    kind: 'path',
    closed: true,
    anchors: [
      anchor(0, -ry, -kx, 0, kx, 0),
      anchor(rx, 0, 0, -ky, 0, ky),
      anchor(0, ry, kx, 0, -kx, 0),
      anchor(-rx, 0, 0, ky, 0, -ky),
    ],
  };
}

// Centered on the origin, clockwise on screen. Always eight anchors, even with square corners,
// so the anchor count does not depend on an animated value.
function rectToPath({ width, height, cornerRadius }: RectGeometry): PathGeometry {
  const hw = Math.abs(width) / 2;
  const hh = Math.abs(height) / 2;
  const r = Math.max(0, Math.min(cornerRadius, hw, hh));
  const k = r * KAPPA;
  return {
    kind: 'path',
    closed: true,
    anchors: [
      anchor(-hw + r, -hh, -k, 0, 0, 0),
      anchor(hw - r, -hh, 0, 0, k, 0),
      anchor(hw, -hh + r, 0, -k, 0, 0),
      anchor(hw, hh - r, 0, 0, 0, k),
      anchor(hw - r, hh, k, 0, 0, 0),
      anchor(-hw + r, hh, 0, 0, -k, 0),
      anchor(-hw, hh - r, 0, k, 0, 0),
      anchor(-hw, -hh + r, 0, 0, 0, -k),
    ],
  };
}

// Reduces every primitive to the one form renderers need to understand.
export function toPath(geometry: Geometry): PathGeometry {
  switch (geometry.kind) {
    case 'path': return geometry;
    case 'rect': return rectToPath(geometry);
    case 'ellipse': return ellipseToPath(geometry);
  }
}
