import { describe, expect, it } from 'vitest';
import { JPEG_HEADER_CASES } from '../../formats/test/jpeg/jpegHeaderCases';
import { imageHeaderSize } from '../src/imageHeaderSize';
import { pngHeader } from './testScene';

/** Deterministic pseudo-random bytes (mulberry32). */
function randomBytes(seed: number, length: number): Uint8Array {
  let a = seed >>> 0;
  return Uint8Array.from({ length }, () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) & 0xff;
  });
}

describe('imageHeaderSize', () => {
  it('reads a PNG IHDR big-endian, also from a view into a larger buffer', () => {
    expect(imageHeaderSize(pngHeader(300, 70_000))).toEqual({ mimeType: 'image/png', width: 300, height: 70_000 });
    const larger = new Uint8Array(40);
    larger.set(pngHeader(5, 6), 8);
    expect(imageHeaderSize(larger.subarray(8))).toEqual({ mimeType: 'image/png', width: 5, height: 6 });
  });

  // The vectors of readJpegSize (formats): the renderer accepts exactly the JPEGs the loaders accept.
  it.each(JPEG_HEADER_CASES.map((c) => [c.name, c] as const))('JPEG: %s', (_name, c) => {
    const header = imageHeaderSize(c.bytes);
    if ('width' in c) expect(header).toEqual({ mimeType: 'image/jpeg', width: c.width, height: c.height });
    // A zero side is read as it is, as for PNG; planTextureDecode refuses it as a side outside 1..limit.
    else if (c.reason === 'ZERO_SIZE') expect(header?.width === 0 || header?.height === 0).toBe(true);
    else expect(header).toBeNull();
  });

  it('never throws on random bytes after a JPEG or PNG signature', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const bytes = randomBytes(seed, 3 + (seed % 97));
      bytes.set(seed % 2 === 0 ? [0xff, 0xd8, 0xff] : [137, 80, 78]);
      expect(() => imageHeaderSize(bytes)).not.toThrow();
    }
  });
});
