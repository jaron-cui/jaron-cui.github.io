// A small key-value store in IndexedDB, for working state that should survive a refresh, such as
// an open project and its file handle (which, unlike JSON, IndexedDB can hold).

export type Store<T> = {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
};

// One object store per database; `name` names the database.
export function keyValueStore<T>(name: string): Store<T> {
  const STORE = 'values';
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async <R>(mode: IDBTransactionMode, action: (objects: IDBObjectStore) => IDBRequest<R>): Promise<R> => {
    const database = await open();
    try {
      return await new Promise<R>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  };
  return {
    get: key => run<T | undefined>('readonly', objects => objects.get(key) as IDBRequest<T | undefined>),
    put: async (key, value) => {
      await run('readwrite', objects => objects.put(value, key));
    },
    delete: async key => {
      await run('readwrite', objects => objects.delete(key));
    },
  };
}
