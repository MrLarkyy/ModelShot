import { describe, expect, it } from 'vitest';
import rngSource from '../src/shaders/rng.glsl?raw';
import { pcgHash, sampleHash, unitRandom } from '../src/pcgHash';

// Vectors from an independent implementation (Python, arbitrary-precision integers masked to 32 bits).
describe('pcgHash', () => {
  it('matches reference vectors', () => {
    expect([0, 1, 2, 0xffffffff, 123456789].map(pcgHash)).toEqual([
      129708002, 2831084092, 2055130248, 3861530882, 4272394698,
    ]);
    expect(sampleHash(1, 0, 0, 0)).toBe(555269243);
    expect(sampleHash(1, 5, 17, 33)).toBe(2182685304);
    expect(sampleHash(0xffffffff, 65535, 4095, 4095)).toBe(1849451510);
    const key = sampleHash(1, 5, 17, 33);
    expect(unitRandom(key, 0)).toBe(0.48871785402297974);
    expect(unitRandom(key, 3, 42)).toBe(0.580573558807373);
  });

  it('gives numbers in [0, 1) that differ by seed, sample, pixel and dimension', () => {
    const seen = new Set<number>();
    for (const [seed, sample, x, y] of [
      [1, 0, 0, 0],
      [2, 0, 0, 0],
      [1, 1, 0, 0],
      [1, 0, 1, 0],
      [1, 0, 0, 1],
    ] as const) {
      const key = sampleHash(seed, sample, x, y);
      for (let d = 0; d < 4; d++) {
        const u = unitRandom(key, d);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
        seen.add(u);
      }
    }
    expect(seen.size).toBe(20);
  });

  it('uses the same constants as rng.glsl', () => {
    for (const constant of ['747796405u', '2891336453u', '277803737u', '(state >> 28u) + 4u', '(word >> 22u) ^ word']) {
      expect(rngSource).toContain(constant);
    }
  });
});
