import { ByteWriter } from '../ByteWriter';
import { crc32 } from './checksums';

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One PNG chunk in one exact-size array: length, type, the data parts in order, CRC of type and data. */
export function pngChunk(type: string, ...data: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = data.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(12 + length);
  const view = new DataView(out.buffer);
  view.setUint32(0, length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i) & 0x7f;
  let at = 8;
  for (const part of data) {
    out.set(part, at);
    at += part.length;
  }
  view.setUint32(at, crc32(out.subarray(4, at)));
  return out;
}

/** IHDR of an 8-bit RGBA image (colour type 6), no interlace. */
export function ihdr(width: number, height: number): Uint8Array<ArrayBuffer> {
  return pngChunk('IHDR', new ByteWriter().u32(width).u32(height).u8(8).u8(6).u8(0).u8(0).u8(0).toBytes());
}
