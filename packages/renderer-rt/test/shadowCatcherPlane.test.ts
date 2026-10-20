import { describe, expect, it } from 'vitest';
import { MAX_CATCHER_SIDE, shadowCatcherPlane } from '../src/shadowCatcherPlane';

const KEY = [0.39904, 0.79808, 0.4514] as const;
const box = (min: [number, number, number], max: [number, number, number]) => ({
  min,
  max,
  center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as [number, number, number],
  radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
});

describe('shadowCatcherPlane', () => {
  it('lies at the lowest point and covers footprint, shadow and margin', () => {
    const plane = shadowCatcherPlane(box([-1, 2, -1], [1, 10, 1]), KEY, 0.5)!;
    expect(plane.y).toBe(2);
    // The top corners' shadow reaches 8 / 0.79808 along -key from above; margin 4 (half of the height 8).
    const drop = 8 / KEY[1];
    expect(plane.rect[0]).toBeCloseTo(-1 - KEY[0] * drop - 4, 9);
    expect(plane.rect[1]).toBeCloseTo(-1 - KEY[2] * drop - 4, 9);
    expect(plane.rect[2]).toBeCloseTo(1 + 4, 9);
    expect(plane.rect[3]).toBeCloseTo(1 + 4, 9);
  });

  it('has four texels per finest model texel and caps each side', () => {
    const plane = shadowCatcherPlane(box([0, 0, 0], [2, 2, 2]), KEY, 1)!;
    expect(plane.width).toBe(Math.ceil((plane.rect[2] - plane.rect[0]) / 0.25));
    expect(plane.height).toBe(Math.ceil((plane.rect[3] - plane.rect[1]) / 0.25));
    const fine = shadowCatcherPlane(box([0, 0, 0], [2, 2, 2]), KEY, 1e-3)!;
    expect([fine.width, fine.height]).toEqual([MAX_CATCHER_SIDE, MAX_CATCHER_SIDE]);
    expect(fine.rect).toEqual(plane.rect);
  });

  it('gives an empty scene none', () => {
    expect(shadowCatcherPlane(null, KEY, 1)).toBeNull();
  });
});
