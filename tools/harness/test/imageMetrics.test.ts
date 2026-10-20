import { describe, expect, it } from 'vitest';
import {
  backdropMask,
  hueMatch,
  modelBox,
  sentinelPixels,
  silhouetteMismatches,
  type Image,
} from '../src/imageMetrics';

/** A width x height image of the backdrop (20, 22, 26) with `paint` applied per pixel. */
function image(width: number, height: number, paint: (x: number, y: number) => number[] | null): Image {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...(paint(x, y) ?? [20, 22, 26]), 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

const square = (x0: number, y0: number, size: number, colour: number[]) => (x: number, y: number) =>
  x >= x0 && x < x0 + size && y >= y0 && y < y0 + size ? colour : null;

describe('image metrics', () => {
  it('finds the model box, the backdrop mask and magenta sentinel pixels', () => {
    const img = image(16, 16, square(4, 5, 3, [200, 40, 210]));
    expect(modelBox(img)).toEqual({ x0: 4, y0: 5, x1: 6, y1: 7 });
    expect(sentinelPixels(img)).toBe(9);
    expect(backdropMask(img).reduce((s, v) => s + v, 0)).toBe(256 - 9);
    expect(modelBox(image(4, 4, () => null)).x0).toBe(Infinity);
  });

  it('compares hues independent of brightness', () => {
    expect(hueMatch([200, 0, 0], [100, 0, 0])).toBeCloseTo(1, 9);
    expect(hueMatch([200, 0, 0], [0, 0, 200])).toBeCloseTo(0, 9);
  });

  it('counts framing mismatches off the silhouette only', () => {
    const reference = image(16, 16, square(4, 4, 6, [120, 90, 60]));
    // One pixel larger on two sides: every changed pixel touches the reference silhouette.
    const grown = image(16, 16, square(3, 3, 7, [118, 92, 61]));
    expect(silhouetteMismatches(reference, grown).mismatches).toBe(0);
    // Two pixels larger: the outer ring lies off the silhouette.
    const shifted = image(16, 16, square(2, 2, 8, [120, 90, 60]));
    expect(silhouetteMismatches(reference, shifted).mismatches).toBeGreaterThan(0);
    // A hole inside the model off the silhouette.
    const holed = image(16, 16, (x, y) => (x === 7 && y === 7 ? null : square(4, 4, 6, [120, 90, 60])(x, y)));
    expect(silhouetteMismatches(reference, holed).mismatches).toBe(1);
  });
});
