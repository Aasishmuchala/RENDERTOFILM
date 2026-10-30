/**
 * The Stills page's own render, kept in this browser (IndexedDB) so a reload
 * or an app restart reopens the person's render instead of the sample. Every
 * call is best effort: private windows and blocked storage just skip it.
 */
const DB = 'render-to-film';
const STORE = 'renders';
const KEY = 'stills-source';

export type StoredRender = { blob: Blob; name: string; width: number; height: number };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = act(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    }).finally(() => db.close());
  } catch {
    return undefined;
  }
}

export function saveStoredRender(render: StoredRender): Promise<unknown> {
  return run('readwrite', (s) => s.put(render, KEY));
}

export async function loadStoredRender(): Promise<StoredRender | undefined> {
  const r = await run<StoredRender>('readonly', (s) => s.get(KEY));
  return r && r.blob instanceof Blob && r.width > 0 && r.height > 0 ? r : undefined;
}
