import { expect } from 'vitest';

/**
 * Runs `work` synchronously and asserts the CPU time of the current thread stays below `maxMs`, then returns its value.
 *
 * Wall time is never read: time the OS does not run the thread (machine load, a blocked wait) is not counted, so the
 * bound holds on a busy machine. The CPU clock ticks in coarse steps (about 15.6 ms on Windows), so keep bounds well
 * above that. Asynchronous work is refused: another task could run on the thread between its awaits.
 */
export function expectCpuBelow<T>(maxMs: number, work: () => T): T {
  if (typeof process.threadCpuUsage !== 'function') {
    throw new Error('expectCpuBelow needs process.threadCpuUsage (Node >= 22.19)');
  }
  const before = process.threadCpuUsage();
  const value = work();
  const after = process.threadCpuUsage();
  if (typeof (value as { then?: unknown } | null)?.then === 'function') {
    throw new TypeError('expectCpuBelow measures synchronous work only; the callback returned a thenable');
  }
  const ms = (after.user - before.user + (after.system - before.system)) / 1000;
  expect(ms, `CPU ${ms.toFixed(0)} ms`).toBeLessThan(maxMs);
  return value;
}
