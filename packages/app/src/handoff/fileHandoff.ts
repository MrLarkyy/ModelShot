import { checkHandoffFiles } from './checkHandoffFiles';
import { HandoffLimits } from './HandoffLimits';
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
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(storageError(`IndexedDB did not answer within ${timeoutMs} ms (${step})`)),
      timeoutMs,
    );
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
    request.onerror = () => fail(request.error?.message ?? 'open failed');
  }).catch((error: unknown) => {
    timedOut = true;
    throw error;
  });
  try {
    const transaction = db.transaction(HANDOFF_STORE, 'readwrite');
    const result = run(transaction.objectStore(HANDOFF_STORE));
    await settle<void>(timeoutMs, step, (done, fail) => {
      transaction.oncomplete = () => done();
      transaction.onerror = transaction.onabort = () => fail(transaction.error?.message ?? 'transaction failed');
    });
    return result();
  } finally {
    db.close();
  }
}

// Stores the user's chosen files for the app tab that the landing page opens next; replaces any earlier record.
export async function putHandoffFiles(files: readonly File[], options: HandoffStorageOptions = {}): Promise<void> {
  const error = checkHandoffFiles(files);
  if (error) throw error;
  const now = options.now ?? Date.now;
  await inTransaction(options, 'store', (store) => {
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
