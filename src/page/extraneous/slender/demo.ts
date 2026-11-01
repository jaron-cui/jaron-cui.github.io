import { Animated, AnimatedScene, CubicEase, Track, track } from './animation';
import { Anchor, Color, fixed, MeshNode, Rgb, Transform } from './model';
import { cubeMesh, MeshData, torusMesh } from './primitives';

const EASE_IN_OUT: CubicEase = [0.42, 0, 0.58, 1];
const FULL_TURN = Math.PI * 2;

export const DEMO_DURATION = 8;

// A value that eases from a to b and back over the demo's duration, so the demo loops cleanly.
function pingPong(a: number, b: number): Track {
  return track(
    { time: 0, value: a, ease: EASE_IN_OUT },
    { time: DEMO_DURATION / 2, value: b, ease: EASE_IN_OUT },
    { time: DEMO_DURATION, value: a }
  );
}

// A value that turns steadily through whole rotations, so the demo loops cleanly.
function spin(turns: number): Track {
  return track({ time: 0, value: 0 }, { time: DEMO_DURATION, value: turns * FULL_TURN });
}

function rgb(r: number, g: number, b: number): Rgb {
  return { r, g, b };
}

function color(r: number, g: number, b: number): Color {
  return { r, g, b, a: 1 };
}

function placed(x: number, y: number, z = 0): Animated<Transform> {
  return { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
}

// Eases one anchor between a sharp corner and a smooth point on a circle.
function morphingAnchor(x: number, y: number, tangentX: number, tangentY: number): Animated<Anchor> {
  return {
    point: { x: pingPong(x, x * 0.7), y: pingPong(y, y * 0.7) },
    in: { x: pingPong(0, -tangentX), y: pingPong(0, -tangentY) },
    out: { x: pingPong(0, tangentX), y: pingPong(0, tangentY) },
  };
}

function meshParts({ vertices, faces, edges }: MeshData): Pick<MeshNode, 'vertices' | 'faces' | 'edges'> {
  return { vertices, faces: fixed(faces), edges: fixed(edges) };
}

export const demoScene: AnimatedScene = {
  background: color(0.09, 0.1, 0.13),
  camera: {
    position: { x: pingPong(-120, 120), y: pingPong(-50, 50), z: -800 },
    // This scene is laid out in its x-y plane with +y toward the bottom of the screen, seen from
    // -z. Turning the camera a quarter turn about x gives exactly that view.
    rotation: { x: Math.PI / 2, y: 0, z: 0 },
    focalLength: 800,
  },
  nodes: [
    {
      kind: 'shape',
      name: 'Morphing path',
      transform: {
        position: { x: -340, y: -40, z: 0 },
        rotation: { x: 0, y: spin(1), z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: {
        kind: 'path',
        closed: true,
        anchors: [
          morphingAnchor(-90, -90, 35, -35),
          morphingAnchor(90, -90, 35, 35),
          morphingAnchor(90, 90, -35, 35),
          morphingAnchor(-90, 90, -35, -35),
        ],
      },
      style: {
        fill: { r: pingPong(0.95, 0.25), g: pingPong(0.45, 0.75), b: pingPong(0.3, 0.9), a: 1 },
        stroke: null,
      },
    },
    {
      kind: 'shape',
      name: 'Tumbling rect',
      transform: {
        position: { x: -60, y: -60, z: 0 },
        rotation: { x: spin(1), y: spin(2), z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { kind: 'rect', width: 170, height: 120, cornerRadius: pingPong(0, 55) },
      style: { fill: null, stroke: { color: color(0.95, 0.8, 0.35), width: 8 } },
    },
    {
      ...meshParts(cubeMesh(50)),
      kind: 'mesh',
      name: 'Cube',
      transform: {
        position: { x: -40, y: 140, z: 0 },
        rotation: { x: spin(1), y: spin(1), z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      fill: rgb(0.95, 0.45, 0.5),
      border: { color: color(1, 0.92, 0.9), width: 6 },
    },
    {
      kind: 'group',
      name: 'Torus system',
      transform: placed(270, 0),
      children: [
        {
          ...meshParts(torusMesh(95, 38, 32, 16)),
          kind: 'mesh',
          name: 'Torus',
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: spin(1), y: pingPong(-0.6, 0.6), z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          fill: rgb(0.27, 0.42, 0.85),
          border: { color: color(0.9, 0.93, 1), width: pingPong(4, 12) },
        },
        {
          kind: 'group',
          name: 'Orbit',
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: spin(1), z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          children: [
            {
              kind: 'shape',
              name: 'Flat moon',
              transform: placed(190, 0),
              geometry: { kind: 'ellipse', radiusX: 26, radiusY: 26 },
              style: { fill: color(0.4, 0.85, 0.65), stroke: { color: color(0.9, 1, 0.95), width: 4 } },
            },
          ],
        },
      ],
    },
  ],
};
