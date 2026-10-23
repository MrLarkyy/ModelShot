import { findHandoffViolation } from '../handoff/findHandoffViolation';
import {
  APP_DB,
  APP_STATE_VERSION,
  MAX_STORED_MODELS,
  MODELS_STORE,
  SESSION_STORE,
  type ModelState,
  type SessionState,
} from './AppState';
import { keysToEvict } from './keysToEvict';
import { readModelState, readSession } from './readAppState';

const SESSION_KEY = 'current';
const TIMEOUT_MS = 5000;

export interface AppStateStore {
  loadSession(): Promise<SessionState | null>;
  saveSession(files: readonly File[], modelKey: string): Promise<void>;
  loadModel(key: string): Promise<ModelState | null>;
  saveModel(key: string, state: Omit<ModelState, 'v' | 'savedAt'>): Promise<void>;
  /** Deletes the whole database: the session files and every remembered view. */
  forget(): Promise<void>;
}

export interface AppStateStoreOptions {
  readonly factory?: IDBFactory | undefined;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

function storageError(detail: string): Error {
  return new Error(`The browser could not keep the local state: ${detail}.`);
}

function describe(error: unknown): string {
  if (error instanceof DOMException)
    return error.name === 'QuotaExceededError' ? 'the storage quota is full' : error.name;
  return error instanceof Error ? error.message : 'unknown error';
}

// Settles on the first of the IndexedDB callback or the timeout: a hung database never hangs the page.
function settle<T>(
  timeoutMs: number,
  step: string,
  start: (done: (value: T) => void, fail: (why: string) => void) => void,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(storageError(`IndexedDB did not answer within ${timeoutMs} ms (${step})`));
      onTimeout?.();
    }, timeoutMs);
    start(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (why) => {
        clearTimeout(timer);
        reject(storageError(why));
      },
    );
  });
}

export function createAppStateStore(options: AppStateStoreOptions = {}): AppStateStore {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const factory = (): IDBFactory => {
    const found = 'factory' in options ? options.factory : globalThis.indexedDB;
    if (!found) throw storageError('IndexedDB is not available');
    return found;
  };

  async function transact<T>(
    stores: string[],
    mode: IDBTransactionMode,
    step: string,
    run: (tx: IDBTransaction) => () => T,
  ): Promise<T> {
    let timedOut = false;
    const db = await settle<IDBDatabase>(timeoutMs, 'open', (done, fail) => {
      const request = factory().open(APP_DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(SESSION_STORE);
        request.result.createObjectStore(MODELS_STORE);
      };
      request.onsuccess = () => (timedOut ? request.result.close() : done(request.result));
      request.onerror = () => fail(describe(request.error));
    }).catch((error: unknown) => {
      timedOut = true;
      throw error;
    });
    try {
      const tx = db.transaction(stores, mode);
      const result = run(tx);
      await settle<void>(
        timeoutMs,
        step,
        (done, fail) => {
          tx.oncomplete = () => done();
          tx.onerror = tx.onabort = () => fail(describe(tx.error));
        },
        () => {
          try {
            tx.abort();
          } catch {
            // already finished
          }
        },
      );
      return result();
    } finally {
      db.close();
    }
  }

  return {
    async loadSession() {
      return transact([SESSION_STORE], 'readonly', 'load session', (tx) => {
        const request = tx.objectStore(SESSION_STORE).get(SESSION_KEY);
        return () => readSession(request.result);
      });
    },

    async saveSession(files, modelKey) {
      const violation = findHandoffViolation(files);
      if (violation) throw storageError(`the files are over the limit (${violation.code})`);
      const record: SessionState = { v: APP_STATE_VERSION, files: [...files], modelKey, savedAt: now() };
      await transact([SESSION_STORE], 'readwrite', 'save session', (tx) => {
        tx.objectStore(SESSION_STORE).put(record, SESSION_KEY);
        return () => undefined;
      });
    },

    async loadModel(key) {
      return transact([MODELS_STORE], 'readonly', 'load model', (tx) => {
        const request = tx.objectStore(MODELS_STORE).get(key);
        return () => readModelState(request.result);
      });
    },

    async saveModel(key, state) {
      const record: ModelState = { ...state, v: APP_STATE_VERSION, savedAt: now() };
      await transact([MODELS_STORE], 'readwrite', 'save model', (tx) => {
        const store = tx.objectStore(MODELS_STORE);
        store.put(record, key);
        // Dropping the oldest entries beyond the cap happens in the same transaction as the write.
        const entries: { key: string; savedAt: number }[] = [];
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (at) {
            const savedAt = (at.value as { savedAt?: unknown } | null)?.savedAt;
            entries.push({
              key: typeof at.key === 'string' ? at.key : '',
              savedAt: typeof savedAt === 'number' ? savedAt : 0,
            });
            at.continue();
            return;
          }
          for (const stale of keysToEvict(entries, MAX_STORED_MODELS)) store.delete(stale);
        };
        return () => undefined;
      });
    },

    async forget() {
      await settle<void>(timeoutMs, 'delete', (done, fail) => {
        const request = factory().deleteDatabase(APP_DB);
        request.onsuccess = () => done();
        request.onerror = () => fail(describe(request.error));
        // Blocked by an open connection of another tab: it finishes when that tab closes it.
      });
    },
  };
}
