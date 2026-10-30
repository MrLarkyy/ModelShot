import { describe, expect, it } from 'vitest';
import { oitSeamCoverageMode } from '../src/oitSeamCoverage';

describe('oitSeamCoverageMode', () => {
  it('ramps partial seams in frames without a sample history, with the opaque side hard or by alpha-to-coverage', () => {
    expect(oitSeamCoverageMode(false, true, false)).toBe(1);
    expect(oitSeamCoverageMode(false, true, true)).toBe(2);
  });

  it('is off for a pass of an accumulated exact frame: the mean of its passes already antialiases the seams', () => {
    expect(oitSeamCoverageMode(true, true, false)).toBe(0);
    expect(oitSeamCoverageMode(true, true, true)).toBe(0);
  });

  it('is off without texel anti-aliasing', () => {
    for (const accumulating of [false, true]) {
      for (const alphaToCoverage of [false, true]) {
        expect(oitSeamCoverageMode(accumulating, false, alphaToCoverage)).toBe(0);
      }
    }
  });
});
