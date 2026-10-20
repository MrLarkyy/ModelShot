import { describe, expect, it } from 'vitest';
import { adler32, crc32, encodeSolidPng } from '../../src/png/encodeSolidPng';
import { readPngSize } from '../../src/png/readPngSize';

describe('encodeSolidPng', () => {
  it('known checksum vectors', () => {
    const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(ascii('IEND'))).toBe(0xae426082);
    expect(adler32(ascii('Wikipedia'))).toBe(0x11e60398);
  });

  it('writes a 1×1 RGBA PNG that the header reader accepts', () => {
    const png = encodeSolidPng([188, 188, 188, 255]);
    expect(readPngSize(png)).toEqual({ ok: true, width: 1, height: 1 });
    // Signature, IHDR (25), IDAT with a 16-byte zlib stream (28), IEND (12).
    expect(png.byteLength).toBe(8 + 25 + 28 + 12);
    // After the IDAT length and type: zlib header (2), block header (5), then the filter byte and the pixel.
    expect([...png.slice(33 + 8 + 7, 33 + 8 + 12)]).toEqual([0, 188, 188, 188, 255]);
  });

  it('every chunk carries a correct CRC', () => {
    const png = encodeSolidPng([1, 2, 3, 4]);
    const view = new DataView(png.buffer);
    let offset = 8;
    const types: string[] = [];
    while (offset < png.byteLength) {
      const length = view.getUint32(offset);
      const body = png.slice(offset + 4, offset + 8 + length);
      types.push(String.fromCharCode(...body.slice(0, 4)));
      expect(view.getUint32(offset + 8 + length)).toBe(crc32(body));
      offset += 12 + length;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('is deterministic and clamps and rounds channels', () => {
    expect(encodeSolidPng([0.4, -3, 300, 254.6])).toEqual(encodeSolidPng([0, 0, 255, 255]));
    expect(encodeSolidPng([10, 20, 30, 40])).toEqual(encodeSolidPng([10, 20, 30, 40]));
  });
});
