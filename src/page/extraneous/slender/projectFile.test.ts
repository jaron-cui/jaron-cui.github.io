import { emptyDocument, addObject, displayVertices, findObject, toWorld, updateTransform, worldMatrices } from './document';
import { writeKeys } from './keyframes';
import { cubeMesh } from './primitives';
import { parseProject, ProjectState, serializeProject } from './projectFile';
import { addArmature, addVertexGroup, assignToGroup, extrudeBones, parentSelected } from './rigging';

function stateWith(document: ProjectState['document']): ProjectState {
  return {
    document,
    view: { orbit: { target: { x: 1, y: 2, z: 3 }, yaw: 0.5, pitch: -0.2, distance: 400, focalLength: 700 }, viewedCamera: null, time: 1.5, duration: 6 },
    layout: { outlinerWidth: 250, timelineHeight: 90, objectPaneHeight: 300, transformPanelOpen: true, propertiesTab: 'world' },
    settings: { selectMode: 'face', showOverlays: false, xRay: true, proportional: true, proportionalRadius: 120, proportionalConnected: true, brush: { weight: 0.5, radius: 30, strength: 0.7 } },
  };
}

function riggedDocument() {
  let document = addArmature(addObject(emptyDocument(), 'Cube', cubeMesh(100)));
  const armature = document.activeObject!;
  const mesh = document.objects[0].id;
  document = extrudeBones({ ...document, objects: document.objects.map(object => (object.id === armature ? { ...object, selectedVertices: new Set([1]) } : object)) }, armature, 0);
  document = parentSelected({ ...document, selectedObjects: [mesh, armature], activeObject: armature }, 'armatureAuto', 0).document;
  document = addVertexGroup(document, mesh, 'Extra');
  document = assignToGroup(document, mesh, findObject(document, mesh)!.activeGroup!, new Set([2, 5]), 0.25);
  document = updateTransform(document, findObject(document, armature)!.bones![1].id, transform => {
    const parts = [transform.position, transform.rotation, transform.scale];
    const [position, rotation, scale] = writeKeys(parts, [0, 1, 2], [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }], 2);
    return { position, rotation, scale };
  });
  return { document, mesh, armature };
}

describe('project files', () => {
  it('bring back selections and weights, not empty objects', () => {
    const { document, mesh, armature } = riggedDocument();
    const loaded = parseProject(serializeProject(stateWith(document))).document;
    expect(findObject(loaded, armature)!.selectedVertices).toEqual(findObject(document, armature)!.selectedVertices);
    expect(findObject(loaded, armature)!.selectedVertices).toBeInstanceOf(Set);
    const groups = findObject(loaded, mesh)!.vertexGroups;
    expect(groups[groups.length - 1].weights).toBeInstanceOf(Map);
    expect(groups[groups.length - 1].weights.get(5)).toBeCloseTo(0.25);
    // Compared as text, since JSON writes -0 as 0, which changes nothing.
    const text = serializeProject(stateWith(document));
    expect(serializeProject(stateWith(parseProject(text).document))).toBe(text);
  });

  it('pose and bend the same after loading', () => {
    const { document, mesh } = riggedDocument();
    const loaded = parseProject(serializeProject(stateWith(document))).document;
    const shape = (current: typeof document) => {
      const matrices = worldMatrices(current, 2);
      return toWorld(matrices.get(mesh)!, displayVertices(current, findObject(current, mesh)!, 2, null, matrices));
    };
    expect(shape(loaded)).toEqual(shape(document));
  });

  it('keep the view, layout, and settings', () => {
    const state = stateWith(emptyDocument());
    expect(parseProject(serializeProject(state))).toEqual(state);
  });

  it('are not fooled by other files', () => {
    expect(() => parseProject('not json')).toThrow('not a Slender project');
    expect(() => parseProject('{"format":"other","version":1}')).toThrow('not a Slender project');
    expect(() => parseProject('null')).toThrow('not a Slender project');
    expect(() => parseProject('{"format":"slender","version":1}')).toThrow('incomplete');
  });

  it('refuse files from a newer version rather than misreading them', () => {
    expect(() => parseProject('{"format":"slender","version":99}')).toThrow('newer');
  });
});
