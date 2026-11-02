// A scene at a single instant. Everything here is plain data with no animation in it;
// animation.ts derives the animatable form of these types mechanically.
//
// World axes: x right, y forward, z up, as in Blender.

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

// Channels in 0..1.
export type Rgb = { r: number; g: number; b: number };
export type Color = Rgb & { a: number };

// Data that never animates, even when it contains numbers.
export type Fixed<T> = { kind: 'fixed'; value: T };

export function fixed<T>(value: T): Fixed<T> {
  return { kind: 'fixed', value };
}

// Handles are relative to the point, so moving a point carries its handles along.
export type Anchor = { point: Vec2; in: Vec2; out: Vec2 };

// Flat geometry lies in its node's local z = 0 plane.
export type PathGeometry = { kind: 'path'; anchors: Anchor[]; closed: boolean };
export type RectGeometry = { kind: 'rect'; width: number; height: number; cornerRadius: number };
export type EllipseGeometry = { kind: 'ellipse'; radiusX: number; radiusY: number };
export type Geometry = PathGeometry | RectGeometry | EllipseGeometry;

// Width is in world units, so it shrinks with distance from the camera.
export type Stroke = { color: Color; width: number };
export type Style = { fill: Color | null; stroke: Stroke | null };

// Euler angles in radians, applied about x, then y, then z, and not wrapped, so a track from 0 to
// 4 * PI spins twice. With w present it is instead a quaternion, normalized when used.
export type Rotation = Vec3 & { w?: number };

// Applied in the order scale, rotate, translate.
export type Transform = { position: Vec3; rotation: Rotation; scale: Vec3 };

// Three indices into a mesh's vertices. Winding does not matter.
export type Face = [number, number, number];

// Two indices into a mesh's vertices. Only lines that stand alone are listed; the sides of faces
// are implied by the faces.
export type Edge = [number, number];

// Draws as one silhouette: an opaque fill over the mesh's visible area, with a border outside it.
// Standalone edges draw as lines in the border's color, twice its width across.
export type MeshNode = {
  kind: 'mesh';
  name: string;
  transform: Transform;
  vertices: Vec3[];
  faces: Fixed<Face[]>;
  edges: Fixed<Edge[]>;
  // Replaces the transform when given, for placement computed from outside the node tree, such as
  // by parents and constraints. Twelve numbers, as in matrix.ts.
  worldMatrix?: Fixed<number[]>;
  // A selection outline, drawn around the outside of the silhouette, border included.
  highlight?: Fixed<Rgb>;
  fill: Rgb;
  border: Stroke | null;
};

export type ShapeNode = { kind: 'shape'; name: string; transform: Transform; geometry: Geometry; style: Style };
export type GroupNode = { kind: 'group'; name: string; transform: Transform; children: SceneNode[] };
export type SceneNode = ShapeNode | MeshNode | GroupNode;

// Looks along its local +y, with its local +z up, so zero rotation is level and facing forward. A
// point at distance focalLength in front of the camera draws at scale 1, in CSS pixels before the
// viewer's zoom.
export type Camera = { position: Vec3; rotation: Vec3; focalLength: number };

export type Scene = { background: Color; camera: Camera; nodes: SceneNode[] };
