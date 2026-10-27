import { describe, expect, it } from 'vitest';
import { EXACT_SUPERSAMPLE_MAX_PIXELS, exactSupersampleScale } from '../src/exactSupersample';
import type { GlLimits } from '../src/glLimits';

const limits: GlLimits = {
  maxTextureSize: 16384,
  maxRenderbufferSize: 16384,
  maxViewport: [16384, 16384],
  maxSamplesRgba16f: 4,
  colorBufferFloat: true,
  fragmentHighp: true,
  renderer: 'test',
};

describe('exactSupersampleScale', () => {
  it('supersamples only where MSAA would have run', () => {
    expect(exactSupersampleScale(512, 512, 0, limits)).toBe(1);
    expect(exactSupersampleScale(512, 512, 1, limits)).toBe(1);
    expect(exactSupersampleScale(512, 512, 4, limits)).toBe(2);
  });

  it('keeps 2W and 2H within the renderbuffer, texture and viewport limits', () => {
    const at = (overrides: Partial<GlLimits>, width: number, height: number) =>
      exactSupersampleScale(width, height, 4, { ...limits, ...overrides });
    expect(at({ maxRenderbufferSize: 1024 }, 512, 300)).toBe(2);
    expect(at({ maxRenderbufferSize: 1024 }, 513, 300)).toBe(1);
    expect(at({ maxRenderbufferSize: 1024 }, 300, 513)).toBe(1);
    expect(at({ maxTextureSize: 1024 }, 512, 512)).toBe(2);
    expect(at({ maxTextureSize: 1024 }, 513, 512)).toBe(1);
    expect(at({ maxViewport: [1024, 4096] }, 512, 1000)).toBe(2);
    expect(at({ maxViewport: [1024, 4096] }, 513, 1000)).toBe(1);
    expect(at({ maxViewport: [4096, 1024] }, 1000, 512)).toBe(2);
    expect(at({ maxViewport: [4096, 1024] }, 1000, 513)).toBe(1);
  });

  it('caps the sub-pixels at 2^23', () => {
    expect(EXACT_SUPERSAMPLE_MAX_PIXELS).toBe(2 ** 23);
    // 4 × 2048 × 1024 = 2^23 exactly; one more row is over.
    expect(exactSupersampleScale(2048, 1024, 4, limits)).toBe(2);
    expect(exactSupersampleScale(2048, 1025, 4, limits)).toBe(1);
    expect(exactSupersampleScale(1920, 1080, 4, limits)).toBe(2);
  });

  it('draws an empty canvas single-sampled', () => {
    expect(exactSupersampleScale(0, 512, 4, limits)).toBe(1);
  });
});
