import { describe, expect, it } from 'vitest';
import { NOISE_QUANTILE, noiseQuantile } from '../src/noiseQuantile';

describe('noiseQuantile', () => {
  it('takes the nearest-rank quantile', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(noiseQuantile(hundred, NOISE_QUANTILE)).toBe(99);
    expect(noiseQuantile(hundred, 0.5)).toBe(50);
    expect(noiseQuantile(hundred, 1)).toBe(100);
    expect(noiseQuantile(hundred, 0)).toBe(1);
    expect(noiseQuantile([0.3, 0.1, 0.2])).toBe(0.3);
    expect(noiseQuantile(new Float32Array([0.5]))).toBe(0.5);
  });

  it('leaves one outlier in 200 blocks out of the 0.99 quantile', () => {
    const blocks = new Float32Array(200).fill(0.02);
    blocks[17] = 5;
    expect(noiseQuantile(blocks)).toBeCloseTo(0.02, 6);
    blocks[18] = 5;
    blocks[19] = 5;
    expect(noiseQuantile(blocks)).toBe(5);
  });

  it('ignores NaN, keeps Infinity, and is Infinity without values', () => {
    expect(noiseQuantile([Number.NaN, 0.2, Number.NaN, 0.1], 1)).toBe(0.2);
    expect(noiseQuantile([0.1, Infinity], 1)).toBe(Infinity);
    expect(noiseQuantile([])).toBe(Infinity);
    expect(noiseQuantile([Number.NaN])).toBe(Infinity);
  });
});
