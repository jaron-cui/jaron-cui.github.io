import { addEllipsoid, emptyDocument, findObject, objectsInBox, occlusionTest, pickObject, toScene } from './document';
import { parseProject, serializeProject } from './projectFile';
import { applyMatrix, multiply, transformMatrix, viewMatrix } from '../../../lib/vrender/matrix';
import { Camera, EllipsoidNode, Vec2, Vec3 } from '../../../lib/vrender/model';
import { EllipseArc, EllipsoidItem, projectScene } from '../../../lib/vrender/project';

const camera: Camera = { position: { x: 0, y: -600, z: 150 }, rotation: { x: -0.25, y: 0, z: 0 }, focalLength: 800 };

function node(radii: Vec3, length: number, position: Vec3, rotation: Vec3): EllipsoidNode {
  return {
    kind: 'ellipsoid', name: 'e', radii, length,
    transform: { position, rotation, scale: { x: 1, y: 1, z: 1 } },
    fill: { r: 1, g: 0, b: 0 }, border: null,
  };
}

function project(n: EllipsoidNode): EllipsoidItem {
  const [item] = projectScene({ background: { r: 0, g: 0, b: 0, a: 1 }, camera, nodes: [n] }, 0.25);
  expect(item?.kind).toBe('ellipsoid');
  return item as EllipsoidItem;
}

// Surface points of the swept ellipsoid, projected the way project.ts projects points.
function surfaceImage(n: EllipsoidNode): Vec2[] {
  const matrix = multiply(viewMatrix(camera), transformMatrix(n.transform));
  const points: Vec2[] = [];
  for (let i = 0; i <= 60; i++) {
    const polar = (i / 60) * Math.PI;
    for (let j = 0; j < 120; j++) {
      const azimuth = (j / 120) * 2 * Math.PI;
      const local = {
        x: n.radii.x * Math.sin(polar) * Math.cos(azimuth),
        y: n.radii.y * Math.sin(polar) * Math.sin(azimuth),
        z: n.radii.z * Math.cos(polar),
      };
      for (const offset of n.length ? [-n.length, 0, n.length] : [0]) {
        const p = applyMatrix(matrix, local.x, local.y, local.z + offset);
        points.push({ x: camera.focalLength * p.x / p.z, y: camera.focalLength * p.y / p.z });
      }
    }
  }
  return points;
}

// The outline as a dense polygon: each arc sampled, then joined in order, as canvas draws it.
function outlinePolygon(arcs: EllipseArc[]): Vec2[] {
  return arcs.flatMap(({ x, y, radiusX, radiusY, angle, start, end }) => {
    let span = (((end - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    span = span <= 1e-9 ? 2 * Math.PI : span;
    return Array.from({ length: 181 }, (_, i) => {
      const t = start + (span * i) / 180;
      const [u, v] = [radiusX * Math.cos(t), radiusY * Math.sin(t)];
      return { x: x + u * Math.cos(angle) - v * Math.sin(angle), y: y + u * Math.sin(angle) + v * Math.cos(angle) };
    });
  });
}

// Signed distance outside a convex polygon (negative inside), whichever way it winds.
function outside(polygon: Vec2[], p: Vec2): number {
  let area = 0;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.y - b.x * a.y;
  });
  const sign = area > 0 ? 1 : -1;
  let worst = -Infinity;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 1e-9) {
      worst = Math.max(worst, -sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length);
    }
  });
  return worst;
}

function expectTightOutline(n: EllipsoidNode) {
  const polygon = outlinePolygon(project(n).arcs);
  const points = surfaceImage(n);
  // Every surface point is inside (to within the sampling of both), and the outline touches the
  // surface all the way around: no outline sample is far from some surface point.
  expect(Math.max(...points.map(p => outside(polygon, p)))).toBeLessThan(0.05);
  const gaps = polygon.filter((_, i) => i % 10 === 0).map(q => Math.min(...points.map(p => Math.hypot(p.x - q.x, p.y - q.y))));
  // The surface samples are a fixed grid, so they spread apart on shapes drawn large.
  const extent = Math.max(...polygon.map(p => p.x)) - Math.min(...polygon.map(p => p.x));
  expect(Math.max(...gaps)).toBeLessThan(Math.max(2, 0.015 * extent));
}

describe('ellipsoid projection', () => {
  it('outlines a sphere at the centre exactly', () => {
    expectTightOutline(node({ x: 40, y: 40, z: 40 }, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
  });

  it('outlines a turned ellipsoid off to the side, under perspective', () => {
    expectTightOutline(node({ x: 60, y: 25, z: 35 }, 0, { x: 180, y: 80, z: 60 }, { x: 0.4, y: -0.7, z: 1.1 }));
  });

  it('outlines a capsule with two arcs and its tangents', () => {
    const capsule = node({ x: 20, y: 20, z: 20 }, 70, { x: -90, y: 30, z: 20 }, { x: 1.2, y: 0.3, z: 0.5 });
    expect(project(capsule).arcs).toHaveLength(2);
    expectTightOutline(capsule);
  });

  it('outlines a swept ellipsoid', () => {
    expectTightOutline(node({ x: 30, y: 15, z: 22 }, 50, { x: 60, y: -100, z: -20 }, { x: -0.3, y: 0.9, z: 2.0 }));
  });

  it('draws a capsule seen end on as one ellipse', () => {
    // Its axis points straight at the camera, so the near end hides the far one.
    const toCamera = { x: 0, y: -600, z: 150 };
    const capsule = node({ x: 20, y: 20, z: 20 }, 40, { x: 0, y: 0, z: 0 }, { x: Math.atan2(-toCamera.y, toCamera.z), y: 0, z: 0 });
    expect(project(capsule).arcs).toHaveLength(1);
  });

  it('skips one that reaches past the near plane', () => {
    const items = projectScene({
      background: { r: 0, g: 0, b: 0, a: 1 }, camera,
      nodes: [node({ x: 40, y: 40, z: 40 }, 0, { x: 0, y: -600, z: 150 }, { x: 0, y: 0, z: 0 })],
    }, 0.25);
    expect(items).toHaveLength(0);
  });
});

describe('ellipsoid objects', () => {
  const view: Camera = { position: { x: 0, y: -800, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, focalLength: 800 };

  it('render as ellipsoids, pick and box select through their stand-in, and save', () => {
    const document = addEllipsoid(emptyDocument(), { radii: { x: 50, y: 30, z: 30 }, length: 40 }, { x: 10, y: 0, z: 0 });
    const id = document.activeObject!;
    const [node] = toScene(document, view, 0, null).nodes;
    expect(node.kind).toBe('ellipsoid');
    expect(pickObject(document, view, 0, { x: 10, y: 0 }, 4)).toBe(id);
    expect(pickObject(document, view, 0, { x: 200, y: 0 }, 4)).toBeNull();
    expect(objectsInBox(document, view, 0, { x: -100, y: -100 }, { x: 100, y: 100 })).toEqual([id]);
    const loaded = parseProject(serializeProject({
      document,
      view: { orbit: { target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 400, focalLength: 800 }, viewedCamera: null, time: 0, duration: 4 },
      layout: { outlinerWidth: 250, timelineHeight: 90, objectPaneHeight: 300, transformPanelOpen: false, propertiesTab: 'object' },
      settings: { selectMode: 'vertex', showOverlays: true, xRay: false, proportional: false, proportionalRadius: 100, proportionalConnected: false, brush: { weight: 1, radius: 30, strength: 1 } },
    })).document;
    expect(findObject(loaded, id)!.ellipsoid).toEqual({ radii: { x: 50, y: 30, z: 30 }, length: 40 });
  });

  it('hide what is behind them', () => {
    const document = addEllipsoid(emptyDocument(), { radii: { x: 50, y: 50, z: 50 }, length: 0 });
    const hidden = occlusionTest(document, 0, view);
    expect(hidden({ x: 0, y: 100, z: 0 })).toBe(true);
    expect(hidden({ x: 0, y: -100, z: 0 })).toBe(false);
  });
});

describe('swept ellipsoid outlines', () => {
  it('are tight for random shapes, places, and turns', () => {
    let seed = 11;
    const next = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let trial = 0; trial < 40; trial++) {
      const capsule = trial % 2 === 0;
      const r = 8 + 40 * next();
      const radii = capsule ? { x: r, y: r, z: r } : { x: 8 + 40 * next(), y: 8 + 40 * next(), z: 8 + 40 * next() };
      const n = node(radii, 5 + 90 * next(), { x: 400 * (next() - 0.5), y: 300 * (next() - 0.5), z: 200 * (next() - 0.5) }, { x: 7 * next(), y: 7 * next(), z: 7 * next() });
      expectTightOutline(n);
    }
  }, 60000);
});
