import { describe, expect, it, vi } from 'vitest';
import { createAppStateStore } from '../src/state/appStateDb';

// A minimal IndexedDB stand-in: the real database path runs in the browser (e2e/app.persist.spec.ts).
interface FakeRequest {
  result?: unknown;
  error?: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
}

const SNAPSHOT = {
  camera: {
    yawDeg: 0,
    pitchDeg: 0,
    fovYDeg: 35,
    projection: 'perspective',
    distance: 1,
    orthoHeight: 1,
    target: [0, 0, 0],
  },
  look: 'studio',
  hiddenNodes: [],
  hiddenMeshes: [],
  render: { samples: 1, supersample: 1, denoise: false },
} as never;

function factoryWith(transaction: object): { factory: IDBFactory; close: () => void } {
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

describe('createAppStateStore', () => {
  it('turns a full quota into an error that says so, and closes the database', async () => {
    const quota = new DOMException('full', 'QuotaExceededError');
    const store = { put: vi.fn(), openCursor: vi.fn(() => ({})) };
    const transaction: Record<string, unknown> = { objectStore: () => store, error: quota, abort: vi.fn() };
    Object.defineProperty(transaction, 'onerror', {
      set(handler: () => void) {
        queueMicrotask(handler);
      },
    });
    Object.defineProperty(transaction, 'oncomplete', { set() {} });
    Object.defineProperty(transaction, 'onabort', { set() {} });
    const { factory, close } = factoryWith(transaction);
    const backing = createAppStateStore({ factory });
    await expect(backing.saveModel('k', SNAPSHOT)).rejects.toThrow('the storage quota is full');
    expect(close).toHaveBeenCalled();
  });

  it('gives up on a database that never answers', async () => {
    const hanging = { open: () => ({}) } as unknown as IDBFactory;
    const backing = createAppStateStore({ factory: hanging, timeoutMs: 20 });
    await expect(backing.loadSession()).rejects.toThrow('did not answer within 20 ms (open)');
  });

  it('reports a browser without IndexedDB', async () => {
    const backing = createAppStateStore({ factory: undefined });
    await expect(backing.loadSession()).rejects.toThrow('IndexedDB is not available');
  });

  it('refuses to store files over the handoff limits', async () => {
    const backing = createAppStateStore({ factory: {} as IDBFactory });
    await expect(backing.saveSession([new File(['x'], 'run.exe')], 'k')).rejects.toThrow('over the limit');
  });
});
