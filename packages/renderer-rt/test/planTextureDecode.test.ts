import { describe, expect, it } from 'vitest';
import { planTextureDecode } from '../src/index';
import { pngHeaderSize } from '../src/pngHeaderSize';
import { pngHeader, testTexture } from './testScene';

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

describe('planTextureDecode reads the PNG header, not the declared size', () => {
  it('rejects a header over the limit even when the declared size is small', () => {
    const plan = planTextureDecode([testTexture({ bytes: pngHeader(16384, 16384) })], limits);
    expect(plan.decode).toEqual([false]);
    expect(plan.warnings).toMatchObject([{ code: 'TEXTURE_TOO_LARGE', texture: 0 }]);
    expect(plan.warnings[0]?.message).toContain('16384x16384');
  });

  it('rejects a header that disagrees with the declared size', () => {
    const plan = planTextureDecode([testTexture({ bytes: pngHeader(32, 32) })], limits);
    expect(plan.warnings).toMatchObject([{ code: 'TEXTURE_SIZE_MISMATCH', texture: 0 }]);
  });

  it('rejects bytes without a PNG signature and IHDR', () => {
    const notPng = new Uint8Array(64).fill(7);
    const truncated = pngHeader(16, 16).subarray(0, 20);
    const noIhdr = pngHeader(16, 16).map((v, i) => (i === 12 ? 0 : v));
    for (const bytes of [notPng, truncated, noIhdr]) {
      expect(planTextureDecode([testTexture({ bytes })], limits).warnings).toMatchObject([
        { code: 'TEXTURE_DECODE_FAILED', texture: 0 },
      ]);
    }
  });
});

describe('pngHeaderSize', () => {
  it('reads width and height big-endian, also from a view into a larger buffer', () => {
    expect(pngHeaderSize(pngHeader(300, 70_000))).toEqual({ width: 300, height: 70_000 });
    const larger = new Uint8Array(40);
    larger.set(pngHeader(5, 6), 8);
    expect(pngHeaderSize(larger.subarray(8))).toEqual({ width: 5, height: 6 });
  });
});
