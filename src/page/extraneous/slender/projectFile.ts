import { DEFAULT_FRAME_END, DEFAULT_FRAME_RATE, EditorDocument } from './document';
import { OrbitCamera, PivotMode, SelectMode } from './editing';
import { KeyingSet } from './keyframes';
import { Vec3 } from './model';

// Everything a project file holds. Undo history is left out on purpose.
export type ProjectState = {
  document: EditorDocument;
  // duration is only in files from when the animation's length was kept here, in seconds.
  // cursor is only missing in files from when the document held it.
  view: { orbit: OrbitCamera; viewedCamera: string | null; time: number; duration?: number; cursor?: Vec3 };
  layout: { outlinerWidth: number; timelineHeight: number; objectPaneHeight: number; transformPanelOpen: boolean; propertiesTab: 'object' | 'world' | 'render' };
  settings: {
    selectMode: SelectMode;
    showOverlays: boolean;
    xRay: boolean;
    proportional: boolean;
    proportionalRadius: number;
    proportionalConnected: boolean;
    // Only missing in files from before there was a choice.
    pivot?: PivotMode;
    keying?: KeyingSet;
    brush: { weight: number; radius: number; strength: number };
  };
};

export const FILE_EXTENSION = '.slender';
const FORMAT = 'slender';
const VERSION = 1;

// JSON has no Set or Map, and silently writes both as {}, so they are tagged on the way out.
function encode(_: string, value: unknown): unknown {
  if (value instanceof Set) {
    return { $set: Array.from(value) };
  }
  if (value instanceof Map) {
    return { $map: Array.from(value) };
  }
  return value;
}

function decode(_: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const tagged = value as { $set?: unknown[]; $map?: [unknown, unknown][] };
    if (tagged.$set) {
      return new Set(tagged.$set);
    }
    if (tagged.$map) {
      return new Map(tagged.$map);
    }
  }
  return value;
}

const upgraded = new WeakMap<EditorDocument, EditorDocument>();

// Fills in what documents from before a field existed lack. The same document always gives the same
// result, so a saved document and its copy in undo history stay recognizably the same.
export function upgradeDocument(document: EditorDocument, duration?: number): EditorDocument {
  if (document.frameRate) {
    return document;
  }
  const result = upgraded.get(document) ?? {
    ...document,
    frameRate: DEFAULT_FRAME_RATE,
    // Older animations started at time zero.
    frameStart: 0,
    frameEnd: duration ? Math.round(duration * DEFAULT_FRAME_RATE) : DEFAULT_FRAME_END,
  };
  upgraded.set(document, result);
  return result;
}

// Where the scene cursor is, for a project saved at any age.
export function savedCursor(view: ProjectState['view'], document: EditorDocument): Vec3 {
  return view.cursor ?? (document as EditorDocument & { cursor?: Vec3 }).cursor ?? { x: 0, y: 0, z: 0 };
}

export function serializeProject(state: ProjectState): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, ...state }, encode, 1);
}

// Reads a project file. Throws an error with a message fit to show if it cannot.
export function parseProject(text: string): ProjectState {
  let parsed: (ProjectState & { format?: unknown; version?: unknown }) | null;
  try {
    parsed = JSON.parse(text, decode);
  } catch {
    throw new Error('That file is not a Slender project.');
  }
  if (!parsed || parsed.format !== FORMAT || typeof parsed.version !== 'number') {
    throw new Error('That file is not a Slender project.');
  }
  if (parsed.version > VERSION) {
    throw new Error(`That file needs a newer Slender: it is version ${parsed.version}, and this reads up to ${VERSION}.`);
  }
  const { document, view, layout, settings } = parsed;
  if (!Array.isArray(document?.objects) || !Array.isArray(document?.folders) || !view?.orbit || !layout || !settings) {
    throw new Error('That Slender project is incomplete or damaged.');
  }
  return { document: upgradeDocument(document, view.duration), view, layout, settings };
}
