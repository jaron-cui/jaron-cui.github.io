import { deleteObjects, EditorDocument, findObject, SceneObject, selectedVisible, uniqueName, updateObject, worldMatrices } from './document';
import { deleteVertices, vertexNeighbors } from './editing';
import { AnimatedVertex, negatedValue, poseAt, transformedVertex } from './keyframes';
import { invertMatrix, multiply } from './matrix';
import { Edge, Face } from './model';
import { mirrorMesh, MirrorAxis, MirrorModifier } from './modifiers';
import { groupsAfterDelete } from './rigging';

function isMesh(object: SceneObject): boolean {
  return !object.camera && !object.bones;
}

// Ctrl+J: moves the other selected meshes into the active one, keeping where they appear. Vertex
// groups of the same name become one group. Their own modifiers are dropped, as in Blender.
export function joinSelected(document: EditorDocument, time: number): { document: EditorDocument; joined: number } {
  const active = findObject(document, document.activeObject);
  if (!active || !isMesh(active)) {
    return { document, joined: 0 };
  }
  const sources = selectedVisible(document)
    .map(id => findObject(document, id)!)
    .filter(object => object.id !== active.id && isMesh(object));
  if (sources.length === 0) {
    return { document, joined: 0 };
  }
  const matrices = worldMatrices(document, time);
  const inverse = invertMatrix(matrices.get(active.id)!);
  let { vertices, faces, edges, vertexGroups } = active;
  let nextId = document.nextId;
  for (const source of sources) {
    const offset = vertices.length;
    const relative = multiply(inverse, matrices.get(source.id)!);
    vertices = [...vertices, ...source.vertices.map(vertex => transformedVertex(vertex, relative))];
    faces = [...faces, ...source.faces.map(([a, b, c]): Face => [a + offset, b + offset, c + offset])];
    edges = [...edges, ...source.edges.map(([a, b]): Edge => [a + offset, b + offset])];
    for (const group of source.vertexGroups) {
      const shifted = new Map(Array.from(group.weights).map(([i, weight]) => [i + offset, weight] as [number, number]));
      const existing = vertexGroups.find(other => other.name === group.name);
      vertexGroups = existing
        ? vertexGroups.map(other => (other === existing ? { ...other, weights: new Map([...Array.from(other.weights), ...Array.from(shifted)]) } : other))
        : [...vertexGroups, { id: `group-${nextId++}`, name: group.name, weights: shifted }];
    }
  }
  const merged = updateObject({ ...document, nextId }, active.id, object => ({
    ...object,
    vertices,
    faces,
    edges,
    vertexGroups,
    deformer: object.deformer ?? sources.find(source => source.deformer)?.deformer ?? null,
    selectedVertices: new Set(),
  }));
  return { document: deleteObjects({ ...merged, selectedObjects: [active.id] }, sources.map(source => source.id), time), joined: sources.length };
}

// A new object holding some vertices of another, and the faces and lines wholly among them.
function partOf(object: SceneObject, part: Set<number>): Pick<SceneObject, 'vertices' | 'faces' | 'edges' | 'vertexGroups' | 'selectedVertices'> {
  const kept = Array.from(part).sort((a, b) => a - b);
  const index = new Map(kept.map((old, i) => [old, i]));
  return {
    vertices: kept.map(i => object.vertices[i]),
    faces: object.faces.filter(face => face.every(i => part.has(i))).map(([a, b, c]): Face => [index.get(a)!, index.get(b)!, index.get(c)!]),
    edges: object.edges.filter(edge => edge.every(i => part.has(i))).map(([a, b]): Edge => [index.get(a)!, index.get(b)!]),
    vertexGroups: groupsAfterDelete(object.vertexGroups, kept),
    selectedVertices: new Set(),
  };
}

function addParts(document: EditorDocument, object: SceneObject, parts: Set<number>[]): EditorDocument {
  let { objects, nextId } = document;
  const ids: string[] = [];
  for (const part of parts) {
    const id = `object-${nextId++}`;
    ids.push(id);
    objects = [...objects, { ...object, ...partOf(object, part), id, name: uniqueName(objects.map(other => other.name), object.name) }];
  }
  return { ...document, objects, nextId, selectedObjects: [...document.selectedObjects, ...ids] };
}

// P: Selection. The selected part becomes an object of its own, with the same transform and settings.
// Vertices that unselected faces still use stay behind as well, as in Blender. Returns the same
// document if there is nothing to split off, or nothing would be left.
export function separateSelection(document: EditorDocument, id: string, time: number): EditorDocument {
  const object = findObject(document, id)!;
  const part = object.selectedVertices;
  const faces = object.faces.filter(face => !face.every(i => part.has(i)));
  const edges = object.edges.filter(edge => !edge.every(i => part.has(i)));
  const used = new Set([...faces.flat(), ...edges.flat()]);
  const orphans = new Set(Array.from(part).filter(i => !used.has(i)));
  if (part.size === 0 || orphans.size === object.vertices.length) {
    return document;
  }
  const { mesh, kept } = deleteVertices({ vertices: poseAt(object.vertices, time), faces, edges }, orphans);
  const added = addParts(document, object, [part]);
  return updateObject(added, id, current => ({
    ...current,
    vertices: kept.map(i => current.vertices[i]),
    faces: mesh.faces,
    edges: mesh.edges,
    vertexGroups: groupsAfterDelete(current.vertexGroups, kept),
    selectedVertices: new Set(),
  }));
}

// P: By Loose Parts. Each piece not connected to the rest becomes an object of its own, and the
// original keeps the first. Returns the same document if the mesh is all one piece.
export function separateLooseParts(document: EditorDocument, id: string, time: number): EditorDocument {
  const object = findObject(document, id)!;
  const neighbors = vertexNeighbors({ vertices: poseAt(object.vertices, time), faces: object.faces, edges: object.edges });
  const seen = new Set<number>();
  const parts: Set<number>[] = [];
  object.vertices.forEach((_, start) => {
    if (seen.has(start)) {
      return;
    }
    const part = new Set([start]);
    const open = [start];
    seen.add(start);
    while (open.length > 0) {
      for (const next of neighbors[open.pop()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          part.add(next);
          open.push(next);
        }
      }
    }
    parts.push(part);
  });
  if (parts.length < 2) {
    return document;
  }
  return updateObject(addParts(document, object, parts.slice(1)), id, current => ({ ...current, ...partOf(object, parts[0]) }));
}

function reflected(vertex: AnimatedVertex, axis: MirrorAxis): AnimatedVertex {
  return { ...vertex, [axis]: negatedValue(vertex[axis]) };
}

// Makes a mirror's result the real mesh, and removes the modifier.
export function applyMirror(document: EditorDocument, id: string, modifierId: string, time: number): EditorDocument {
  const object = findObject(document, id)!;
  const modifier = object.modifiers?.find(candidate => candidate.id === modifierId) as MirrorModifier;
  let { vertices, faces, edges, vertexGroups } = object;
  for (const axis of (['x', 'y', 'z'] as const).filter(candidate => modifier.axes[candidate])) {
    const one = { ...modifier, axes: { x: axis === 'x', y: axis === 'y', z: axis === 'z' } };
    const result = mirrorMesh({ vertices: poseAt(vertices, time), faces, edges }, vertexGroups, one);
    const welded = new Set(result.welded);
    const current = vertices;
    vertices = [
      ...current.map((vertex, i) => (welded.has(i) ? { ...vertex, [axis]: 0 } : vertex)),
      ...result.copiedFrom.map(source => reflected(current[source], axis)),
    ];
    faces = result.faces;
    edges = result.edges;
    vertexGroups = result.groups;
  }
  // Mirrored groups made anew need ids of their own.
  let { nextId } = document;
  vertexGroups = vertexGroups.map(group => (group.id.endsWith(':mirrored') ? { ...group, id: `group-${nextId++}` } : group));
  return updateObject({ ...document, nextId }, id, current => ({
    ...current,
    vertices,
    faces,
    edges,
    vertexGroups,
    modifiers: (current.modifiers ?? []).filter(candidate => candidate.id !== modifierId),
  }));
}
