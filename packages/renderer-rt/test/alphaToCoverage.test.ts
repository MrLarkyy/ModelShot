import { describe, expect, it } from 'vitest';
import { alphaToCoverageActive } from '../src/alphaToCoverage';

describe('alphaToCoverageActive', () => {
  it('is on only for a bound multisampled target with texel anti-aliasing on', () => {
    expect(alphaToCoverageActive(true, 4, true)).toBe(true);
    expect(alphaToCoverageActive(true, 2, true)).toBe(true);
  });

  it('is off for exact frames, which draw into the single-sampled target', () => {
    expect(alphaToCoverageActive(false, 4, true)).toBe(false);
  });

  it('is off without sample buffers or with a single sample', () => {
    for (const samples of [0, 1]) {
      expect(alphaToCoverageActive(true, samples, true), `${samples} samples`).toBe(false);
      expect(alphaToCoverageActive(false, samples, true), `${samples} samples, not bound`).toBe(false);
    }
  });

  it('is off without texel anti-aliasing', () => {
    for (const samples of [0, 1, 4]) {
      expect(alphaToCoverageActive(true, samples, false), `${samples} samples`).toBe(false);
      expect(alphaToCoverageActive(false, samples, false), `${samples} samples, not bound`).toBe(false);
    }
  });
});
