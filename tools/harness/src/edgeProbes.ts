import { PNG } from 'pngjs';
import type { Image } from './imageMetrics';

type Point2 = readonly [number, number];

/** 1 where `a` and `b` differ in a colour channel, else 0. */
export function differenceMask(a: Image, b: Image): Uint8Array {
  const mask = new Uint8Array(a.width * a.height);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) mask[p] = 1;
  }
  return mask;
}

/** Distance from `p` to the segment `a`-`b`. */
export function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const ab = [b[0] - a[0], b[1] - a[1]] as const;
  const length2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / length2)) : 0;
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
}

/**
 * Pixels set in `mask` whose centre lies farther than `limit` from every segment (image positions, top-left origin):
 * the changed pixels that are not near any edge.
 */
export function pixelsFarFrom(
  mask: Uint8Array,
  width: number,
  segments: readonly (readonly [Point2, Point2])[],
  limit: number,
): number {
  let far = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const centre: Point2 = [(p % width) + 0.5, Math.floor(p / width) + 0.5];
    if (segments.every(([a, b]) => segmentDistance(centre, a, b) > limit)) far++;
  }
  return far;
}

/** `actual` with every pixel outside `mask` taken from `expected`, as a PNG: a comparison then sees the mask only. */
export function maskedPng(actual: Image, expected: Image, mask: Uint8Array): Buffer {
  const png = new PNG({ width: actual.width, height: actual.height });
  for (let p = 0; p < mask.length; p++) {
    const source = mask[p] ? actual : expected;
    source.data.copy(png.data, p * 4, p * 4, p * 4 + 4);
  }
  return PNG.sync.write(png);
}
