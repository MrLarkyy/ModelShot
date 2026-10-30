import { describe, expect, it } from 'vitest';
import type { GlLimits } from '../src/glLimits';
import { OIT_MSAA_MAX_SAMPLES, oitMsaaActive } from '../src/oitMsaa';

const limits: GlLimits = {
  maxTextureSize: 16384,
  maxRenderbufferSize: 16384,
  maxViewport: [16384, 16384],
  maxSamplesRgba16f: 4,
  maxSamplesR16f: 4,
  colorBufferFloat: true,
  fragmentHighp: true,
  renderer: 'test',
};

describe('oitMsaaActive', () => {
  it('draws the OIT pass multisampled only with more than one sample', () => {
    expect(oitMsaaActive(512, 512, 0, limits)).toBe(false);
    expect(oitMsaaActive(512, 512, 1, limits)).toBe(false);
    expect(oitMsaaActive(512, 512, 2, limits)).toBe(true);
    expect(oitMsaaActive(512, 512, 4, limits)).toBe(true);
  });

  it('caps samples x pixels at 2^23 (about 80 MB): 1920 x 1080 at 4 samples fits, 2048 x 2048 does not', () => {
    expect(OIT_MSAA_MAX_SAMPLES).toBe(2 ** 23);
    expect(oitMsaaActive(1920, 1080, 4, limits)).toBe(true);
    expect(oitMsaaActive(2048, 1024, 4, limits)).toBe(true);
    expect(oitMsaaActive(2048, 1025, 4, limits)).toBe(false);
    expect(oitMsaaActive(2048, 2048, 4, limits)).toBe(false);
    expect(oitMsaaActive(2048, 2048, 2, limits)).toBe(true);
  });

  it('needs the sample count for the R16F weight target too', () => {
    expect(oitMsaaActive(512, 512, 4, { ...limits, maxSamplesR16f: 2 })).toBe(false);
    expect(oitMsaaActive(512, 512, 2, { ...limits, maxSamplesR16f: 2 })).toBe(true);
    expect(oitMsaaActive(512, 512, 4, { ...limits, maxSamplesR16f: 0 })).toBe(false);
  });

  it('draws an empty canvas single-sampled', () => {
    expect(oitMsaaActive(0, 512, 4, limits)).toBe(false);
    expect(oitMsaaActive(512, 0, 4, limits)).toBe(false);
  });
});
