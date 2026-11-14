// GraphEd's project files and working session, on top of the shared project-saving library.
import { pickFileToOpen as pick, saveText } from '../../../lib/psave/files';
import type { FileHandle, FileType } from '../../../lib/psave/files';
import { keyValueStore } from '../../../lib/psave/store';

export type { FileHandle };

export const FILE_EXTENSION = '.graphed';
const FILE_TYPE: FileType = { description: 'GraphEd project', extension: FILE_EXTENSION };

export const pickFileToOpen = () => pick(FILE_TYPE);

export const saveFile = (text: string, suggestedName: string, handle: FileHandle | null) => saveText(FILE_TYPE, text, suggestedName, handle);

// The working session: the document and which file it came from, kept across refreshes.
export type Session = { text: string; fileName: string | null; handle: FileHandle | null; savedText: string | null };

const sessions = keyValueStore<Session>('graphed-session');

export async function loadSession(): Promise<Session | null> {
  try {
    return (await sessions.get('current')) ?? null;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  try {
    await sessions.put('current', session);
  } catch {
    // A session that cannot be kept only costs recovery after a refresh.
  }
}
