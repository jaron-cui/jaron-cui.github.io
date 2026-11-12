// Opening and saving project files on the user's device. Where the browser has the File System
// Access API, files are opened and saved through its pickers and a handle is kept so later saves
// write back to the same file. Elsewhere, a file input opens and a download saves.

// The parts of the File System Access API used here, which TypeScript's DOM types do not include.
export type FileHandle = {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  isSameEntry: (other: FileHandle) => Promise<boolean>;
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

// A kind of project file, as the pickers describe it, e.g. { description: 'Slender project', extension: '.slender' }.
export type FileType = { description: string; extension: string };

export type OpenedFile = { name: string; text: string; handle: FileHandle | null };

type PickerOptions = { suggestedName?: string; types: { description: string; accept: Record<string, string[]> }[] };
type PickerWindow = {
  showOpenFilePicker?: (options: PickerOptions) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: PickerOptions) => Promise<FileHandle>;
};

function pickerWindow(): PickerWindow {
  return window as unknown as PickerWindow;
}

function pickerTypes({ description, extension }: FileType): PickerOptions['types'] {
  return [{ description, accept: { 'application/json': [extension] } }];
}

// The user dismissing a picker is not a failure.
export function isCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function canWriteFiles(): boolean {
  return Boolean(pickerWindow().showSaveFilePicker);
}

// Asks the user to choose a file to open, or returns null if they decline.
export async function pickFileToOpen(type: FileType): Promise<OpenedFile | null> {
  const { showOpenFilePicker } = pickerWindow();
  if (showOpenFilePicker) {
    try {
      const [handle] = await showOpenFilePicker.call(window, { types: pickerTypes(type) });
      return await readHandle(handle);
    } catch (error) {
      if (isCancel(error)) {
        return null;
      }
      throw error;
    }
  }
  // Browsers without the picker can still read a chosen file, but cannot write back to it.
  return new Promise(resolve => {
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = type.extension;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, text: await file.text(), handle: null } : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

// Asks the user where to save, or returns null if they decline. Only call when canWriteFiles().
export async function pickFileToSave(type: FileType, suggestedName: string): Promise<FileHandle | null> {
  try {
    return await pickerWindow().showSaveFilePicker!.call(window, { suggestedName, types: pickerTypes(type) });
  } catch (error) {
    if (isCancel(error)) {
      return null;
    }
    throw error;
  }
}

export async function ensurePermission(handle: FileHandle): Promise<void> {
  if (!handle.queryPermission || (await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
    return;
  }
  if (handle.requestPermission && (await handle.requestPermission({ mode: 'readwrite' })) === 'granted') {
    return;
  }
  throw new Error(`Permission to use ${handle.name} was not given.`);
}

export async function readHandle(handle: FileHandle): Promise<OpenedFile & { handle: FileHandle }> {
  await ensurePermission(handle);
  const file = await handle.getFile();
  return { name: handle.name, text: await file.text(), handle };
}

export async function writeHandle(handle: FileHandle, text: string): Promise<void> {
  await ensurePermission(handle);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export function downloadFile(name: string, content: string | Blob, type = 'application/json') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export type SaveResult = { name: string; handle: FileHandle | null; downloaded: boolean } | null;

// Saves text the way a Save command should: to the open file if there is one, otherwise to a file
// the user picks, or as a download where the browser cannot write files. Null if the user declines.
export async function saveText(type: FileType, text: string, suggestedName: string, handle: FileHandle | null): Promise<SaveResult> {
  if (!handle && canWriteFiles()) {
    handle = await pickFileToSave(type, suggestedName);
    if (!handle) {
      return null;
    }
  }
  if (handle) {
    await writeHandle(handle, text);
    return { name: handle.name, handle, downloaded: false };
  }
  downloadFile(suggestedName, text);
  return { name: suggestedName, handle: null, downloaded: true };
}
