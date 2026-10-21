import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { differenceMask, maskedPng, pixelsFarFrom, segmentDistance } from '../src/edgeProbes';
import type { Image } from '../src/imageMetrics';

function image(width: number, height: number, value: (p: number) => number): Image {
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([value(p), 0, 0, 255], p * 4);
  return { width, height, data };
}

describe('edge probes', () => {
  it('marks differing pixels and finds those far from every segment', () => {
    const a = image(4, 4, () => 10);
    const b = image(4, 4, (p) => (p === 0 || p === 15 ? 11 : 10));
    const mask = differenceMask(a, b);
    expect([...mask].reduce((s, v) => s + v, 0)).toBe(2);
    // A segment along the top row: pixel 0 is near it, pixel 15 (bottom right) is not.
    expect(
      pixelsFarFrom(
        mask,
        4,
        [
          [
            [0, 0],
            [4, 0],
          ],
        ],
        1,
      ),
    ).toBe(1);
    expect(
      pixelsFarFrom(
        mask,
        4,
        [
          [
            [0, 0],
            [4, 0],
          ],
        ],
        4,
      ),
    ).toBe(0);
  });

  it('measures the distance to a segment, its ends included', () => {
    expect(segmentDistance([1, 1], [0, 0], [2, 0])).toBe(1);
    expect(segmentDistance([5, 0], [0, 0], [2, 0])).toBe(3);
    expect(segmentDistance([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it('keeps the masked pixels of one image and the rest of the other', () => {
    const a = image(2, 1, () => 200);
    const b = image(2, 1, () => 50);
    const out = PNG.sync.read(maskedPng(a, b, new Uint8Array([1, 0])));
    expect([out.data[0], out.data[4]]).toEqual([200, 50]);
  });
});
