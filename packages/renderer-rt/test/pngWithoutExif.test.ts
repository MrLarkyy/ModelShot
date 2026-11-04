import { describe, expect, it } from 'vitest';
import { encodeFlatPng, exifOrientationData, pngChunk } from '../../formats/test/fixtures/jpeg/encodeFlatPng.mjs';
import { pngWithoutExif } from '../src/pngWithoutExif';

const COLOURS: [number, number, number][] = [
  [220, 40, 40],
  [40, 60, 220],
];

function types(bytes: Uint8Array): string[] {
  const out: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 12 <= bytes.length; at += 12 + view.getUint32(at)) {
    out.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
  }
  return out;
}

describe('pngWithoutExif', () => {
  it('drops every eXIf chunk whole and keeps all other bytes, in a copy', () => {
    const tagged = encodeFlatPng(16, 8, COLOURS, { exifOrientation: 6 });
    const plain = encodeFlatPng(16, 8, COLOURS);
    const before = tagged.slice();
    const stripped = pngWithoutExif(tagged);
    expect(types(tagged)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
    expect(stripped).toEqual(plain);
    expect(tagged).toEqual(before);
    expect(stripped.buffer).not.toBe(tagged.buffer);
  });

  it('drops several eXIf chunks, also after the image data', () => {
    const tagged = encodeFlatPng(16, 8, COLOURS, { exifOrientation: 8 });
    const iend = tagged.length - 12;
    const two = Uint8Array.from([
      ...tagged.subarray(0, iend),
      ...pngChunk('eXIf', exifOrientationData(3)),
      ...tagged.subarray(iend),
    ]);
    expect(types(pngWithoutExif(two))).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('copies a PNG without eXIf unchanged', () => {
    const plain = encodeFlatPng(16, 8, COLOURS);
    expect(pngWithoutExif(plain)).toEqual(plain);
  });

  it('stops at a chunk length past the bytes, a truncated chunk or bytes cut mid-header, copying the rest', () => {
    const tagged = encodeFlatPng(16, 8, COLOURS, { exifOrientation: 6 });
    const huge = Uint8Array.from([...tagged.subarray(0, 33), 0xff, 0xff, 0xff, 0xff, ...tagged.subarray(37)]);
    expect(pngWithoutExif(huge)).toEqual(huge);
    expect(pngWithoutExif(tagged.subarray(0, 40))).toEqual(tagged.subarray(0, 40));
    expect(pngWithoutExif(tagged.subarray(0, 20))).toEqual(tagged.subarray(0, 20));
    expect(pngWithoutExif(new Uint8Array(0))).toEqual(new Uint8Array(0));
    // An eXIf chunk cut short is never dropped: its length reaches past the bytes.
    const cut = tagged.subarray(0, 33 + 12 + 10);
    expect(pngWithoutExif(cut)).toEqual(cut);
  });

  it('does not read through a view into a larger buffer', () => {
    const tagged = encodeFlatPng(16, 8, COLOURS, { exifOrientation: 6 });
    const larger = new Uint8Array(tagged.length + 20).fill(0xee);
    larger.set(tagged, 10);
    expect(pngWithoutExif(larger.subarray(10, 10 + tagged.length))).toEqual(encodeFlatPng(16, 8, COLOURS));
  });

  it('never throws and never grows on random bytes', () => {
    let a = 11;
    for (let n = 0; n < 2000; n++) {
      const bytes = Uint8Array.from({ length: 8 + (n % 90) }, () => {
        a = (Math.imul(a, 1103515245) + 12345) >>> 0;
        return a >>> 24;
      });
      expect(pngWithoutExif(bytes).length).toBeLessThanOrEqual(bytes.length);
    }
  });
});
