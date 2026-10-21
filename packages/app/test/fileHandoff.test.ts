import { afterEach, describe, expect, it, vi } from 'vitest';
import { discardStaleHandoff, putHandoffFiles, takeHandoffFiles } from '../src/handoff/fileHandoff';
import { HandoffLimits } from '../src/handoff/HandoffLimits';

// A minimal IndexedDB stand-in: the real database path runs in the browser (packages/site/e2e/landing.handoff.spec.ts).
interface FakeRequest {
  result?: unknown;
  error?: Error | null;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
}

function hangingFactory(): { factory: IDBFactory; request: FakeRequest } {
  const request: FakeRequest = {};
  return { factory: { open: () => request } as unknown as IDBFactory, request };
}

function openingFactory(transaction: object): { factory: IDBFactory; close: () => void } {
  const close = vi.fn();
  const db = { transaction: () => transaction, close };
  const factory = {
    open: () => {
      const request: FakeRequest = { result: db };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, close };
}

// A transaction that completes once its handlers are attached (after any queued request callbacks).
function completingTransaction(store: object): object {
  const transaction = { objectStore: () => store, abort: vi.fn() };
  Object.defineProperty(transaction, 'oncomplete', {
    set(handler: () => void) {
      queueMicrotask(handler);
    },
  });
  return transaction;
}

function storeWith(result: unknown): { get: () => FakeRequest; delete: ReturnType<typeof vi.fn> } {
  return {
    get: () => {
      const request: FakeRequest = { result };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    delete: vi.fn(),
  };
}

const NOW = 1_800_000_000_000;

afterEach(() => {
  vi.useRealTimers();
});

describe('file handoff storage', () => {
  it('fails with a clear error when IndexedDB is missing', async () => {
    await expect(takeHandoffFiles({ factory: undefined })).rejects.toThrow(/IndexedDB is not available/);
  });

  it('gives up on a database that never opens after 5 s', async () => {
    vi.useFakeTimers();
    const { factory } = hangingFactory();
    const taken = takeHandoffFiles({ factory });
    const assertion = expect(taken).rejects.toThrow(
      `did not answer within ${HandoffLimits.storageTimeoutMs} ms (open)`,
    );
    await vi.advanceTimersByTimeAsync(HandoffLimits.storageTimeoutMs);
    await assertion;
  });

  it('closes a database that opens after the timeout', async () => {
    const { factory, request } = hangingFactory();
    await expect(takeHandoffFiles({ factory, timeoutMs: 5 })).rejects.toThrow(/open/);
    const close = vi.fn();
    request.result = { close };
    request.onsuccess?.();
    expect(close).toHaveBeenCalledOnce();
  });

  it('gives up on a transaction that never completes and closes the database', async () => {
    const store = { get: () => ({}), delete: vi.fn(), put: vi.fn() };
    const { factory, close } = openingFactory({ objectStore: () => store });
    await expect(takeHandoffFiles({ factory, timeoutMs: 5 })).rejects.toThrow(/within 5 ms \(take\)/);
    expect(store.delete).toHaveBeenCalledWith('current');
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports a failed open with the browser reason', async () => {
    const request: FakeRequest = { error: new Error('QuotaExceededError') };
    const factory = {
      open: () => {
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    } as unknown as IDBFactory;
    await expect(takeHandoffFiles({ factory })).rejects.toThrow(/QuotaExceededError/);
  });

  it('refuses a selection over the limits before touching storage', async () => {
    const open = vi.fn();
    const factory = { open } as unknown as IDBFactory;
    await expect(putHandoffFiles([new File(['x'], 'tool.exe')], { factory })).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('aborts a write that times out, so the files are not stored after the page gave up', async () => {
    const store = { clear: vi.fn(), put: vi.fn() };
    const transaction = { objectStore: () => store, abort: vi.fn() };
    const { factory, close } = openingFactory(transaction);
    await expect(putHandoffFiles([new File(['{}'], 'a.bbmodel')], { factory, timeoutMs: 5 })).rejects.toThrow(
      /within 5 ms \(store\)/,
    );
    expect(transaction.abort).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('empties the store before writing the new record', async () => {
    const store = { clear: vi.fn(), put: vi.fn() };
    const { factory } = openingFactory(completingTransaction(store));
    const files = [new File(['{}'], 'a.bbmodel')];
    await putHandoffFiles(files, { factory, now: () => NOW });
    expect(store.clear.mock.invocationCallOrder[0]).toBeLessThan(store.put.mock.invocationCallOrder[0]!);
    expect(store.put).toHaveBeenCalledWith({ v: 1, files, createdAt: NOW }, 'current');
  });

  it.each<[string, unknown, boolean]>([
    ['an expired record', { v: 1, files: [new File(['{}'], 'a.obj')], createdAt: NOW - 11 * 60_000 }, true],
    ['an unreadable record', { v: 2 }, true],
    ['a fresh record', { v: 1, files: [new File(['{}'], 'a.obj')], createdAt: NOW - 1000 }, false],
    ['no record', undefined, false],
  ])('discardStaleHandoff deletes %s: %s', async (_name, record, deleted) => {
    const store = storeWith(record);
    const { factory } = openingFactory(completingTransaction(store));
    await discardStaleHandoff({ factory, now: () => NOW });
    expect(store.delete).toHaveBeenCalledTimes(deleted ? 1 : 0);
  });
});
