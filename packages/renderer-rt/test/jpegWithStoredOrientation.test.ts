import { describe, expect, it } from 'vitest';
import { encodeFlatJpeg } from '../../formats/test/fixtures/jpeg/encodeFlatJpeg.mjs';
import { jpegSegment } from '../../formats/test/jpeg/jpegHeaderCases';
import { jpegWithStoredOrientation } from '../src/jpegWithStoredOrientation';

const BLOCKS: [number, number, number][] = [
  [100, 120, 140],
  [30, 200, 60],
];
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** IFD0 entry offsets of the orientation value in `bytes` (big- or little-endian), read back. */
function orientationOf(bytes: Uint8Array): number | null {
  const at = bytes.findIndex((b, i) => b === 0x45 && bytes[i + 1] === 0x78 && bytes[i + 4] === 0 && bytes[i + 5] === 0);
  if (at < 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const tiff = at + 6;
  const little = view.getUint16(tiff) === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  for (let i = 0; i < view.getUint16(ifd, little); i++) {
    const entry = ifd + 2 + 12 * i;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return null;
}

/** A little-endian Exif APP1 with a ImageWidth entry, then Orientation `value`. */
function littleEndianExif(value: number): number[] {
  const tiff = [...ascii('II'), 42, 0, 8, 0, 0, 0, 2, 0];
  const width = [0x00, 0x01, 3, 0, 1, 0, 0, 0, 16, 0, 0, 0];
  const orientation = [0x12, 0x01, 3, 0, 1, 0, 0, 0, value, 0, 0, 0];
  return jpegSegment(0xe1, [...ascii('Exif'), 0, 0, ...tiff, ...width, ...orientation, 0, 0, 0, 0]);
}

describe('jpegWithStoredOrientation', () => {
  it('resets a big-endian Exif orientation to 1 and changes no other byte, in a copy', () => {
    const original = encodeFlatJpeg(16, 8, BLOCKS, { exifOrientation: 6 });
    const before = original.slice();
    const reset = jpegWithStoredOrientation(original);
    expect(orientationOf(original)).toBe(6);
    expect(orientationOf(reset)).toBe(1);
    expect(original).toEqual(before);
    expect(reset.filter((b, i) => b !== original[i])).toHaveLength(1);
  });

  it('resets a little-endian Exif orientation after another entry', () => {
    const plain = encodeFlatJpeg(16, 8, BLOCKS);
    const bytes = Uint8Array.from([...plain.subarray(0, 2), ...littleEndianExif(8), ...plain.subarray(2)]);
    expect(orientationOf(bytes)).toBe(8);
    expect(orientationOf(jpegWithStoredOrientation(bytes))).toBe(1);
  });

  it('copies a JPEG without Exif unchanged', () => {
    const plain = encodeFlatJpeg(16, 8, BLOCKS);
    const copy = jpegWithStoredOrientation(plain);
    expect(copy).toEqual(plain);
    expect(copy.buffer).not.toBe(plain.buffer);
  });

  it('leaves broken Exif alone: an IFD offset past the segment, a huge entry count, a cut segment', () => {
    const plain = encodeFlatJpeg(16, 8, BLOCKS);
    const head = [...plain.subarray(0, 2)];
    const tiff = (ifd: number[], rest: number[]) => [...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 42, ...ifd, ...rest];
    for (const app1 of [
      jpegSegment(0xe1, tiff([0x7f, 0xff, 0xff, 0xff], [])),
      jpegSegment(0xe1, tiff([0, 0, 0, 8], [0xff, 0xff, 0x01, 0x12, 0, 3])),
      jpegSegment(0xe1, tiff([0, 0, 0, 8], [0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6])).slice(0, 20),
    ]) {
      const bytes = Uint8Array.from([...head, ...app1]);
      expect(jpegWithStoredOrientation(bytes)).toEqual(bytes);
    }
  });

  it('never throws on random bytes after SOI', () => {
    let a = 7;
    for (let n = 0; n < 2000; n++) {
      const bytes = Uint8Array.from({ length: 4 + (n % 120) }, () => {
        a = (Math.imul(a, 1103515245) + 12345) >>> 0;
        return a >>> 24;
      });
      bytes.set([0xff, 0xd8, 0xff, 0xe1]);
      expect(() => jpegWithStoredOrientation(bytes)).not.toThrow();
    }
  });
});

describe('jpegWithStoredOrientation, bytes libjpeg skips', () => {
  const plain = encodeFlatJpeg(16, 8, BLOCKS);
  const exif = littleEndianExif(6);
  const cases: [string, number[]][] = [
    ['padding right after SOI', [0x00, 0x12, 0x34]],
    ['an FF00 pair and fill bytes before the segment', [0xff, 0x00, 0xff, 0xff, 0xff]],
    ['stray bytes between a segment and the Exif segment', [...jpegSegment(0xe0, [1, 2]), 0x55, 0xff, 0x00, 0x66]],
  ];
  it.each(cases)('resets an Exif orientation after %s', (_name, before) => {
    const bytes = Uint8Array.from([...plain.subarray(0, 2), ...before, ...exif, ...plain.subarray(2)]);
    expect(orientationOf(bytes)).toBe(6);
    expect(orientationOf(jpegWithStoredOrientation(bytes))).toBe(1);
  });

  it('does not read an FF00 pair as a segment with a length', () => {
    // Were FF00 read as a segment, 0x00 0x45 would be its length and the walk would jump over the Exif segment.
    const bytes = Uint8Array.from([...plain.subarray(0, 2), 0xff, 0x00, 0x00, 0x45, ...exif, ...plain.subarray(2)]);
    expect(orientationOf(jpegWithStoredOrientation(bytes))).toBe(1);
  });
});
