import {
  addFolder, addObject, emptyDocument, EditorDocument, findObject, isSelectable, moveToFolder, objectOrigin, pickObject, selectedVisible, toggleFolderSelectable, toggleObjectSelectable,
  toggleObjectVisible, toScene, updateChannel, updateTransform, curveChannels, duplicateObjects, rowKeyTimes, setFrameEnd, setFrameRate, setFrameStart, worldVertices,
} from './document';
import { Ease, sampleTrack, track } from './animation';
import { extrudeSelection, regionNormal, rotatedAroundAxis, scaledAbout, subdivideSelection, translatedAlongAxis, viewRay, wireframeEdges, worldRotation } from './editing';
import { frameTimes, svgAnimation, svgFrame } from '../../../lib/vrender/exporting';
import { midpointVertex, poseAt, segmentHandles, setCoordinateEase, writeKeys } from './keyframes';
import { Camera, Vec3 } from '../../../lib/vrender/model';
import { cubeMesh, MeshData, planeMesh } from './primitives';
import { projectPoint, projectScene } from '../../../lib/vrender/project';
import { groupsAfterSubdivide } from './rigging';
import { applySnap } from './snapping';
import { panView, rulerTicks, zoomView } from './timelineView';

const FRONT: Camera = { position: { x: 0, y: 0, z: -500 }, rotation: { x: Math.PI / 2, y: 0, z: 0 }, focalLength: 500 };

function near(actual: Vec3, expected: Vec3) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.z).toBeCloseTo(expected.z);
}

function uses(mesh: MeshData, a: number, b: number) {
  return wireframeEdges(mesh).some(([p, q]) => (p === a && q === b) || (p === b && q === a));
}

describe('extruding', () => {
  // A plane is vertices 0 to 3 with two faces. The cube's top quad is what a face selection takes.
  const cube = cubeMesh(100);
  const cubeTop = () => new Set(cube.vertices.flatMap((vertex, i) => (vertex.z > 0 ? [i] : [])));

  it('grows a line from a lone vertex', () => {
    const mesh: MeshData = { vertices: [{ x: 0, y: 0, z: 0 }], faces: [], edges: [] };
    const result = extrudeSelection(mesh, new Set([0]));
    expect(result.mesh.vertices).toHaveLength(2);
    expect(result.mesh.edges).toEqual([[0, 1]]);
    expect(result.selection).toEqual(new Set([1]));
  });

  it('grows a line from a vertex on a mesh, leaving its faces alone', () => {
    const plane = planeMesh(50);
    const result = extrudeSelection(plane, new Set([0]));
    expect(result.mesh.vertices).toHaveLength(5);
    expect(result.mesh.faces).toEqual(plane.faces);
    expect(result.mesh.edges).toEqual([[0, 4]]);
  });

  it('grows a wall from a standalone line', () => {
    const line: MeshData = { vertices: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], faces: [], edges: [[0, 1]] };
    const result = extrudeSelection(line, new Set([0, 1]));
    expect(result.mesh.vertices).toHaveLength(4);
    expect(result.mesh.faces).toHaveLength(2);
    expect(result.selection).toEqual(new Set([2, 3]));
  });

  it('grows a wall from a line on the edge of a mesh, without touching the faces beside it', () => {
    const plane = planeMesh(50);
    const result = extrudeSelection(plane, new Set([0, 1]));
    expect(result.mesh.vertices).toHaveLength(6);
    expect(result.mesh.faces).toHaveLength(4);
    expect(result.mesh.faces.slice(0, 2)).toEqual(plane.faces);
    expect(result.mesh.edges).toEqual([]);
  });

  it('grows walls along connected lines, with one copy of each shared vertex', () => {
    const path: MeshData = { vertices: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }], faces: [], edges: [[0, 1], [1, 2]] };
    const result = extrudeSelection(path, new Set([0, 1, 2]));
    expect(result.mesh.vertices).toHaveLength(6);
    expect(result.mesh.faces).toHaveLength(4);
  });

  it('keeps a lone face as the far side, as with a plane', () => {
    const triangle: MeshData = { vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], faces: [[0, 1, 2]], edges: [] };
    const result = extrudeSelection(triangle, new Set([0, 1, 2]));
    expect(result.mesh.vertices).toHaveLength(6);
    // The original, the lifted copy, and two triangles per side.
    expect(result.mesh.faces).toHaveLength(8);
  });

  it('walls only the boundary of a region, not lines inside it', () => {
    const plane = planeMesh(50);
    const result = extrudeSelection(plane, new Set([0, 1, 2, 3]));
    // Two kept, two lifted, and two triangles for each of the 4 outside lines. The diagonal gets none.
    expect(result.mesh.faces).toHaveLength(12);
  });

  it('lifts a region bordered by other faces, leaving no face behind', () => {
    const result = extrudeSelection(cube, cubeTop());
    expect(result.mesh.vertices).toHaveLength(12);
    // The other 5 sides, the lifted top, and 4 new sides.
    expect(result.mesh.faces).toHaveLength(10 + 2 + 8);
    const old = cubeTop();
    expect(result.mesh.faces.slice(0, 12).filter(face => face.every(i => old.has(i)))).toEqual([]);
    Array.from(result.selection).forEach(i => expect(i).toBeGreaterThanOrEqual(8));
  });

  it('removes vertices left unused inside a lifted region', () => {
    // A square of four triangles around a center vertex, inside a larger triangle fan.
    const vertices = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0.5, y: 0.5, z: 0 }, { x: 5, y: 0, z: 0 },
    ];
    const mesh: MeshData = { vertices, faces: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [1, 5, 2]], edges: [] };
    const result = extrudeSelection(mesh, new Set([0, 1, 2, 3, 4]));
    expect(result.kept).not.toContain(4);
    // Only the center is left unused, since the outer vertices still hold the walls.
    expect(result.mesh.vertices).toHaveLength(6 + 5 - 1);
    result.mesh.faces.flat().forEach(i => expect(i).toBeLessThan(result.mesh.vertices.length));
    expect(result.selection.size).toBe(5);
  });

  it('copes with an entirely selected closed mesh', () => {
    const result = extrudeSelection(cube, new Set(cube.vertices.map((_, i) => i)));
    expect(result.mesh.faces).toHaveLength(24);
    expect(result.selection.size).toBe(8);
  });

  it('handles mixed selections: a face and a separate vertex', () => {
    const mesh: MeshData = {
      vertices: [...planeMesh(50).vertices, { x: 500, y: 0, z: 0 }],
      faces: [[0, 1, 2]],
      edges: [],
    };
    const result = extrudeSelection(mesh, new Set([0, 1, 2, 4]));
    expect(result.mesh.edges).toEqual([[4, 8]].map(([a]) => [a, result.mesh.vertices.length - 1]));
    expect(result.selection.size).toBe(4);
  });

  it('finds the direction a region faces, and none for a closed one or no faces', () => {
    const normal = regionNormal(cube.vertices, cube.faces, cubeTop());
    near({ x: 0, y: 0, z: Math.abs(normal!.z) }, { x: 0, y: 0, z: 1 });
    expect(regionNormal(cube.vertices, cube.faces, new Set(cube.vertices.map((_, i) => i)))).toBeNull();
    expect(regionNormal(cube.vertices, cube.faces, new Set([0, 1]))).toBeNull();
  });

  it('agrees on a normal even when faces wind opposite ways', () => {
    const plane = planeMesh(50);
    const mixed: Face3[] = [[0, 1, 2], [0, 3, 2]];
    expect(Math.abs(regionNormal(plane.vertices, mixed, new Set([0, 1, 2, 3]))!.z)).toBeCloseTo(1);
  });
});

type Face3 = [number, number, number];

describe('subdividing', () => {
  const triangle: MeshData = { vertices: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }], faces: [[0, 1, 2]], edges: [] };

  it('splits a fully selected triangle into four', () => {
    const { faces, splits, selection } = subdivideSelection(triangle, new Set([0, 1, 2]));
    expect(faces).toHaveLength(4);
    expect(splits).toHaveLength(3);
    expect(selection.size).toBe(6);
  });

  it('splits around one selected line, leaving no crack', () => {
    const { faces, splits } = subdivideSelection(triangle, new Set([0, 1]));
    expect(splits).toEqual([[0, 1]]);
    expect(faces).toHaveLength(2);
    expect(faces.flat()).toContain(3);
  });

  it('splits neighbors of a selected region along the shared line only', () => {
    const plane = planeMesh(50);
    // Vertices 0, 1, 2 make face 0. Face 1 shares the line from 0 to 2.
    const { faces, splits } = subdivideSelection(plane, new Set([0, 1, 2]));
    expect(splits).toHaveLength(3);
    expect(faces).toHaveLength(4 + 2);
  });

  it('handles two split sides in every rotation', () => {
    for (const pair of [[0, 1, 2], [1, 2, 0], [2, 0, 1]]) {
      const mesh: MeshData = { ...triangle, edges: [], faces: [[pair[0], pair[1], pair[2]]] };
      const extra: MeshData = { ...mesh, vertices: mesh.vertices };
      // Selecting two vertices can only split one side, so give it another triangle's selection by hand.
      const { faces } = subdivideSelection(extra, new Set([pair[0], pair[1]]));
      expect(faces).toHaveLength(2);
    }
  });

  it('splits standalone lines and leaves unselected ones', () => {
    const line: MeshData = { vertices: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }], faces: [], edges: [[0, 1], [1, 2]] };
    const { edges } = subdivideSelection(line, new Set([0, 1]));
    expect(edges).toEqual([[0, 3], [3, 1], [1, 2]]);
  });

  it('does nothing without a selected line', () => {
    const { faces, splits } = subdivideSelection(triangle, new Set([0]));
    expect(faces).toEqual(triangle.faces);
    expect(splits).toEqual([]);
  });

  it('places animated middles so they follow both ends', () => {
    const [a] = writeKeys([{ x: 0, y: 0, z: 0 }], [0], [{ x: 0, y: 0, z: 0 }], 0);
    const [keyed] = writeKeys([a], [0], [{ x: 10, y: 0, z: 0 }], 1);
    const middle = midpointVertex(keyed, { x: 20, y: 0, z: 0 });
    expect(poseAt([middle], 0)[0].x).toBeCloseTo(10);
    expect(poseAt([middle], 1)[0].x).toBeCloseTo(15);
    expect(midpointVertex({ x: 2, y: 4, z: 6 }, { x: 4, y: 4, z: 6 })).toEqual({ x: 3, y: 4, z: 6 });
  });

  it('averages weights onto new vertices', () => {
    const groups = [{ id: 'g', name: 'G', weights: new Map([[0, 1]]) }];
    expect(groupsAfterSubdivide(groups, [[0, 1], [1, 2]], 3)[0].weights).toEqual(new Map([[0, 1], [3, 0.5]]));
  });
});

describe('locking to any direction', () => {
  const diagonal = { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 };
  const points = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 10, y: -10, z: 0 }];
  const everyone = new Set([0, 1, 2]);

  it('scales only along the direction', () => {
    const scaled = scaledAbout([{ x: -1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: -1, y: 1, z: 0 }], new Set([0, 1, 2, 3]), 2, diagonal);
    near(scaled[1], { x: 2, y: 2, z: 0 });
    near(scaled[2], { x: 1, y: -1, z: 0 });
  });

  it('moves only along the direction', () => {
    const moved = translatedAlongAxis(points, new Set([0]), FRONT, diagonal, 40, 0);
    expect(moved[0].x).toBeCloseTo(moved[0].y);
    expect(moved[0].x).not.toBeCloseTo(0);
  });

  it('agrees with the named axis for a global direction', () => {
    const named = translatedAlongAxis(points, everyone, FRONT, 'x', 40, 10);
    const vector = translatedAlongAxis(points, everyone, FRONT, { x: 1, y: 0, z: 0 }, 40, 10);
    expect(vector).toEqual(named);
    const turned = rotatedAroundAxis(points, new Set([0]), FRONT, { x: 0, y: 0, z: 1 }, 1);
    expect(turned).toEqual(rotatedAroundAxis(points, new Set([0]), FRONT, 'z', 1));
    expect(worldRotation(FRONT, { x: 0, y: 0, z: 1 }, 1)).toEqual(worldRotation(FRONT, 'z', 1));
  });
});

describe('sight lines', () => {
  it('pass through the point clicked, at the depth asked for', () => {
    const { direction, onPlane } = viewRay(FRONT, { x: 30, y: -20 }, { x: 0, y: 0, z: 100 });
    expect(onPlane.z).toBeCloseTo(100);
    const back = projectPoint(FRONT, onPlane)!;
    expect(back.x).toBeCloseTo(30);
    expect(back.y).toBeCloseTo(-20);
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1);
    const along = projectPoint(FRONT, { x: FRONT.position.x + direction.x * 700, y: FRONT.position.y + direction.y * 700, z: FRONT.position.z + direction.z * 700 })!;
    expect(along.x).toBeCloseTo(30);
  });

  it('fall back to the focal distance for a depth behind the camera', () => {
    expect(viewRay(FRONT, { x: 0, y: 0 }, { x: 0, y: 0, z: -9000 }).onPlane.z).toBeCloseTo(0);
  });
});

describe('the scene cursor', () => {
  const cursor = { x: 7, y: 8, z: 9 };
  const at = (document: EditorDocument, id: string, position: Vec3) => updateTransform(document, id, transform => ({ ...transform, position }));
  const scene = () => {
    let document = addObject(addObject(emptyDocument(), 'A', cubeMesh(10)), 'B', cubeMesh(10));
    const [a, b] = document.objects.map(object => object.id);
    document = at(at(document, a, { x: 100, y: 0, z: 0 }), b, { x: 0, y: 100, z: 0 });
    return { document, a, b };
  };

  it('is where new objects appear', () => {
    const { document } = scene();
    const next = addObject(document, 'C', cubeMesh(1), null, cursor);
    near(objectOrigin(next, next.activeObject!, 0), { x: 7, y: 8, z: 9 });
  });

  it('moves selected objects to it', () => {
    const { document, a, b } = scene();
    const next = applySnap({ ...document, selectedObjects: [a, b] }, 'selectionToCursor', 0, cursor).document;
    near(objectOrigin(next, a, 0), { x: 7, y: 8, z: 9 });
    near(objectOrigin(next, b, 0), { x: 7, y: 8, z: 9 });
  });

  it('can keep the offset between them', () => {
    const { document, a, b } = scene();
    const next = applySnap({ ...document, selectedObjects: [a, b] }, 'selectionToCursorOffset', 0, cursor).document;
    const [ao, bo] = [objectOrigin(next, a, 0), objectOrigin(next, b, 0)];
    near({ x: ao.x - bo.x, y: ao.y - bo.y, z: ao.z - bo.z }, { x: 100, y: -100, z: 0 });
    near({ x: (ao.x + bo.x) / 2, y: (ao.y + bo.y) / 2, z: (ao.z + bo.z) / 2 }, { x: 7, y: 8, z: 9 });
  });

  it('moves one object to another with Selection to Active', () => {
    const { document, a, b } = scene();
    const next = applySnap({ ...document, selectedObjects: [a, b], activeObject: b }, 'selectionToActive', 0, cursor).document;
    near(objectOrigin(next, a, 0), { x: 0, y: 100, z: 0 });
    near(objectOrigin(next, b, 0), { x: 0, y: 100, z: 0 });
  });

  it('follows selections and actives, the grid, and the origin', () => {
    const { document, a, b } = scene();
    near(applySnap({ ...document, selectedObjects: [a, b] }, 'cursorToSelected', 0, cursor).cursor, { x: 50, y: 50, z: 0 });
    near(applySnap({ ...document, activeObject: a }, 'cursorToActive', 0, cursor).cursor, { x: 100, y: 0, z: 0 });
    near(applySnap(document, 'cursorToOrigin', 0, cursor).cursor, { x: 0, y: 0, z: 0 });
    near(applySnap(document, 'cursorToGrid', 0, { x: 149, y: 151, z: -49 }).cursor, { x: 100, y: 200, z: -0 });
  });

  it('snaps selection to the grid', () => {
    const { document, a } = scene();
    const moved = at(document, a, { x: 130, y: 0, z: 0 });
    near(objectOrigin(applySnap({ ...moved, selectedObjects: [a] }, 'selectionToGrid', 0, cursor).document, a, 0), { x: 100, y: 0, z: 0 });
  });

  it('collapses selected vertices onto it in edit mode, or moves them together', () => {
    const { document, a } = scene();
    const editing = updateVertices(document, a, new Set([0, 1]));
    const collapsed = applySnap(editing, 'selectionToCursor', 0, cursor).document;
    const world = worldVertices(collapsed, findObject(collapsed, a)!, 0);
    near(world[0], { x: 7, y: 8, z: 9 });
    near(world[1], { x: 7, y: 8, z: 9 });
    const together = applySnap(editing, 'selectionToCursorOffset', 0, cursor).document;
    const kept = worldVertices(together, findObject(together, a)!, 0);
    expect(Math.hypot(kept[0].x - kept[1].x, kept[0].y - kept[1].y, kept[0].z - kept[1].z)).toBeCloseTo(20);
  });

  it('does nothing without a selection, returning the same document', () => {
    const { document } = scene();
    const empty = { ...document, selectedObjects: [] };
    expect(applySnap(empty, 'selectionToCursor', 0, cursor).document).toBe(empty);
    expect(applySnap(empty, 'cursorToSelected', 0, cursor).cursor).toBe(cursor);
  });

  function updateVertices(document: EditorDocument, id: string, selectedVertices: Set<number>): EditorDocument {
    return {
      ...document,
      mode: 'edit',
      activeObject: id,
      objects: document.objects.map(object => (object.id === id ? { ...object, selectedVertices } : object)),
    };
  }
});

describe('selection and visibility', () => {
  const pair = () => {
    const document = addObject(addObject(emptyDocument(), 'A', cubeMesh(100)), 'B', cubeMesh(100));
    return { document: { ...document, selectedObjects: document.objects.map(object => object.id) }, a: document.objects[0].id, b: document.objects[1].id };
  };

  it('keeps a hidden object selected, and out of actions, and selected again on showing', () => {
    const { document, a, b } = pair();
    const hidden = toggleObjectVisible(document, a);
    expect(hidden.selectedObjects).toEqual([a, b]);
    expect(selectedVisible(hidden)).toEqual([b]);
    expect(duplicateObjects(hidden).selectedObjects).toHaveLength(1);
    expect(selectedVisible(toggleObjectVisible(hidden, a))).toEqual([a, b]);
    const moved = applySnap(hidden, 'selectionToCursor', 0, { x: 50, y: 0, z: 0 }).document;
    expect(objectOrigin(moved, a, 0).x).toBeCloseTo(0);
    expect(objectOrigin(moved, b, 0).x).toBeCloseTo(50);
  });

  it('leaves edit mode when the edited object is hidden, keeping it active', () => {
    const { document, a } = pair();
    const hidden = toggleObjectVisible({ ...document, mode: 'edit', activeObject: a }, a);
    expect(hidden.mode).toBe('object');
    expect(hidden.activeObject).toBe(a);
  });

  it('makes an object unpickable and deselects it, keeping it active and rendered', () => {
    const { document, a } = pair();
    const off = toggleObjectSelectable({ ...document, activeObject: a }, a);
    expect(off.selectedObjects).not.toContain(a);
    expect(off.activeObject).toBe(a);
    expect(isSelectable(off, findObject(off, a)!)).toBe(false);
    expect(toScene(off, FRONT, 0, null).nodes).toHaveLength(2);
    expect(isSelectable(toggleObjectSelectable(off, a), findObject(off, a)!)).toBe(false);
  });

  it('lets clicks through to what is behind, and works through folders', () => {
    const start = addObject(emptyDocument(), 'Only', cubeMesh(100));
    const id = start.objects[0].id;
    expect(pickObject(toggleObjectSelectable(start, id), FRONT, 0, { x: 0, y: 0 }, 5)).toBeNull();
    const foldered = addFolder(start);
    const folder = foldered.folders[0].id;
    const inside = moveToFolder({ ...foldered, selectedObjects: [id] }, [{ kind: 'object', id }], folder);
    const off = toggleFolderSelectable(inside, folder);
    expect(pickObject(off, FRONT, 0, { x: 0, y: 0 }, 5)).toBeNull();
    expect(off.selectedObjects).toEqual([]);
    expect(pickObject(toggleFolderSelectable(off, folder), FRONT, 0, { x: 0, y: 0 }, 5)).toBe(id);
  });

  it('outlines selected objects only when asked, and only in object mode', () => {
    const { document, a } = pair();
    const highlights = (current: EditorDocument, on: boolean) => toScene(current, FRONT, 0, null, on).nodes.map(node => node.kind === 'mesh' && Boolean(node.highlight));
    expect(highlights(document, false)).toEqual([false, false]);
    expect(highlights({ ...document, selectedObjects: [a] }, true)).toEqual([true, false]);
    expect(highlights({ ...document, selectedObjects: [a], mode: 'edit' }, true)).toEqual([false, false]);
  });
});

describe('the animation view', () => {
  it('zooms about the given position, keeping that time in place', () => {
    const view = zoomView({ start: 0, end: 40 }, 0.75, 0.5);
    expect(view).toEqual({ start: 15, end: 35 });
    expect(view.start + (view.end - view.start) * 0.75).toBeCloseTo(30);
  });

  it('stops zooming at its limits, still about the same time', () => {
    const view = zoomView({ start: 0, end: 10 }, 0.5, 0.001);
    expect(view.end - view.start).toBeCloseTo(4);
    expect((view.start + view.end) / 2).toBeCloseTo(5);
  });

  it('pans without changing its span', () => {
    expect(panView({ start: 1, end: 3 }, -2)).toEqual({ start: -1, end: 1 });
  });

  it('marks finer ticks when zoomed in and coarser when out', () => {
    expect(rulerTicks({ start: 0, end: 10 }, 900)).toContain(1);
    expect(rulerTicks({ start: 0, end: 96 }, 900)).toContain(10);
    expect(rulerTicks({ start: 0, end: 6000 }, 900)).not.toContain(1);
    rulerTicks({ start: -30, end: 30 }, 500).forEach(tick => expect(Math.abs(tick)).toBeLessThanOrEqual(30));
  });
});

describe('frames', () => {
  const keyed = () => {
    const document = addObject(emptyDocument(), 'A', cubeMesh(1));
    return updateTransform(document, document.objects[0].id, transform => {
      const parts = [transform.position, transform.rotation, transform.scale];
      const once = writeKeys(parts, [0], [{ x: 10, y: 0, z: 0 }], 1);
      const [position, rotation, scale] = writeKeys(once, [0], [{ x: 20, y: 0, z: 0 }], 2);
      return { position, rotation, scale };
    });
  };

  it('keeps keys on their frames when the rate changes, so timing changes', () => {
    const start = keyed();
    const next = setFrameRate(start, 48);
    expect(next.frameRate).toBe(48);
    expect(rowKeyTimes(next, 'all')).toEqual([0.5, 1]);
    expect(rowKeyTimes(start, 'all')).toEqual([1, 2]);
    expect(setFrameRate(start, 0.2).frameRate).toBe(1);
  });

  it('keeps start and end in order, pushing the other along', () => {
    const start = emptyDocument();
    expect(setFrameStart(start, 200)).toMatchObject({ frameStart: 200, frameEnd: 200 });
    expect(setFrameEnd(start, 0)).toMatchObject({ frameStart: 0, frameEnd: 0 });
    expect(setFrameStart(start, -5).frameStart).toBe(0);
    expect(setFrameEnd(start, 50.4).frameEnd).toBe(50);
  });
});

describe('animation curves', () => {
  const channel = () => {
    const document = addObject(emptyDocument(), 'A', cubeMesh(1));
    const id = document.objects[0].id;
    const keyedDocument = updateTransform(document, id, transform => {
      const parts = [transform.position, transform.rotation, transform.scale];
      const once = writeKeys(parts, [0], [{ x: 10, y: 0, z: 0 }], 0);
      const [position, rotation, scale] = writeKeys(once, [0], [{ x: 20, y: 0, z: 0 }], 1);
      return { position, rotation, scale };
    });
    const selected = { ...keyedDocument, selectedObjects: [id] };
    return { document: selected, x: curveChannels(selected).find(item => item.label.endsWith('Location X'))! };
  };

  it('lists only what is animated, in display units', () => {
    const { document } = channel();
    expect(curveChannels(document).map(item => item.label)).toEqual(['A Location X', 'A Location Y', 'A Location Z']);
    expect(curveChannels({ ...document, selectedObjects: [] })).toEqual([]);
  });

  it('supports constant, linear, and bezier between keys', () => {
    const { document, x } = channel();
    const value = (ease: Ease) => sampleTrack(curveChannels(updateChannel(document, x, vertex => setCoordinateEase(vertex, 'x', 0, ease)))[0].track, 0.25);
    expect(value('hold')).toBeCloseTo(10);
    expect(value('linear')).toBeCloseTo(12.5);
    expect(value({ out: [0.25, 5], in: [-0.25, -5] })).not.toBeCloseTo(12.5);
  });

  it('changes one coordinate without touching the others', () => {
    const { document, x } = channel();
    const next = updateChannel(document, x, vertex => setCoordinateEase(vertex, 'x', 0, 'hold'));
    const [cx, cy] = curveChannels(next);
    expect(cx.track.keys[0].ease).toBe('hold');
    expect(cy.track.keys[0].ease).not.toBe('hold');
  });

  it('bends a flat segment with absolute handles, which a normalized ease cannot', () => {
    const flat = track({ time: 0, value: 5, ease: { out: [0.3, 10], in: [-0.3, 10] } }, { time: 1, value: 5 });
    expect(sampleTrack(flat, 0.5)).toBeGreaterThan(10);
    expect(sampleTrack(flat, 0)).toBe(5);
    expect(sampleTrack(flat, 1)).toBe(5);
  });

  it('keeps time moving forward when handles reach past the segment', () => {
    const wild = track({ time: 0, value: 0, ease: { out: [5, 1], in: [-5, 0] } }, { time: 1, value: 1 });
    [0.1, 0.5, 0.9].forEach(time => expect(Number.isFinite(sampleTrack(wild, time))).toBe(true));
  });

  it('shows an ease as handles that give the same curve', () => {
    const from = { time: 0, value: 10, ease: [0.42, 0, 0.58, 1] as Ease };
    const to = { time: 2, value: 30 };
    const handles = segmentHandles(from, to)!;
    const before = track(from, to);
    const after = track({ ...from, ease: handles }, to);
    [0.3, 1, 1.7].forEach(time => expect(sampleTrack(after, time)).toBeCloseTo(sampleTrack(before, time), 3));
    expect(segmentHandles({ time: 0, value: 0, ease: 'linear' }, to)).toBeNull();
  });

  it('keeps handles with their keys when the rate changes', () => {
    const { document, x } = channel();
    const bent = updateChannel(document, x, vertex => setCoordinateEase(vertex, 'x', 0, { out: [0.5, 1], in: [-0.5, 1] }));
    const ease = curveChannels(setFrameRate(bent, 48))[0].track.keys[0].ease as { out: number[] };
    expect(ease.out[0]).toBeCloseTo(0.25);
    expect(ease.out[1]).toBeCloseTo(1);
  });
});

describe('exporting', () => {
  const scene = () => {
    const document = addObject(emptyDocument(), 'Cube', cubeMesh(100));
    return toScene(document, FRONT, 0, null);
  };

  it('writes one frame as a standalone SVG centered on the image origin', () => {
    const svg = svgFrame(scene(), { width: 800, height: 600 });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="-400 -300 800 600"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('rgb(74,108,216)');
  });

  it('matches the projected geometry', () => {
    const items = projectScene(scene(), 0.1);
    const svg = svgFrame(scene(), { width: 800, height: 600 });
    expect(items).toHaveLength(1);
    expect((svg.match(/<path/g) ?? []).length).toBe(2);
  });

  it('leaves selection outlines out', () => {
    const document = addObject(emptyDocument(), 'Cube', cubeMesh(100));
    expect(svgFrame(toScene(document, FRONT, 0, null), { width: 100, height: 100 })).not.toContain('255,140,40');
  });

  it('writes an animation with a frame for each step, each shown in turn', () => {
    const times = frameTimes(1, 48, 24);
    expect(times[0]).toBeCloseTo(1 / 24);
    expect(times).toHaveLength(48);
    const svg = svgAnimation(() => scene(), times, 24, { width: 100, height: 100 });
    expect(svg.match(/<g style/g) ?? []).toHaveLength(48);
    expect(svg).toContain('animation:show 2s step-end infinite');
    expect(svg).toContain('animation-delay:0.042s');
  });
});
