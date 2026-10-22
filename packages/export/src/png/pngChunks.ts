import type { RenderedImage } from '@modelshot/pathtracer';
import { ByteWriter } from '../ByteWriter';
import { crc32 } from './checksums';

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One PNG chunk: length, type, data, CRC of type and data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const name = new ByteWriter().ascii(type).toBytes();
  return new ByteWriter().u32(data.length).bytes(name).bytes(data).u32(crc32(name, data)).toBytes();
}

/** IHDR of an 8-bit RGBA image (colour type 6), no interlace. */
export function ihdr(width: number, height: number): Uint8Array<ArrayBuffer> {
  return pngChunk('IHDR', new ByteWriter().u32(width).u32(height).u8(8).u8(6).u8(0).u8(0).u8(0).toBytes());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * The image's scanlines with a filter byte each: per row None or Paeth, whichever has the smaller sum of absolute
 * values as signed bytes (the PNG specification's heuristic); flat pixel art mostly takes Paeth's zeros.
 */
export function filterScanlines(image: RenderedImage): Uint8Array<ArrayBuffer> {
  const { width, height, data } = image;
  const row = width * 4;
  const out = new Uint8Array(height * (row + 1));
  const paethRow = new Uint8Array(row);
  for (let y = 0; y < height; y++) {
    const at = y * row;
    let noneCost = 0;
    let paethCost = 0;
    for (let x = 0; x < row; x++) {
      const value = data[at + x] as number;
      const left = x >= 4 ? (data[at + x - 4] as number) : 0;
      const up = y > 0 ? (data[at + x - row] as number) : 0;
      const upLeft = y > 0 && x >= 4 ? (data[at + x - row - 4] as number) : 0;
      const filtered = (value - paeth(left, up, upLeft)) & 0xff;
      paethRow[x] = filtered;
      noneCost += value < 128 ? value : 256 - value;
      paethCost += filtered < 128 ? filtered : 256 - filtered;
    }
    const target = y * (row + 1);
    if (paethCost < noneCost) {
      out[target] = 4;
      out.set(paethRow, target + 1);
    } else {
      out[target] = 0;
      out.set(data.subarray(at, at + row), target + 1);
    }
  }
  return out;
}
