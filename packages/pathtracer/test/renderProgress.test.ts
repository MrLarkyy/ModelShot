import { describe, expect, it } from 'vitest';
import { estimateRemainingMs, type RemainingEstimate } from '../src/renderProgress';

const base: RemainingEstimate = {
  samplesDone: 16,
  targetSamples: 64,
  elapsedMs: 800,
  finished: false,
  noiseThreshold: null,
  noise: null,
  noiseSamples: 0,
};

describe('estimateRemainingMs', () => {
  it('is null before the first sample and 0 when finished', () => {
    expect(estimateRemainingMs({ ...base, samplesDone: 0, elapsedMs: 0 })).toBeNull();
    expect(estimateRemainingMs({ ...base, finished: true })).toBe(0);
    expect(estimateRemainingMs({ ...base, samplesDone: 64, finished: true })).toBe(0);
  });

  it('extrapolates the time per sample to the target', () => {
    // 50 ms per sample, 48 to go.
    expect(estimateRemainingMs(base)).toBe(2400);
    expect(estimateRemainingMs({ ...base, samplesDone: 63, elapsedMs: 630 })).toBe(10);
  });

  it('predicts the stop of a threshold from the noise falling as 1/sqrt(n)', () => {
    const at = (noise: number, targetSamples = 1024) =>
      estimateRemainingMs({ ...base, targetSamples, noiseThreshold: 0.05, noise, noiseSamples: 16 });
    // 16 x (0.1 / 0.05)^2 = 64: 48 samples to go at 50 ms.
    expect(at(0.1)).toBe(2400);
    // 16 x 2.2^2 = 77.4 -> 78, seen at checkpoint 80.
    expect(at(0.11)).toBe(64 * 50);
    // Capped at the target.
    expect(at(1, 128)).toBe(112 * 50);
    // At least the next checkpoint when the noise is already under the threshold.
    expect(at(0.01)).toBe(16 * 50);
    // Unknown noise: the target.
    expect(at(Infinity)).toBe((1024 - 16) * 50);
  });

  it('ignores a threshold without a measured noise', () => {
    expect(estimateRemainingMs({ ...base, noiseThreshold: 0.05 })).toBe(2400);
  });
});
