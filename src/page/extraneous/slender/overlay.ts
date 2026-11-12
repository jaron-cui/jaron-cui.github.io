import { weightColor } from './armature';
import { Axis, midpoint, Occlusion, SelectMode, Selection, wireframeEdges } from './editing';
import { applyMatrix, viewMatrix } from '../../../lib/vrender/matrix';
import { Camera, Edge, Face, Vec2, Vec3 } from '../../../lib/vrender/model';
import { projectPoint, projectSegment } from '../../../lib/vrender/project';
import { GRID_SPACING } from './snapping';

const GRID_HALF_LINES = 6;
const AXIS_GUIDE_REACH = 5000;
const CROSSHAIR_REACH = 8;
const CURSOR_RADIUS = 9;
const CURSOR_TICK = 14;
const EDIT_UNSELECTED = '#000000';
const EDIT_SELECTED = '#ffa030';
const EDIT_FACE_FILL = 'rgba(255, 160, 48, 0.5)';
const BONE_RING_POSITION = 0.1;
const BONE_RING_RADIUS = 0.08;
// Few-faced meshes get smooth gradients. Many-faced ones are fine enough with one color per face.
const SMOOTH_WEIGHTS_MAX_FACES = 400;
const WEIGHT_SUBDIVISIONS = 4;
const BONE_COLORS: Record<BoneState, { line: string; fill: string }> = {
  plain: { line: 'rgba(210, 214, 225, 0.9)', fill: 'rgba(120, 125, 140, 0.45)' },
  object: { line: '#ff8c28', fill: 'rgba(255, 140, 40, 0.25)' },
  selected: { line: '#5ad0ff', fill: 'rgba(60, 170, 230, 0.4)' },
  active: { line: '#c8f0ff', fill: 'rgba(90, 200, 255, 0.6)' },
};
const AXIS_COLORS: Record<Axis, string> = { x: '#ff5a5a', y: '#6fdc6f', z: '#5a9bff' };

// A line through a point, along a unit direction, in the color of the axis it stands for.
export type AxisGuide = { center: Vec3; direction: Vec3; axis: Axis };

type BoneState = 'plain' | 'object' | 'selected' | 'active';

// One bone, in world space. Joints are marked only while the armature is in edit mode.
export type BoneDraw = { head: Vec3; tail: Vec3; state: BoneState; joints: { head: boolean; tail: boolean } | null };

export type OverlayContent = {
  camera: Camera;
  sceneCursor: Vec3;
  // Off hides the grid, wires, and marks, leaving only what an action in progress needs.
  showOverlays: boolean;
  // With X-Ray off, what the camera cannot see in edit mode is left out.
  occluded?: Occlusion;
  // The active object in edit mode, in world space.
  editing: { vertices: Vec3[]; faces: Face[]; edges: Edge[]; selection: Selection; selectMode: SelectMode } | null;
  // The selected objects in object mode, in world space.
  selected: { vertices: Vec3[]; faces: Face[]; edges: Edge[]; origin: Vec3; active: boolean }[];
  // Camera objects, which have no rendered form of their own, in world space.
  cameras: { vertices: Vec3[]; faces: Face[]; edges: Edge[] }[];
  box: [Vec2, Vec2] | null;
  guide: AxisGuide | null;
  // The reach of proportional editing during a transformation, in image space.
  influence: { center: Vec2; radius: number } | null;
  // Marks the center of the view while walking, which is what Space zooms toward.
  crosshair: boolean;
  // Drawn over surfaces, since a rig is mostly inside what it moves.
  bones: BoneDraw[];
  // The mesh being weight painted, in world space, colored by each vertex's weight.
  weightPaint: { vertices: Vec3[]; faces: Face[]; weights: number[] } | null;
  brush: { center: Vec2; radius: number } | null;
};

function linePath(ctx: CanvasRenderingContext2D, camera: Camera, a: Vec3, b: Vec3) {
  const segment = projectSegment(camera, a, b);
  if (segment) {
    ctx.moveTo(segment[0].x, segment[0].y);
    ctx.lineTo(segment[1].x, segment[1].y);
  }
}

function strokeWire(ctx: CanvasRenderingContext2D, camera: Camera, vertices: Vec3[], faces: Face[], edges: Edge[], occluded?: Occlusion) {
  ctx.beginPath();
  wireframeEdges({ vertices, faces, edges }).forEach(([a, b]) => {
    if (!occluded?.(midpoint(vertices[a], vertices[b]))) {
      linePath(ctx, camera, vertices[a], vertices[b]);
    }
  });
  ctx.stroke();
}

// Draws editing aids over the rendered scene, in the image-space transform renderScene leaves set.
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  { camera, sceneCursor, showOverlays, occluded, editing, selected, cameras, box, guide, influence, crosshair, bones, weightPaint, brush }: OverlayContent
) {
  ctx.lineWidth = 1;
  if (weightPaint) {
    drawWeights(ctx, camera, weightPaint);
  }
  if (showOverlays) {
    drawGuides(ctx, { camera, occluded, editing, selected, cameras });
    bones.forEach(bone => drawBone(ctx, camera, bone));
    drawSceneCursor(ctx, camera, sceneCursor);
  }

  if (brush) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(brush.center.x, brush.center.y, brush.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (guide) {
    const { center, direction, axis } = guide;
    const end = (sign: number): Vec3 => ({
      x: center.x + direction.x * sign * AXIS_GUIDE_REACH,
      y: center.y + direction.y * sign * AXIS_GUIDE_REACH,
      z: center.z + direction.z * sign * AXIS_GUIDE_REACH,
    });
    ctx.strokeStyle = AXIS_COLORS[axis];
    ctx.beginPath();
    linePath(ctx, camera, end(-1), end(1));
    ctx.stroke();
  }

  if (influence) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(influence.center.x, influence.center.y, influence.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (crosshair) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.moveTo(-CROSSHAIR_REACH, 0);
    ctx.lineTo(CROSSHAIR_REACH, 0);
    ctx.moveTo(0, -CROSSHAIR_REACH);
    ctx.lineTo(0, CROSSHAIR_REACH);
    ctx.stroke();
  }

  if (box) {
    const [a, b] = box;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.setLineDash([5, 4]);
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
  }
}

// A ring of red and white dashes with ticks reaching out, always over everything.
function drawSceneCursor(ctx: CanvasRenderingContext2D, camera: Camera, cursor: Vec3) {
  const p = projectPoint(camera, cursor);
  if (!p) {
    return;
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(p.x, p.y, CURSOR_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#e03030';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, CURSOR_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#202020';
  ctx.beginPath();
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(p.x + x * (CURSOR_RADIUS - 3), p.y + y * (CURSOR_RADIUS - 3));
    ctx.lineTo(p.x + x * CURSOR_TICK, p.y + y * CURSOR_TICK);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}

// A bone's usual shape: a long diamond, thickest near its head.
function drawBone(ctx: CanvasRenderingContext2D, camera: Camera, { head, tail, state, joints }: BoneDraw) {
  const along = { x: tail.x - head.x, y: tail.y - head.y, z: tail.z - head.z };
  const length = Math.hypot(along.x, along.y, along.z);
  const colors = BONE_COLORS[state];
  if (length > 1e-6) {
    const y = { x: along.x / length, y: along.y / length, z: along.z / length };
    const reference = Math.abs(y.z) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const raw = { x: y.y * reference.z - y.z * reference.y, y: y.z * reference.x - y.x * reference.z, z: y.x * reference.y - y.y * reference.x };
    const rawLength = Math.hypot(raw.x, raw.y, raw.z);
    const u = { x: raw.x / rawLength, y: raw.y / rawLength, z: raw.z / rawLength };
    const v = { x: y.y * u.z - y.z * u.y, y: y.z * u.x - y.x * u.z, z: y.x * u.y - y.y * u.x };
    const ring = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([a, b]): Vec3 => {
      const r = length * BONE_RING_RADIUS;
      return {
        x: head.x + along.x * BONE_RING_POSITION + (u.x * a + v.x * b) * r,
        y: head.y + along.y * BONE_RING_POSITION + (u.y * a + v.y * b) * r,
        z: head.z + along.z * BONE_RING_POSITION + (u.z * a + v.z * b) * r,
      };
    });
    const [ph, pt] = [projectPoint(camera, head), projectPoint(camera, tail)];
    const ringPoints = ring.map(point => projectPoint(camera, point));
    ctx.fillStyle = colors.fill;
    ringPoints.forEach((point, i) => {
      const next = ringPoints[(i + 1) % ringPoints.length];
      for (const end of [ph, pt]) {
        if (point && next && end) {
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(point.x, point.y);
          ctx.lineTo(next.x, next.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    });
    ctx.strokeStyle = colors.line;
    ctx.beginPath();
    ring.forEach((point, i) => {
      linePath(ctx, camera, point, ring[(i + 1) % ring.length]);
      linePath(ctx, camera, head, point);
      linePath(ctx, camera, point, tail);
    });
    ctx.stroke();
  }
  if (joints) {
    for (const [point, isSelected] of [[head, joints.head], [tail, joints.tail]] as const) {
      const p = projectPoint(camera, point);
      if (p) {
        ctx.fillStyle = isSelected ? '#ffa030' : '#101010';
        ctx.strokeStyle = isSelected ? '#ffffff' : '#c8c8c8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, isSelected ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

// Paints faces back to front, since this is drawn over the scene with no depth to test against.
function drawWeights(ctx: CanvasRenderingContext2D, camera: Camera, { vertices, faces, weights }: NonNullable<OverlayContent['weightPaint']>) {
  const view = viewMatrix(camera);
  const depths = vertices.map(({ x, y, z }) => applyMatrix(view, x, y, z).z);
  const points = vertices.map(vertex => projectPoint(camera, vertex));
  const order = faces
    .filter(face => face.every(i => points[i]))
    .map(face => ({ face, depth: (depths[face[0]] + depths[face[1]] + depths[face[2]]) / 3 }))
    .sort((a, b) => b.depth - a.depth);
  const steps = faces.length > SMOOTH_WEIGHTS_MAX_FACES ? 1 : WEIGHT_SUBDIVISIONS;
  ctx.lineWidth = 0.75;
  for (const { face: [a, b, c] } of order) {
    const [pa, pb, pc] = [points[a]!, points[b]!, points[c]!];
    const at = (i: number, j: number) => {
      const [u, v, w] = [i / steps, j / steps, (steps - i - j) / steps];
      return { x: pa.x * u + pb.x * v + pc.x * w, y: pa.y * u + pb.y * v + pc.y * w, weight: weights[a] * u + weights[b] * v + weights[c] * w };
    };
    const small = (p: ReturnType<typeof at>, q: ReturnType<typeof at>, r: ReturnType<typeof at>) => {
      const [red, green, blue] = weightColor((p.weight + q.weight + r.weight) / 3);
      const color = `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(r.x, r.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps - i; j++) {
        small(at(i, j), at(i + 1, j), at(i, j + 1));
        if (i + j < steps - 1) {
          small(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
        }
      }
    }
  }
  ctx.lineWidth = 1;
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  { camera, occluded, editing, selected, cameras }: Pick<OverlayContent, 'camera' | 'occluded' | 'editing' | 'selected' | 'cameras'>
) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  const extent = GRID_HALF_LINES * GRID_SPACING;
  for (let i = -GRID_HALF_LINES; i <= GRID_HALF_LINES; i++) {
    linePath(ctx, camera, { x: i * GRID_SPACING, y: -extent, z: 0 }, { x: i * GRID_SPACING, y: extent, z: 0 });
    linePath(ctx, camera, { x: -extent, y: i * GRID_SPACING, z: 0 }, { x: extent, y: i * GRID_SPACING, z: 0 });
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  for (const { vertices, faces, edges } of cameras) {
    strokeWire(ctx, camera, vertices, faces, edges);
  }

  for (const { vertices, faces, edges, origin, active } of selected) {
    ctx.strokeStyle = active ? 'rgba(255, 192, 106, 0.8)' : 'rgba(255, 140, 40, 0.65)';
    strokeWire(ctx, camera, vertices, faces, edges);
    const point = projectPoint(camera, origin);
    if (point) {
      ctx.fillStyle = active ? '#ffc06a' : '#ff8c28';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Selected faces shade under the wire. Everything not selected is black, and only what the select
  // mode chooses between lights up.
  if (editing?.selectMode === 'face') {
    ctx.fillStyle = EDIT_FACE_FILL;
    for (const face of editing.faces) {
      const points = face.map(i => projectPoint(camera, editing.vertices[i]));
      const [a, b, c] = face.map(i => editing.vertices[i]);
      const center = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
      if (face.every(i => editing.selection.has(i)) && points.every(point => point) && !occluded?.(center)) {
        ctx.beginPath();
        points.forEach((point, i) => (i === 0 ? ctx.moveTo(point!.x, point!.y) : ctx.lineTo(point!.x, point!.y)));
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  if (editing) {
    ctx.strokeStyle = EDIT_UNSELECTED;
    strokeWire(ctx, camera, editing.vertices, editing.faces, editing.edges, occluded);
  }

  if (editing?.selectMode === 'line') {
    ctx.strokeStyle = EDIT_SELECTED;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    wireframeEdges(editing).forEach(([a, b]) => {
      if (editing.selection.has(a) && editing.selection.has(b) && !occluded?.(midpoint(editing.vertices[a], editing.vertices[b]))) {
        linePath(ctx, camera, editing.vertices[a], editing.vertices[b]);
      }
    });
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  if (editing?.selectMode === 'vertex') {
    editing.vertices.forEach((vertex, i) => {
      const point = projectPoint(camera, vertex);
      if (point && !occluded?.(vertex)) {
        const isSelected = editing.selection.has(i);
        const size = isSelected ? 6 : 5;
        ctx.fillStyle = isSelected ? EDIT_SELECTED : EDIT_UNSELECTED;
        ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
      }
    });
  }
}
