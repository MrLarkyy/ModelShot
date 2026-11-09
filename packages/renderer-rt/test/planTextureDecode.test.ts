import { describe, expect, it } from 'vitest';
import { planTextureDecode } from '../src/index';
import { jpegFrame, jpegWith } from '../../formats/test/jpeg/jpegHeaderCases';
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
    const big = () => testTexture({ width: 64, height: 64 });
    const plan = planTextureDecode([big(), big(), big(), testTexture({ width: 1, height: 1 })], limits);
    expect(plan.decode).toEqual([true, true, false, false]);
    expect(plan.warnings.map((w) => w.texture)).toEqual([2, 3]);
  });
});

describe('planTextureDecode with a shared bytes object', () => {
  it('counts one image under two samplers once', () => {
    const one = testTexture({ width: 64, height: 64 });
    const plan = planTextureDecode([one, { ...one }], { maxTextureSide: 64, maxTexturePixelsTotal: 64 * 64 });
    expect(plan).toEqual({ decode: [true, true], warnings: [] });
  });

  it('counts equal content in distinct bytes objects twice', () => {
    const plan = planTextureDecode([testTexture({ width: 64, height: 64 }), testTexture({ width: 64, height: 64 })], {
      maxTextureSide: 64,
      maxTexturePixelsTotal: 64 * 64,
    });
    expect(plan.decode).toEqual([true, false]);
  });

  it('rejects a duplicate whose declared size disagrees with the shared header', () => {
    const one = testTexture();
    const plan = planTextureDecode([one, { ...one, width: 8 }], limits);
    expect(plan.decode).toEqual([true, false]);
    expect(plan.warnings).toMatchObject([{ code: 'TEXTURE_SIZE_MISMATCH', texture: 1 }]);
  });

  it('rejects every duplicate of a rejected first occurrence', () => {
    const one = testTexture({ width: 65 });
    const plan = planTextureDecode([one, { ...one }], limits);
    expect(plan.decode).toEqual([false, false]);
    expect(plan.warnings.map((w) => w.texture)).toEqual([0, 1]);
  });
});

describe('planTextureDecode reads the image header, not the declared size', () => {
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

describe('planTextureDecode admits JPEG by its frame header', () => {
  const jpeg = (width: number, height: number, declared = { width, height }) =>
    testTexture({
      name: 't.jpg',
      mimeType: 'image/jpeg',
      bytes: jpegWith(jpegFrame(0xc2, width, height)),
      ...declared,
    });

  it('admits a JPEG and counts it toward the pixel total with the PNGs', () => {
    const plan = planTextureDecode([jpeg(64, 64), testTexture({ width: 64, height: 64 }), jpeg(1, 1)], limits);
    expect(plan.decode).toEqual([true, true, false]);
    expect(plan.warnings).toMatchObject([{ code: 'TEXTURE_TOO_LARGE', texture: 2 }]);
    expect(plan.warnings[0]?.message).toContain('total');
  });

  it('rejects a JPEG side over the limit and a header that disagrees with the declared size', () => {
    const plan = planTextureDecode(
      [jpeg(16384, 16, { width: 16, height: 16 }), jpeg(32, 32, { width: 16, height: 16 })],
      limits,
    );
    expect(plan.warnings.map((w) => [w.code, w.texture])).toEqual([
      ['TEXTURE_TOO_LARGE', 0],
      ['TEXTURE_SIZE_MISMATCH', 1],
    ]);
    expect(plan.warnings[0]?.message).toContain('16384x16');
    expect(plan.warnings[1]?.message).toContain('32x32 image header');
  });

  it('names a cut-off PNG and other bytes by kind', () => {
    const gif = Uint8Array.from([...'GIF89a......'].map((c) => c.charCodeAt(0)));
    const plan = planTextureDecode(
      [testTexture({ bytes: pngHeader(16, 16).subarray(0, 20) }), testTexture({ bytes: gif })],
      limits,
    );
    expect(plan.warnings.map((w) => w.message)).toEqual([
      'texture 0 is a PNG whose header is cut short or damaged',
      'texture 1 is not a PNG or JPEG image',
    ]);
  });

  it('rejects bytes of another kind than the declared mimeType', () => {
    const plan = planTextureDecode(
      [
        testTexture({ bytes: jpegWith(jpegFrame(0xc0, 16, 16)) }),
        testTexture({ mimeType: 'image/jpeg', bytes: pngHeader(16, 16) }),
        testTexture({ mimeType: 'image/jpeg', bytes: jpegWith(jpegFrame(0xc9, 16, 16)) }),
      ],
      limits,
    );
    expect(plan.decode).toEqual([false, false, false]);
    expect(plan.warnings.map((w) => w.code)).toEqual(Array(3).fill('TEXTURE_DECODE_FAILED'));
    expect(plan.warnings[0]?.message).toBe('texture 0 holds image/jpeg bytes, the scene says image/png');
    expect(plan.warnings[2]?.message).toBe(
      'texture 2 is a JPEG whose header is cut short or is not an 8-bit Huffman coding browsers decode',
    );
  });
});
