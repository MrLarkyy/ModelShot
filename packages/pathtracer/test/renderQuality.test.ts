import { describe, expect, it } from 'vitest';
import {
  MAX_SUPERSAMPLE,
  MAX_SUPERSAMPLED_PIXELS,
  checkRenderQuality,
  supersampledScale,
  type RenderQualityFields,
} from '../src/renderQuality';

const LIMITS = { maxWidth: 16384, maxHeight: 16384 };

describe('checkRenderQuality', () => {
  it('defaults to one sample per pixel, no denoiser and no convergence stop', () => {
    expect(checkRenderQuality({})).toEqual({ supersample: 1, denoise: false, noiseThreshold: null });
    expect(checkRenderQuality({ supersample: undefined, denoise: undefined, noiseThreshold: undefined })).toEqual({
      supersample: 1,
      denoise: false,
      noiseThreshold: null,
    });
  });

  it('accepts every field in range', () => {
    expect(checkRenderQuality({ supersample: 4, denoise: true, noiseThreshold: 1 })).toEqual({
      supersample: 4,
      denoise: true,
      noiseThreshold: 1,
    });
    expect(checkRenderQuality({ supersample: 1, noiseThreshold: 1e-6 }).noiseThreshold).toBe(1e-6);
  });

  it('throws a RangeError naming the field for any other value', () => {
    const bad: [RenderQualityFields, string][] = [
      ...[0, 5, 2.5, -1, Number.NaN, Infinity, '2'].map(
        (supersample): [RenderQualityFields, string] => [{ supersample } as RenderQualityFields, 'supersample'],
      ),
      ...[1, 0, 'yes', null].map((denoise): [RenderQualityFields, string] => [
        { denoise } as unknown as RenderQualityFields,
        'denoise',
      ]),
      ...[0, -0.1, 1.0001, Number.NaN, Infinity, '0.1', null].map((noiseThreshold): [RenderQualityFields, string] => [
        { noiseThreshold } as unknown as RenderQualityFields,
        'noiseThreshold',
      ]),
    ];
    for (const [fields, name] of bad) {
      expect(() => checkRenderQuality(fields), JSON.stringify(fields)).toThrow(RangeError);
      expect(() => checkRenderQuality(fields), JSON.stringify(fields)).toThrow(new RegExp(`^${name} `));
    }
  });
});

describe('supersampledScale', () => {
  it('keeps the requested scale where it fits', () => {
    expect(supersampledScale(2, 256, 256, LIMITS)).toBe(2);
    expect(supersampledScale(MAX_SUPERSAMPLE, 512, 512, LIMITS)).toBe(4);
    expect(supersampledScale(1, 256, 256, LIMITS)).toBe(1);
  });

  it('lowers the scale to the accumulation pixel cap', () => {
    // 2 x 1920 x 2 x 1080 = 8.3 M pixels over 2^22.
    expect(supersampledScale(2, 1920, 1080, LIMITS)).toBe(1);
    // 4: 16 Mi, 3: 9 Mi, 2: exactly 2^22.
    expect(supersampledScale(4, 1024, 1024, LIMITS)).toBe(2);
    expect(4 * 1024 * 1024).toBe(MAX_SUPERSAMPLED_PIXELS);
  });

  it('lowers the scale to the GPU target side on either axis', () => {
    expect(supersampledScale(4, 300, 100, { maxWidth: 1000, maxHeight: 16384 })).toBe(3);
    expect(supersampledScale(4, 100, 300, { maxWidth: 16384, maxHeight: 700 })).toBe(2);
    expect(supersampledScale(4, 100, 300, { maxWidth: 16384, maxHeight: 500 })).toBe(1);
  });

  it('never goes under 1, whatever the frame', () => {
    expect(supersampledScale(4, 4096, 4096, LIMITS)).toBe(1);
    expect(supersampledScale(4, 5000, 10, { maxWidth: 4096, maxHeight: 4096 })).toBe(1);
  });
});
