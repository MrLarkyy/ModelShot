import { afterEach, describe, expect, it, vi } from 'vitest';
import { putHandoffFiles, takeHandoffFiles } from '../src/handoff/fileHandoff';
import { HandoffLimits } from '../src/handoff/HandoffLimits';

// A minimal IndexedDB stand-in: the real database path runs in the browser (packages/site/e2e/landing.handoff.spec.ts).
interface FakeRequest {
  result?: unknown;
  error?: { message: string } | null;
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
    const request: FakeRequest = { error: { message: 'QuotaExceededError' } };
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
});
