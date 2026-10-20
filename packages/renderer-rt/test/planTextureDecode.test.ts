import { describe, expect, it } from 'vitest';
import { planTextureDecode } from '../src/index';
import { hasPartialAlpha } from '../src/textureUpload';
import { testTexture } from './testScene';

const limits = { maxTextureSide: 64, maxTexturePixelsTotal: 64 * 64 * 2 };

describe('planTextureDecode', () => {
  it('admits textures within the limits', () => {
    expect(planTextureDecode([testTexture(), testTexture({ width: 64, height: 32 })], limits)).toEqual({
      decode: [true, true],
      warnings: [],
    });
  });

  it('rejects a missing texture before decoding', () => {
    const plan = planTextureDecode([testTexture({ bytes: null, missing: true, width: 0, height: 0 })], limits);
    expect(plan.decode).toEqual([false]);
    expect(plan.warnings).toMatchObject([{ code: 'TEXTURE_MISSING', texture: 0 }]);
  });

  it('rejects a side over the limit and an empty size', () => {
    const plan = planTextureDecode([testTexture({ width: 65 }), testTexture({ width: 0 }), testTexture()], limits);
    expect(plan.decode).toEqual([false, false, true]);
    expect(plan.warnings.map((w) => [w.code, w.texture])).toEqual([
      ['TEXTURE_TOO_LARGE', 0],
      ['TEXTURE_TOO_LARGE', 1],
    ]);
    expect(plan.warnings[0]?.message).toContain('1..64');
  });

  it('stops admitting once the total pixel budget is spent', () => {
    const big = testTexture({ width: 64, height: 64 });
    const plan = planTextureDecode([big, big, big, testTexture({ width: 1, height: 1 })], limits);
    expect(plan.decode).toEqual([true, true, false, false]);
    expect(plan.warnings.map((w) => w.texture)).toEqual([2, 3]);
  });
});

describe('hasPartialAlpha', () => {
  it('finds alpha strictly between cutout and opaque', () => {
    expect(hasPartialAlpha(new Uint8Array([9, 9, 9, 0, 9, 9, 9, 255]))).toBe(false);
    expect(hasPartialAlpha(new Uint8Array([9, 9, 9, 255, 9, 9, 9, 1]))).toBe(true);
    expect(hasPartialAlpha(new Uint8Array([9, 9, 9, 254]))).toBe(true);
  });
});
