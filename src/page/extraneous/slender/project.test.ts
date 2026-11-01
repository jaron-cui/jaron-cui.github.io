import { Camera, Face, fixed, MeshNode, Scene, SceneNode, ShapeNode, Transform, Vec2, Vec3 } from './model';
import { MeshItem, projectPoint, projectScene, ShapeItem } from './project';

// Looks along +z with +y toward the bottom of the image, which keeps flat shapes easy to reason about.
const CAMERA: Camera = { position: { x: 0, y: 0, z: -100 }, rotation: { x: Math.PI / 2, y: 0, z: 0 }, focalLength: 100 };
const WHITE = { r: 1, g: 1, b: 1, a: 1 };

function placed(position: Partial<Vec3> = {}, rotation: Partial<Vec3> = {}): Transform {
  return {
    position: { x: 0, y: 0, z: 0, ...position },
    rotation: { x: 0, y: 0, z: 0, ...rotation },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function square(transform: Transform, strokeWidth = 0): ShapeNode {
  return {
    kind: 'shape',
    name: 'Square',
    transform,
    geometry: { kind: 'rect', width: 20, height: 20, cornerRadius: 0 },
    style: { fill: WHITE, stroke: strokeWidth > 0 ? { color: WHITE, width: strokeWidth } : null },
  };
}

function triangles(vertices: Vec3[], faces: Face[], transform = placed()): MeshNode {
  return { kind: 'mesh', name: 'Mesh', transform, vertices, faces: fixed(faces), edges: fixed([]), fill: { r: 1, g: 0, b: 0 }, border: null };
}

function sceneOf(nodes: SceneNode[], camera = CAMERA): Scene {
  return { background: WHITE, camera, nodes };
}

function bounds(points: Vec2[]) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function onlyShape(nodes: SceneNode[], camera = CAMERA): ShapeItem {
  const items = projectScene(sceneOf(nodes, camera), 0.01);
  expect(items).toHaveLength(1);
  return items[0] as ShapeItem;
}

function area(polygon: Vec2[]): number {
  return polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0) / 2;
}

describe('world axes', () => {
  it('has z up and y forward, so zero rotation looks along +y', () => {
    const level: Camera = { position: { x: 0, y: -100, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, focalLength: 100 };
    const seen = (x: number, y: number, z: number) => projectPoint(level, { x, y, z });
    expect(seen(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(seen(10, 0, 0)?.x).toBeCloseTo(10);
    expect(seen(0, 0, 10)?.y).toBeCloseTo(-10);
    expect(seen(10, 100, 0)?.x).toBeCloseTo(5);
    expect(seen(0, -300, 0)).toBeNull();
  });
});

describe('perspective', () => {
  it('draws at scale 1 at the focal distance and shrinks with distance', () => {
    const near = bounds(onlyShape([square(placed())]).runs[0].points);
    expect(near.maxX).toBeCloseTo(10);
    const far = bounds(onlyShape([square(placed({ z: 100 }))]).runs[0].points);
    expect(far.maxX).toBeCloseTo(5);
  });

  it('thins strokes with distance', () => {
    expect(onlyShape([square(placed(), 4)]).stroke?.width).toBeCloseTo(4);
    expect(onlyShape([square(placed({ z: 100 }), 4)]).stroke?.width).toBeCloseTo(2);
  });

  it('enlarges the near side of a turned shape and shrinks the far side', () => {
    // A positive turn about y swings local +x toward the camera.
    const { points } = onlyShape([square(placed({}, { y: Math.PI / 4 }))]).runs[0];
    const { minX, maxX } = bounds(points);
    const offset = 10 * Math.SQRT1_2;
    expect(maxX).toBeCloseTo(100 * offset / (100 - offset), 6);
    expect(minX).toBeCloseTo(-100 * offset / (100 + offset), 6);
  });

  it('collapses a flat shape turned exactly edge-on', () => {
    const { minX, maxX } = bounds(onlyShape([square(placed({}, { y: Math.PI / 2 }))]).runs[0].points);
    expect(maxX - minX).toBeCloseTo(0);
  });

  it('composes parent and child transforms', () => {
    const child = square(placed({ x: 10 }));
    const group: SceneNode = { kind: 'group', name: 'Group', transform: placed({ x: 5 }, { z: Math.PI / 2 }), children: [child] };
    const { minX, maxX, minY, maxY } = bounds(onlyShape([group]).runs[0].points);
    expect(minX).toBeCloseTo(-5);
    expect(maxX).toBeCloseTo(15);
    expect(minY).toBeCloseTo(0);
    expect(maxY).toBeCloseTo(20);
  });

  it('applies the inverse of a moved and rotated camera', () => {
    const moved = bounds(onlyShape([square(placed())], { ...CAMERA, position: { x: 10, y: 0, z: -100 } }).runs[0].points);
    expect(moved.minX).toBeCloseTo(-20);
    expect(moved.maxX).toBeCloseTo(0);

    // Standing at +x and turned to face -x sees the origin straight ahead.
    const side = { position: { x: 100, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: Math.PI / 2 }, focalLength: 100 };
    const seen = bounds(onlyShape([square(placed({}, { y: Math.PI / 2 }))], side).runs[0].points);
    expect(seen.minX).toBeCloseTo(-10);
    expect(seen.maxX).toBeCloseTo(10);
  });
});

describe('curve flattening', () => {
  const circle: ShapeNode = {
    kind: 'shape',
    name: 'Circle',
    transform: placed({ z: -50 }),
    geometry: { kind: 'ellipse', radiusX: 40, radiusY: 40 },
    style: { fill: WHITE, stroke: null },
  };

  it('stays within tolerance of a true circle', () => {
    const items = projectScene(sceneOf([circle]), 0.01);
    const radius = 40 * 100 / 50;
    for (const { x, y } of (items[0] as ShapeItem).runs[0].points) {
      expect(Math.abs(Math.hypot(x, y) - radius)).toBeLessThan(0.05);
    }
  });

  it('uses more points at a finer tolerance, as when zooming in', () => {
    const count = (tolerance: number) => (projectScene(sceneOf([circle]), tolerance)[0] as ShapeItem).runs[0].points.length;
    expect(count(0.001)).toBeGreaterThan(count(1));
  });

  it('does not subdivide straight edges', () => {
    const { points } = onlyShape([square(placed({}, { y: 0.5 }))]).runs[0];
    expect(points.length).toBeLessThanOrEqual(8);
  });
});

describe('near clipping', () => {
  it('drops geometry entirely behind the camera', () => {
    expect(projectScene(sceneOf([square(placed({ z: -300 }))]), 0.01)).toEqual([]);
  });

  it('keeps finite points for a closed shape crossing the camera plane', () => {
    const { points } = onlyShape([square(placed({ z: -100 }, { y: Math.PI / 2 }))]).runs[0];
    expect(points.length).toBeGreaterThan(0);
    points.forEach(({ x, y }) => expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true));
  });

  it('splits an open path into the runs in front of the camera', () => {
    const line = (x: number, z: number) => ({ point: { x, y: z }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } });
    const open: ShapeNode = {
      kind: 'shape',
      name: 'Open',
      // Turning about x maps local y onto camera depth.
      transform: placed({ z: -100 }, { x: Math.PI / 2 }),
      geometry: { kind: 'path', closed: false, anchors: [line(0, 50), line(1, -50), line(2, 50)] },
      style: { fill: null, stroke: { color: WHITE, width: 1 } },
    };
    const { runs } = onlyShape([open]);
    expect(runs).toHaveLength(2);
    expect(runs.every(run => !run.closed)).toBe(true);
  });

  it('clips a mesh triangle crossing the camera plane into a quad', () => {
    const mesh = triangles([{ x: -10, y: 0, z: -200 }, { x: 10, y: 0, z: 0 }, { x: -10, y: 10, z: 0 }], [[0, 1, 2]]);
    const item = projectScene(sceneOf([mesh]), 0.01)[0] as MeshItem;
    expect(item.polygons[0]).toHaveLength(4);
  });
});

describe('meshes', () => {
  it('winds every polygon the same way regardless of face winding', () => {
    const vertices = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }, { x: 10, y: 10, z: 0 }];
    const item = projectScene(sceneOf([triangles(vertices, [[0, 1, 2], [3, 1, 2]])]), 0.01)[0] as MeshItem;
    expect(item.polygons.map(area).every(value => value > 0)).toBe(true);
  });

  it('projects standalone edges, even with no faces, and clips them at the camera plane', () => {
    const vertices = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: -300 }];
    const mesh: MeshNode = { ...triangles(vertices, []), edges: fixed([[0, 1], [0, 2]]) };
    const item = projectScene(sceneOf([mesh]), 0.01)[0] as MeshItem;
    expect(item.polygons).toEqual([]);
    expect(item.lines).toHaveLength(2);
    item.lines.flat().forEach(({ x, y }) => expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true));
  });

  it('applies the node transform and carries the fill', () => {
    const mesh = triangles([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }], [[0, 1, 2]], placed({ x: 5 }));
    const item = projectScene(sceneOf([mesh]), 0.01)[0] as MeshItem;
    const xs = item.polygons[0].map(p => p.x).sort((a, b) => a - b);
    [5, 5, 15].forEach((x, i) => expect(xs[i]).toBeCloseTo(x));
    expect(item.fill).toEqual({ r: 1, g: 0, b: 0 });
  });
});

describe('painting order', () => {
  it('paints farthest first', () => {
    const near = square(placed({ z: -10 }));
    const far = square(placed({ z: 50 }));
    const depths = projectScene(sceneOf([near, far]), 0.01).map(item => item.depth);
    expect(depths[0]).toBeGreaterThan(depths[1]);
  });

  it('keeps document order at equal depth', () => {
    const first = { ...square(placed()), style: { fill: { ...WHITE, r: 0 }, stroke: null } };
    const second = { ...square(placed()), style: { fill: { ...WHITE, r: 0.5 }, stroke: null } };
    const items = projectScene(sceneOf([first, second]), 0.01) as ShapeItem[];
    expect(items.map(item => item.fill?.r)).toEqual([0, 0.5]);
  });
});
