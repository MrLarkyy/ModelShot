import { describe, expect, it } from 'vitest';
import { canvasSize } from '../src/index';

const limits = { maxWidth: 4096, maxHeight: 4096 };

describe('canvasSize', () => {
  it('multiplies the CSS size by the pixel ratio', () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      expect(canvasSize({ cssWidth: 300, cssHeight: 200, devicePixelRatio: dpr }, limits)).toEqual({
        width: 300 * dpr,
        height: 200 * dpr,
      });
    }
  });

  it('rounds fractional CSS sizes', () => {
    expect(canvasSize({ cssWidth: 100.4, cssHeight: 50.6, devicePixelRatio: 1.5 }, limits)).toEqual({
      width: 151,
      height: 76,
    });
  });

  it('prefers the exact device-pixel box where it settles rounding', () => {
    const size = {
      cssWidth: 100.4,
      cssHeight: 50.3,
      devicePixelRatio: 1.5,
      devicePixelWidth: 150,
      devicePixelHeight: 76,
    };
    expect(canvasSize(size, limits)).toEqual({ width: 150, height: 76 });
  });

  it('ignores a device-pixel box that disagrees with CSS size x ratio (emulated ratios)', () => {
    const size = { cssWidth: 256, cssHeight: 256, devicePixelRatio: 2, devicePixelWidth: 256, devicePixelHeight: 256 };
    expect(canvasSize(size, limits)).toEqual({ width: 512, height: 512 });
  });

  it('scales down to the GPU limits and the pixel cap keeping the aspect', () => {
    expect(canvasSize({ cssWidth: 4000, cssHeight: 1000, devicePixelRatio: 2 }, limits)).toEqual({
      width: 4096,
      height: 1024,
    });
    const capped = canvasSize(
      { cssWidth: 1600, cssHeight: 900, devicePixelRatio: 2 },
      { ...limits, maxPixels: 1_000_000 },
    );
    expect(capped.width * capped.height).toBeLessThanOrEqual(1_000_000);
    expect(capped.width / capped.height).toBeCloseTo(16 / 9, 2);
  });

  it('never returns 0, NaN or a negative size', () => {
    for (const [w, h, dpr] of [
      [0, 0, 1],
      [-5, 10, 2],
      [NaN, Infinity, NaN],
      [10, 10, 0],
    ] as const) {
      const size = canvasSize({ cssWidth: w, cssHeight: h, devicePixelRatio: dpr }, limits);
      expect(size.width).toBeGreaterThanOrEqual(1);
      expect(size.height).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(size.width) && Number.isInteger(size.height)).toBe(true);
    }
    expect(canvasSize({ cssWidth: 0, cssHeight: 0, devicePixelRatio: 2 }, limits)).toEqual({ width: 1, height: 1 });
  });
});
