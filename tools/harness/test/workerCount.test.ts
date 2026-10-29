import { describe, expect, it } from 'vitest';
import { playwrightWorkers } from '../src/workerCount';

const GIB = 1024 ** 3;

describe('playwrightWorkers', () => {
  it('uses one worker per four CPUs, capped at 6 and by 2 GiB of RAM each', () => {
    expect(playwrightWorkers({}, 24, 64 * GIB)).toBe(6);
    expect(playwrightWorkers({}, 8, 64 * GIB)).toBe(2);
    expect(playwrightWorkers({}, 2, 64 * GIB)).toBe(1);
    expect(playwrightWorkers({}, 24, 4 * GIB)).toBe(2);
    expect(playwrightWorkers({}, 24, GIB)).toBe(1);
  });

  it('uses one worker on CI, and MS_PW_WORKERS beats it', () => {
    expect(playwrightWorkers({ CI: 'true' }, 24, 64 * GIB)).toBe(1);
    expect(playwrightWorkers({ CI: 'true', MS_PW_WORKERS: '3' }, 24, 64 * GIB)).toBe(3);
    expect(playwrightWorkers({ MS_PW_WORKERS: '' }, 24, 64 * GIB)).toBe(6);
  });

  it('rejects a bad MS_PW_WORKERS naming the variable', () => {
    for (const bad of ['0', '33', '2.5', 'x', '-1']) {
      expect(() => playwrightWorkers({ MS_PW_WORKERS: bad }, 24, 64 * GIB)).toThrow(/MS_PW_WORKERS/);
    }
  });
});
