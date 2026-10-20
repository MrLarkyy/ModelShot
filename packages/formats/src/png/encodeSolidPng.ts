import { adler32, crc32 } from './checksums';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A 1×1 RGBA8 PNG of one colour (bytes 0–255, straight alpha), for a material that has a colour but no texture. The
 * image data is a zlib stream with one stored (uncompressed) block, so the output depends on the colour only and every
 * decoder reads it.
 */
export function encodeSolidPng(rgba: readonly [number, number, number, number]): Uint8Array {
  const pixel = rgba.map((value) => Math.min(255, Math.max(0, Math.round(value))));
  // Width 1, height 1, bit depth 8, colour type 6 (RGBA), deflate, adaptive filtering, no interlace.
  const ihdr = [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0];
  const scanline = [0, ...pixel];
  const adler = adler32(scanline);
  // zlib header 0x78 0x01, then a final stored block: LEN and its one's complement NLEN, little-endian.
  const zlib = [0x78, 0x01, 0x01, scanline.length, 0, ~scanline.length & 0xff, 0xff, ...scanline, ...uint32(adler)];
  return Uint8Array.from([...SIGNATURE, ...chunk('IHDR', ihdr), ...chunk('IDAT', zlib), ...chunk('IEND', [])]);
}

function chunk(type: string, data: readonly number[]): number[] {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  return [...uint32(data.length), ...typeBytes, ...data, ...uint32(crc32([...typeBytes, ...data]))];
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
