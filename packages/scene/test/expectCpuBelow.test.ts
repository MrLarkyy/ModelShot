import { describe, expect, it } from 'vitest';
import { expectCpuBelow } from './expectCpuBelow';

describe('expectCpuBelow', () => {
  it('does not count time spent blocked', () => {
    const cell = new Int32Array(new SharedArrayBuffer(4));
    expectCpuBelow(50, () => Atomics.wait(cell, 0, 0, 300));
  });

  it('counts CPU work and returns its value', () => {
    expect(() =>
      expectCpuBelow(5, () => {
        const end = process.threadCpuUsage();
        let sink = 0;
        while (process.threadCpuUsage().user - end.user < 200_000) sink++;
        return sink;
      }),
    ).toThrow(/CPU \d+ ms/);
    expect(expectCpuBelow(5000, () => 42)).toBe(42);
  });

  it('refuses asynchronous work', () => {
    expect(() => expectCpuBelow(1000, () => Promise.resolve(1))).toThrow(/synchronous/);
  });
});
