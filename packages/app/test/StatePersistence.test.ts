import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MAX_STORED_MODELS } from '../src/state/AppState';
import type { AppStateStore } from '../src/state/appStateDb';
import { keysToEvict } from '../src/state/keysToEvict';
import { StatePersistence } from '../src/state/StatePersistence';

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

type Backing = { [K in keyof AppStateStore]: Mock<AppStateStore[K]> };

function store(overrides: Partial<Backing> = {}): Backing {
  return {
    loadSession: vi.fn(() => Promise.resolve(null)),
    saveSession: vi.fn(() => Promise.resolve()),
    loadModel: vi.fn(() => Promise.resolve(null)),
    saveModel: vi.fn(() => Promise.resolve()),
    forget: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe('keysToEvict', () => {
  it('keeps the newest entries and drops the oldest', () => {
    const entries = Array.from({ length: MAX_STORED_MODELS + 1 }, (_, i) => ({ key: `k${i}`, savedAt: 100 - i }));
    expect(keysToEvict(entries, MAX_STORED_MODELS)).toEqual([`k${MAX_STORED_MODELS}`]);
  });

  it('drops nothing at or under the cap', () => {
    const entries = Array.from({ length: MAX_STORED_MODELS }, (_, i) => ({ key: `k${i}`, savedAt: i }));
    expect(keysToEvict(entries, MAX_STORED_MODELS)).toEqual([]);
    expect(keysToEvict([], 3)).toEqual([]);
  });

  it('breaks a tie by key, so the choice is the same every time', () => {
    const entries = [
      { key: 'b', savedAt: 1 },
      { key: 'a', savedAt: 1 },
      { key: 'c', savedAt: 2 },
    ];
    expect(keysToEvict(entries, 2)).toEqual(['a']);
  });
});

describe('StatePersistence', () => {
  it('writes once after the changes stop', async () => {
    vi.useFakeTimers();
    const backing = store();
    const persistence = new StatePersistence(backing, vi.fn(), 500);
    persistence.scheduleModel('k', () => SNAPSHOT);
    await vi.advanceTimersByTimeAsync(300);
    persistence.scheduleModel('k', () => SNAPSHOT);
    await vi.advanceTimersByTimeAsync(300);
    expect(backing.saveModel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(backing.saveModel).toHaveBeenCalledTimes(1);
  });

  it('tells the user once and carries on when the quota is full', async () => {
    const quota = new Error('the storage quota is full');
    const backing = store({
      saveModel: vi.fn(() => Promise.reject(quota)),
      saveSession: vi.fn(() => Promise.reject(quota)),
    });
    const notify = vi.fn();
    const persistence = new StatePersistence(backing, notify, 0);
    persistence.scheduleModel('k', () => SNAPSHOT);
    await persistence.flush();
    await persistence.saveSession([], 'k');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toContain('quota');
    expect(notify.mock.calls[0]?.[0]).toContain('keeps working');
  });

  it('forget deletes the database and stops saving until resumed', async () => {
    const backing = store();
    const persistence = new StatePersistence(backing, vi.fn(), 0);
    persistence.scheduleModel('k', () => SNAPSHOT);
    await persistence.forget();
    expect(backing.forget).toHaveBeenCalledOnce();
    await persistence.flush();
    persistence.scheduleModel('k', () => SNAPSHOT);
    await persistence.flush();
    expect(backing.saveModel).not.toHaveBeenCalled();
    persistence.resume();
    persistence.scheduleModel('k', () => SNAPSHOT);
    await persistence.flush();
    expect(backing.saveModel).toHaveBeenCalledOnce();
  });

  it('keeps saving when forgetting failed, and reports it', async () => {
    const backing = store({ forget: vi.fn(() => Promise.reject(new Error('blocked'))) });
    const notify = vi.fn();
    const persistence = new StatePersistence(backing, notify, 0);
    await expect(persistence.forget()).rejects.toThrow('blocked');
    persistence.scheduleModel('k', () => SNAPSHOT);
    await persistence.flush();
    expect(backing.saveModel).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
  });
});
