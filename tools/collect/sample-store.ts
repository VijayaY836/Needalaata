// IndexedDB-backed persistence for recorded Samples (Req 15.1, 15.2, 15.3, 15.5, 13.1).
import { LABELS } from './types';
import type { Label, Sample } from './types';

export const DB_NAME = 'needalaata-collect';
export const STORE_NAME = 'samples';
const DB_VERSION = 1;

export const SAVE_FAILED_MESSAGE = 'samples could not be saved';

export interface SampleStore {
  put(sample: Sample): Promise<void>;
  all(): Promise<Sample[]>;
  countsByLabel(): Promise<Record<Label, number>>;
  deleteBurst(burstId: string): Promise<void>;
  undoLastBurst(): Promise<void>;
  clearAll(): Promise<void>;
}

export interface SampleStoreOptions {
  /** Called (non-fatally) when IndexedDB is unavailable or an operation fails. */
  onError?: (message: string, cause?: unknown) => void;
  /** Override for tests; defaults to globalThis.indexedDB. */
  factory?: IDBFactory;
}

function emptyCounts(): Record<Label, number> {
  const counts = {} as Record<Label, number>;
  for (const l of LABELS) counts[l] = 0;
  return counts;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function createSampleStore(options: SampleStoreOptions = {}): SampleStore {
  const report = (cause: unknown): void => {
    try {
      options.onError?.(SAVE_FAILED_MESSAGE, cause);
    } catch {
      /* handler failures must never be fatal */
    }
  };

  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = options.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (!factory) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by_burst', 'burstId', { unique: false });
          store.createIndex('by_label', 'label', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    // Allow retry on a later call if opening failed.
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  };

  /** Run a write; failures are reported, never thrown. */
  const write = async (fn: (store: IDBObjectStore) => Promise<void> | void): Promise<void> => {
    try {
      const db = await open();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = txDone(tx);
      await fn(tx.objectStore(STORE_NAME));
      await done;
    } catch (err) {
      report(err);
    }
  };

  const readAll = async (): Promise<Sample[]> => {
    try {
      const db = await open();
      const tx = db.transaction(STORE_NAME, 'readonly');
      return (await req(tx.objectStore(STORE_NAME).getAll())) as Sample[];
    } catch (err) {
      report(err);
      return [];
    }
  };

  const deleteByBurst = async (store: IDBObjectStore, burstId: string): Promise<void> => {
    const keys = await req(store.index('by_burst').getAllKeys(IDBKeyRange.only(burstId)));
    for (const key of keys) store.delete(key);
  };

  return {
    put: (sample) =>
      write((store) => {
        store.put(sample);
      }),

    all: readAll,

    async countsByLabel() {
      const counts = emptyCounts();
      for (const s of await readAll()) {
        if (s.label in counts) counts[s.label] += 1;
      }
      return counts;
    },

    deleteBurst: (burstId) => write((store) => deleteByBurst(store, burstId)),

    undoLastBurst: () =>
      write(async (store) => {
        const samples = (await req(store.getAll())) as Sample[];
        let latest: Sample | undefined;
        for (const s of samples) if (!latest || s.timestamp > latest.timestamp) latest = s;
        if (!latest) return;
        await deleteByBurst(store, latest.burstId);
      }),

    clearAll: () =>
      write((store) => {
        store.clear();
      }),
  };
}
