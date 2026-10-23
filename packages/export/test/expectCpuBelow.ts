import { expect } from 'vitest';

// The one Node API the export tests read; the package has no Node types.
declare const process: { threadCpuUsage?: () => { user: number; system: number } };

/**
 * Runs `work` synchronously and asserts the CPU time of the current thread stays below `maxMs`, then returns its value
 * (the scene and formats tests' helper): time the OS does not run the thread is not counted, so the bound holds on a
 * busy machine. Asynchronous work is refused.
 */
export function expectCpuBelow<T>(maxMs: number, work: () => T): T {
  const clock = process.threadCpuUsage;
  if (typeof clock !== 'function') throw new Error('expectCpuBelow needs process.threadCpuUsage (Node >= 22.19)');
  const before = clock();
  const value = work();
  const after = clock();
  if (typeof (value as { then?: unknown } | null)?.then === 'function') {
    throw new TypeError('expectCpuBelow measures synchronous work only; the callback returned a thenable');
  }
  const ms = (after.user - before.user + (after.system - before.system)) / 1000;
  console.log(`[export] CPU ${ms.toFixed(0)} ms (bound ${maxMs})`);
  expect(ms, `CPU ${ms.toFixed(0)} ms`).toBeLessThan(maxMs);
  return value;
}
