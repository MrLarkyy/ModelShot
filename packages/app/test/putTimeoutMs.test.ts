import { afterEach, describe, expect, it, vi } from 'vitest';
import { putHandoffFiles } from '../src/handoff/fileHandoff';
import { HandoffLimits } from '../src/handoff/HandoffLimits';
import { PUT_MIN_BYTES_PER_SECOND, putTimeoutMs } from '../src/handoff/putTimeoutMs';

afterEach(() => {
  vi.useRealTimers();
});

describe('putTimeoutMs', () => {
  it('is the storage timeout for an empty write and grows with the bytes', () => {
    expect(putTimeoutMs(0)).toBe(HandoffLimits.storageTimeoutMs);
    expect(putTimeoutMs(PUT_MIN_BYTES_PER_SECOND)).toBe(HandoffLimits.storageTimeoutMs + 1000);
  });

  it('gives a write at the limit 21 s, bounded', () => {
    expect(putTimeoutMs(HandoffLimits.maxTotalBytes)).toBe(21_000);
  });

  it('putHandoffFiles waits the scaled time on a stuck write at the limit, then gives up', async () => {
    vi.useFakeTimers();
    const transaction = { objectStore: () => ({ clear: vi.fn(), put: vi.fn() }), abort: vi.fn() };
    const factory = {
      open: () => {
        const request: { result: object; onsuccess?: () => void } = {
          result: { transaction: () => transaction, close: vi.fn() },
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    } as unknown as IDBFactory;
    const size = HandoffLimits.maxTotalBytes / HandoffLimits.maxFiles;
    const files = Array.from({ length: HandoffLimits.maxFiles }, (_, i) => ({ name: `m${i}.glb`, size }) as File);
    let settled = false;
    const put = putHandoffFiles(files, { factory }).finally(() => (settled = true));
    const assertion = expect(put).rejects.toThrow('did not answer within 21000 ms (store)');
    await vi.advanceTimersByTimeAsync(HandoffLimits.storageTimeoutMs);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(21_000 - HandoffLimits.storageTimeoutMs);
    await assertion;
    expect(transaction.abort).toHaveBeenCalledOnce();
  });
});
