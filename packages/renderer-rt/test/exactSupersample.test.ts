import { describe, expect, it } from 'vitest';
import { EXACT_SAMPLE_OFFSETS, EXACT_SUPERSAMPLE_MAX_PIXELS, exactSampleCount } from '../src/exactSupersample';
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

describe('exactSampleCount', () => {
  it('accumulates 4 samples only where MSAA would have run', () => {
    expect(exactSampleCount(512, 512, 0, limits)).toBe(1);
    expect(exactSampleCount(512, 512, 1, limits)).toBe(1);
    expect(exactSampleCount(512, 512, 4, limits)).toBe(4);
  });

  it('keeps a slot within MAX_TEXTURE_SIZE', () => {
    const small = { ...limits, maxTextureSize: 1024 };
    expect(exactSampleCount(1024, 300, 4, small)).toBe(4);
    expect(exactSampleCount(1025, 300, 4, small)).toBe(1);
    expect(exactSampleCount(300, 1025, 4, small)).toBe(1);
  });

  it('caps the 4 slots at 2^23 pixels', () => {
    expect(EXACT_SUPERSAMPLE_MAX_PIXELS).toBe(2 ** 23);
    // 4 × 2048 × 1024 = 2^23 exactly; one more row is over.
    expect(exactSampleCount(2048, 1024, 4, limits)).toBe(4);
    expect(exactSampleCount(2048, 1025, 4, limits)).toBe(1);
    expect(exactSampleCount(1920, 1080, 4, limits)).toBe(4);
  });

  it('draws an empty canvas single-sampled', () => {
    expect(exactSampleCount(0, 512, 4, limits)).toBe(1);
  });
});

describe('EXACT_SAMPLE_OFFSETS', () => {
  it('is a rotated grid centred on the pixel: 4 distinct rows and columns', () => {
    expect(EXACT_SAMPLE_OFFSETS).toEqual([
      [-1 / 8, -3 / 8],
      [1 / 8, 3 / 8],
      [3 / 8, -1 / 8],
      [-3 / 8, 1 / 8],
    ]);
    const xs = new Set(EXACT_SAMPLE_OFFSETS.map(([x]) => x));
    const ys = new Set(EXACT_SAMPLE_OFFSETS.map(([, y]) => y));
    expect([xs.size, ys.size]).toEqual([4, 4]);
    expect(EXACT_SAMPLE_OFFSETS.reduce((sum, [x, y]) => [sum[0] + x, sum[1] + y], [0, 0])).toEqual([0, 0]);
  });
});
