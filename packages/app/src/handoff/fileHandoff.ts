import { checkHandoffFiles } from './checkHandoffFiles';
import { HandoffLimits } from './HandoffLimits';
import { putTimeoutMs } from './putTimeoutMs';
import { HANDOFF_RECORD_VERSION, readHandoffRecord, type HandoffRead } from './readHandoffRecord';

// The landing page (/) and the app (/app/) share an origin and so this database; nothing leaves the browser.
export const HANDOFF_DB = 'modelshot-handoff';
export const HANDOFF_STORE = 'pending';
const KEY = 'current';

export interface HandoffStorageOptions {
  readonly factory?: IDBFactory | undefined;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

// A plain Error: the pages only show its message, and the class would cost the app budget.
function storageError(detail: string): Error {
  return new Error(`The browser could not pass the files on: ${detail}.`);
}

// Settles on the first of: the IndexedDB callback, or the timeout. A hung database never hangs the page.
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

async function inTransaction<T>(
  options: HandoffStorageOptions,
  step: string,
  run: (store: IDBObjectStore) => () => T,
): Promise<T> {
  const factory = 'factory' in options ? options.factory : globalThis.indexedDB;
  if (!factory) throw storageError('IndexedDB is not available');
  const timeoutMs = options.timeoutMs ?? HandoffLimits.storageTimeoutMs;
  let timedOut = false;
  const db = await settle<IDBDatabase>(timeoutMs, 'open', (done, fail) => {
    const request = factory.open(HANDOFF_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDOFF_STORE);
    request.onsuccess = () => (timedOut ? request.result.close() : done(request.result));
    request.onerror = () => fail(String(request.error));
  }).catch((error: unknown) => {
    timedOut = true;
    throw error;
  });
  try {
    const transaction = db.transaction(HANDOFF_STORE, 'readwrite');
    const result = run(transaction.objectStore(HANDOFF_STORE));
    // A transaction that times out is aborted, so a late write cannot leave the files behind after the page gave up.
    await settle<void>(
      timeoutMs,
      step,
      (done, fail) => {
        transaction.oncomplete = () => done();
        transaction.onerror = transaction.onabort = () => fail(String(transaction.error));
      },
      () => {
        try {
          transaction.abort();
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

// Stores the user's chosen files for the app tab that the landing page opens next; anything left in the store
// before (an earlier record, a stray key) is removed in the same transaction. The timeout grows with the bytes
// (putTimeoutMs).
export async function putHandoffFiles(files: readonly File[], options: HandoffStorageOptions = {}): Promise<void> {
  const error = checkHandoffFiles(files);
  if (error) throw error;
  const now = options.now ?? Date.now;
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const timeoutMs = options.timeoutMs ?? putTimeoutMs(bytes);
  await inTransaction({ ...options, timeoutMs }, 'store', (store) => {
    store.clear();
    store.put({ v: HANDOFF_RECORD_VERSION, files: [...files], createdAt: now() }, KEY);
    return () => undefined;
  });
}

// Reads and deletes the record in one transaction, so the files stay on disk no longer than it takes to open them.
export async function takeHandoffFiles(options: HandoffStorageOptions = {}): Promise<HandoffRead> {
  const now = options.now ?? Date.now;
  const value = await inTransaction(options, 'take', (store) => {
    const request = store.get(KEY);
    store.delete(KEY);
    return (): unknown => request.result;
  });
  return readHandoffRecord(value, now());
}

// The landing page calls this on load: a record the app can no longer take (expired or unreadable) is deleted, so
// files the app never opened do not stay on disk. A fresh record, perhaps on its way to an app tab, is kept.
export async function discardStaleHandoff(options: HandoffStorageOptions = {}): Promise<void> {
  const now = options.now ?? Date.now;
  await inTransaction(options, 'discard', (store) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      const kind = readHandoffRecord(request.result, now()).kind;
      if (kind === 'expired' || kind === 'invalid') store.delete(KEY);
    };
    return () => undefined;
  });
}
