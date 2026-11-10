import { describe, expect, it, vi } from 'vitest';
import { HINTS_KEY, HintStore } from '../src/state/HintStore';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const refusing = {
  getItem: (): never => {
    throw new Error('blocked');
  },
  setItem: (): never => {
    throw new Error('full');
  },
  removeItem: (): never => {
    throw new Error('blocked');
  },
};

describe('HintStore', () => {
  it('starts not dismissed, remembers a dismissal and forgets it on reset', () => {
    const storage = new MemoryStorage();
    const store = new HintStore(storage);
    expect(store.dismissed).toBe(false);
    store.dismiss();
    expect(new HintStore(storage).dismissed).toBe(true);
    expect(storage.items.has(HINTS_KEY)).toBe(true);
    store.reset();
    expect(new HintStore(storage).dismissed).toBe(false);
  });

  it('never throws on a blocked storage, tells once and keeps the dismissal for the session', () => {
    const notify = vi.fn();
    const store = new HintStore(refusing, notify);
    expect(store.dismissed).toBe(false);
    store.dismiss();
    store.reset();
    expect(notify).toHaveBeenCalledTimes(1);
    store.dismiss();
    expect(store.dismissed).toBe(true);
  });

  it('works without a storage', () => {
    const store = new HintStore(null);
    expect(store.dismissed).toBe(false);
    store.dismiss();
    expect(store.dismissed).toBe(true);
  });
});
