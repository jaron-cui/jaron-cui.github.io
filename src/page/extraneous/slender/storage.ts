import * as psave from '../../../lib/psave/files';
import type { FileHandle } from '../../../lib/psave/files';
import { EditorDocument } from './document';
import { History } from './history';
import { FILE_EXTENSION, ProjectState } from './projectFile';

export type { FileHandle };
export { canWriteFiles, downloadFile, readHandle, writeHandle } from '../../../lib/psave/files';

export type ProjectFile = { name: string; handle: FileHandle | null };

// A tab's working state, which outlives a refresh. savedDocument is whichever snapshot matches the
// file on disk. Because a record is cloned as one value, it stays the same object as its copy in
// history, so comparing them still says whether there are unsaved changes.
export type SessionRecord = {
  tabId: string;
  savedAt: number;
  // Nothing worth recovering: a new scene, untouched.
  pristine: boolean;
  state: Omit<ProjectState, 'document'>;
  history: History<EditorDocument>;
  file: ProjectFile | null;
  savedDocument: EditorDocument;
};

export type RecentFile = { name: string; handle: FileHandle; openedAt: number };

const DATABASE = 'slender';
const SESSIONS = 'sessions';
const RECENT = 'recent';
const TAB_KEY = 'slender-tab';
const LOCK_PREFIX = 'slender-tab-';
const LOCK_ATTEMPTS = 4;
const LOCK_RETRY_MS = 100;
const MAX_RECENT = 10;
const MAX_ABANDONED_SESSIONS = 3;
const MAX_ABANDONED_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const FILE_TYPE: psave.FileType = { description: 'Slender project', extension: FILE_EXTENSION };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SESSIONS, { keyPath: 'tabId' });
      request.result.createObjectStore(RECENT, { autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore<T>(store: string, mode: IDBTransactionMode, action: (objects: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function holdLock(name: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    navigator.locks.request(name, { ifAvailable: true }, lock => {
      resolve(lock !== null);
      // Held until the page goes away, which is how other tabs can tell this one is alive.
      return lock ? new Promise<void>(() => undefined) : undefined;
    }).catch(reject);
  });
}

async function claimTab(): Promise<string> {
  const existing = sessionStorage.getItem(TAB_KEY);
  if (existing) {
    // A refreshing page may take a moment to let go. If the lock stays held, this tab is a
    // duplicate of a living one, which copied its id, and needs its own.
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      if (await holdLock(LOCK_PREFIX + existing)) {
        return existing;
      }
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(TAB_KEY, id);
  await holdLock(LOCK_PREFIX + id);
  return id;
}

let tabClaim: Promise<string> | null = null;

// This tab's id, which lasts through a refresh and ends when the tab closes.
export function currentTabId(): Promise<string> {
  tabClaim = tabClaim ?? claimTab();
  return tabClaim;
}

export function loadSession(tabId: string): Promise<SessionRecord | undefined> {
  return inStore<SessionRecord | undefined>(SESSIONS, 'readonly', objects => objects.get(tabId));
}

export function writeSession(record: SessionRecord): Promise<IDBValidKey> {
  return inStore(SESSIONS, 'readwrite', objects => objects.put(record));
}

export function deleteSession(tabId: string): Promise<undefined> {
  return inStore(SESSIONS, 'readwrite', objects => objects.delete(tabId));
}

// Sessions whose tabs have closed or crashed, newest first.
async function abandonedSessions(): Promise<SessionRecord[]> {
  const all = await inStore<SessionRecord[]>(SESSIONS, 'readonly', objects => objects.getAll());
  const { held } = await navigator.locks.query();
  const alive = new Set((held ?? []).map(lock => lock.name));
  return all.filter(record => !alive.has(LOCK_PREFIX + record.tabId)).sort((a, b) => b.savedAt - a.savedAt);
}

export async function latestAbandonedSession(): Promise<SessionRecord | null> {
  return (await abandonedSessions()).find(record => !record.pristine) ?? null;
}

// Keeps the browser's storage from filling with sessions nobody will come back to.
export async function pruneSessions(now: number): Promise<void> {
  const worthKeeping = (await abandonedSessions()).filter(record => !record.pristine);
  const keep = new Set(worthKeeping.slice(0, MAX_ABANDONED_SESSIONS).filter(record => now - record.savedAt < MAX_ABANDONED_AGE_MS).map(record => record.tabId));
  await Promise.all((await abandonedSessions()).filter(record => !keep.has(record.tabId)).map(record => deleteSession(record.tabId)));
}

export async function recentFiles(): Promise<RecentFile[]> {
  const all = await inStore<RecentFile[]>(RECENT, 'readonly', objects => objects.getAll());
  return all.sort((a, b) => b.openedAt - a.openedAt);
}

async function replaceRecent(files: RecentFile[]): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RECENT, 'readwrite');
      const objects = transaction.objectStore(RECENT);
      objects.clear();
      files.forEach(file => objects.add(file));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function rememberRecent(handle: FileHandle, now: number): Promise<void> {
  const others: RecentFile[] = [];
  for (const file of await recentFiles()) {
    if (!(await file.handle.isSameEntry(handle))) {
      others.push(file);
    }
  }
  await replaceRecent([{ name: handle.name, handle, openedAt: now }, ...others].slice(0, MAX_RECENT));
}

export async function forgetRecent(handle: FileHandle): Promise<void> {
  const kept: RecentFile[] = [];
  for (const file of await recentFiles()) {
    if (!(await file.handle.isSameEntry(handle))) {
      kept.push(file);
    }
  }
  await replaceRecent(kept);
}

// Asks the user to choose a file to open, or returns null if they decline.
export function pickFileToOpen(): Promise<psave.OpenedFile | null> {
  return psave.pickFileToOpen(FILE_TYPE);
}

export function pickFileToSave(suggestedName: string): Promise<FileHandle | null> {
  return psave.pickFileToSave(FILE_TYPE, suggestedName);
}
