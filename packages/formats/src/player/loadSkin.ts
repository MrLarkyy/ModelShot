import { decodePngRgba } from '../png/decodePngRgba';
import { readPngSize } from '../png/readPngSize';
import { isLegacyHatOpaque } from './legacyHatOpaque';
import { SkinError } from './SkinError';
import { resolveSkinLimits, type SkinLimits } from './SkinLimits';
import type { SkinLayout, SkinLoadResult } from './SkinLoadResult';

export interface SkinLoadOptions {
  /** Texture name, at most `MAX_SKIN_NAME_CHARS` characters; absent: `'skin'`. */
  readonly name?: string;
  /** Overrides for some of `DEFAULT_SKIN_LIMITS`. */
  readonly limits?: Partial<SkinLimits>;
}

export const MAX_SKIN_NAME_CHARS = 1024;
const SKIN_UV_WIDTH = 64;

/**
 * A Minecraft skin from PNG bytes the user picked: 64 · 2^k pixels wide (up to `limits.maxSide`), and as high (modern
 * 64 × 64 layout) or half as high (legacy 64 × 32). Checks, in order and before copying anything: the name, the file
 * length, the PNG signature and header, the size rule. Then the pixels of a legacy skin, at most as many as its header
 * declares, are decoded to set `legacyHatOpaque`; pixel data that does not decode leaves it `false` (the hat is kept)
 * and is no error here. A modern skin is never decoded. Throws only `SkinError` for a bad file; invalid `limits` throw a
 * `RangeError`.
 */
export function loadSkin(bytes: Uint8Array, options: SkinLoadOptions = {}): SkinLoadResult {
  const limits = resolveSkinLimits(options.limits);
  const name = options.name ?? 'skin';
  if (typeof name !== 'string' || name.length > MAX_SKIN_NAME_CHARS) {
    throw new SkinError('INVALID_NAME', `expected a string of at most ${MAX_SKIN_NAME_CHARS} characters`);
  }
  if (!(bytes instanceof Uint8Array)) throw new TypeError('loadSkin expects the file as a Uint8Array');
  if (bytes.length > limits.maxFileBytes) {
    throw new SkinError('FILE_TOO_LARGE', `the file has more than ${limits.maxFileBytes} bytes`);
  }
  const size = readPngSize(bytes);
  if (!size.ok) {
    if (size.reason === 'TRUNCATED') throw new SkinError('TRUNCATED', 'the PNG header is incomplete');
    if (size.reason === 'ZERO_SIZE') throw new SkinError('BAD_SIZE', 'the PNG header declares a zero size');
    throw new SkinError('NOT_PNG', size.reason === 'NO_IHDR' ? 'no IHDR chunk first' : 'no PNG signature');
  }
  const layout = skinLayout(size.width, size.height, limits.maxSide);
  if (!layout) {
    throw new SkinError(
      'BAD_SIZE',
      `expected 64 · 2^k pixels wide (at most ${limits.maxSide}) and as high or half as high, got ` +
        `${size.width} × ${size.height}`,
    );
  }
  // Not bytes.slice(): Buffer overrides it to return a view of the same memory; the typed-array slice copies.
  const copy = Uint8Array.prototype.slice.call(bytes);
  let legacyHatOpaque = false;
  if (layout === 'legacy') {
    const image = decodePngRgba(copy, size.width * size.height);
    legacyHatOpaque = image ? isLegacyHatOpaque(image) : false;
  }
  return {
    texture: {
      name,
      mimeType: 'image/png',
      bytes: copy,
      width: size.width,
      height: size.height,
      uvWidth: SKIN_UV_WIDTH,
      uvHeight: layout === 'modern' ? SKIN_UV_WIDTH : SKIN_UV_WIDTH / 2,
      missing: false,
    },
    layout,
    legacyHatOpaque,
  };
}

function skinLayout(width: number, height: number, maxSide: number): SkinLayout | undefined {
  const scale = width / SKIN_UV_WIDTH;
  const powerOfTwo = Number.isInteger(scale) && scale >= 1 && (scale & (scale - 1)) === 0;
  if (!powerOfTwo || width > maxSide) return undefined;
  if (height === width) return 'modern';
  if (height * 2 === width) return 'legacy';
  return undefined;
}
