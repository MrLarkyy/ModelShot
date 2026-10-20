import { describe, expect, it } from 'vitest';
import { decodePngRgba, type PngRgbaImage } from '../../src/png/decodePngRgba';
import { isLegacyHatOpaque } from '../../src/player/legacyHatOpaque';
import { buildPng } from '../support/buildPng';

/** A legacy skin image of `width` × `width / 2`, every texel opaque except the alpha `holes` give. */
function image(width: number, holes: readonly [number, number, number][] = [], alpha = 255): PngRgbaImage {
  const height = width / 2;
  const rgba = new Uint8Array(width * height * 4).fill(alpha);
  for (const [x, y, a] of holes) rgba[(y * width + x) * 4 + 3] = a;
  return { width, height, rgba };
}

/** A 64 × 32 RGBA 16-bit PNG, opaque, with alpha `alpha16` at hat texel (40, 5), decoded. */
function sixteenBit(alpha16: number): PngRgbaImage {
  const samples = new Array<number>(64 * 32 * 4).fill(0xffff);
  samples[(5 * 64 + 40) * 4 + 3] = alpha16;
  const decoded = decodePngRgba(buildPng({ width: 64, height: 32, colourType: 6, depth: 16, samples }), 64 * 32);
  if (!decoded) throw new Error('the 16-bit test PNG does not decode');
  return decoded;
}

describe('isLegacyHatOpaque', () => {
  it('is true for a fully opaque image and for alpha 128 everywhere', () => {
    expect(isLegacyHatOpaque(image(64))).toBe(true);
    expect(isLegacyHatOpaque(image(64, [], 128))).toBe(true);
  });

  it('is false for alpha 127 at the last texel of the area (63, 31)', () => {
    expect(isLegacyHatOpaque(image(64, [[63, 31, 127]]))).toBe(false);
    expect(isLegacyHatOpaque(image(64, [[32, 0, 0]]))).toBe(false);
    expect(isLegacyHatOpaque(image(64, [[48, 20, 100]]))).toBe(false);
  });

  it('ignores transparency left of x 32', () => {
    expect(
      isLegacyHatOpaque(
        image(64, [
          [31, 0, 0],
          [0, 31, 0],
          [10, 10, 0],
        ]),
      ),
    ).toBe(true);
  });

  it('scales the area with an HD skin (128 x 64: x 64..128, y 0..64)', () => {
    expect(isLegacyHatOpaque(image(128, [[127, 63, 0]]))).toBe(false);
    expect(isLegacyHatOpaque(image(128, [[64, 0, 0]]))).toBe(false);
    expect(isLegacyHatOpaque(image(128, [[63, 0, 0]]))).toBe(true);
  });

  it('reads the high byte of 16-bit alpha: 32767 is transparent, 32768 opaque', () => {
    expect(isLegacyHatOpaque(sixteenBit(32767))).toBe(false);
    expect(isLegacyHatOpaque(sixteenBit(32768))).toBe(true);
  });

  it('is false for an image that is no skin size', () => {
    expect(isLegacyHatOpaque({ width: 63, height: 32, rgba: new Uint8Array(63 * 32 * 4).fill(255) })).toBe(false);
  });
});
