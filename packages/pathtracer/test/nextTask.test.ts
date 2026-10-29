import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTask } from '../src/nextTask';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('nextTask', () => {
  it('resolves through a MessageChannel and closes its port', async () => {
    const closed = vi.fn();
    class Channel {
      readonly port1: { onmessage: (() => void) | null; close: () => void } = { onmessage: null, close: closed };
      readonly port2 = { postMessage: () => queueMicrotask(() => this.port1.onmessage?.()) };
    }
    vi.stubGlobal('MessageChannel', Channel);
    await nextTask();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timer without MessageChannel', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('MessageChannel', undefined);
    let done = false;
    void nextTask().then(() => (done = true));
    expect(vi.getTimerCount()).toBe(1);
    await vi.runAllTimersAsync();
    expect(done).toBe(true);
  });
});
