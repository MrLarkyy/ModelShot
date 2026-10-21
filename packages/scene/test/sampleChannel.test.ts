import { describe, expect, it } from 'vitest';
import type { SceneInterpolation, SceneKeyframe, Vec3 } from '../src/index';
import { sampleChannel } from '../src/sampleChannel';

function key(time: number, x: number, interpolation: SceneInterpolation = 'linear', before?: number): SceneKeyframe {
  const value: Vec3 = [x, 2 * x, -x];
  return before === undefined
    ? { time, value, interpolation }
    : { time, value, before: [before, 2 * before, -before], interpolation };
}

/** The x component; y and z are 2x and −x by construction, checked once below. */
const x = (keyframes: readonly SceneKeyframe[], time: number, wrap = false): number =>
  sampleChannel(keyframes, time, wrap)[0];

/** three.js CatmullRom, written out independently of the implementation. */
function closedForm(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const m1 = (p2 - p0) / 2;
  const m2 = (p3 - p1) / 2;
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
  const h10 = t ** 3 - 2 * t ** 2 + t;
  const h01 = -2 * t ** 3 + 3 * t ** 2;
  const h11 = t ** 3 - t ** 2;
  return h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
}

describe('sampleChannel', () => {
  it('interpolates every axis the same way', () => {
    expect(sampleChannel([key(0, 0), key(2, 10)], 0.5)).toEqual([2.5, 5, -2.5]);
  });

  it('linear to linear and linear to step interpolate linearly', () => {
    expect(x([key(0, 0), key(2, 10)], 1.5)).toBe(7.5);
    expect(x([key(0, 0), key(2, 10, 'step')], 0.5)).toBe(2.5);
  });

  it('step holds the value until the next keyframe', () => {
    const keys = [key(0, 1, 'step'), key(1, 5)];
    expect(x(keys, 0.999)).toBe(1);
    expect(x(keys, 1)).toBe(5);
  });

  it('before the first keyframe gives what arrives there, after the last its value', () => {
    const keys = [key(1, 4, 'linear', 3), key(2, 8, 'linear', 7)];
    expect(x(keys, 0)).toBe(3);
    expect(x(keys, 2.5)).toBe(8);
  });

  it('a single keyframe is constant', () => {
    expect(x([key(0.5, 6)], 0)).toBe(6);
    expect(x([key(0.5, 6)], 9)).toBe(6);
  });

  it('a pre/post split keyframe is arrived at with before and left with value', () => {
    const keys = [key(0, 0), key(1, 10, 'linear', 2), key(2, 20)];
    expect(x(keys, 0.5)).toBe(1);
    expect(x(keys, 1)).toBe(2);
    expect(x(keys, 1.5)).toBe(15);
  });

  it('equal times: reached at the first, left from the last', () => {
    const keys = [key(0, 0), key(1, 4), key(1, 8), key(2, 0)];
    expect(x(keys, 0.5)).toBe(2);
    expect(x(keys, 1)).toBe(4);
    expect(x(keys, 1.5)).toBe(4);
  });

  it('catmull-rom between inner keyframes uses both neighbours', () => {
    const keys = [key(0, 0, 'catmullrom'), key(1, 3, 'catmullrom'), key(2, 4, 'catmullrom'), key(3, 10, 'catmullrom')];
    for (const t of [1.1, 1.25, 1.5, 1.9]) expect(x(keys, t)).toBeCloseTo(closedForm(t - 1, 0, 3, 4, 10), 12);
  });

  it('catmull-rom repeats the segment end where a neighbour is missing', () => {
    const keys = [key(0, 0, 'catmullrom'), key(1, 3, 'catmullrom'), key(2, 4, 'catmullrom')];
    expect(x(keys, 0.25)).toBeCloseTo(closedForm(0.25, 0, 0, 3, 4), 12);
    expect(x(keys, 1.75)).toBeCloseTo(closedForm(0.75, 0, 3, 4, 4), 12);
    const two = [key(0, 0, 'catmullrom'), key(2, 8, 'catmullrom')];
    expect(x(two, 0.5)).toBeCloseTo(closedForm(0.25, 0, 0, 8, 8), 12);
  });

  it('catmull-rom applies when either end is catmull-rom', () => {
    const keys = [key(0, 0), key(1, 3, 'catmullrom'), key(2, 4), key(3, 10)];
    expect(x(keys, 0.5)).toBeCloseTo(closedForm(0.5, 0, 0, 3, 4), 12);
    expect(x(keys, 1.5)).toBeCloseTo(closedForm(0.5, 0, 3, 4, 10), 12);
    expect(x(keys, 2.5)).toBe(7);
  });

  it('catmull-rom skips the neighbour behind a pre/post split and uses the split values', () => {
    const keys = [
      key(0, 0, 'catmullrom'),
      key(1, 3, 'catmullrom', 1),
      key(2, 4, 'catmullrom', 6),
      key(3, 10, 'catmullrom'),
    ];
    // Segment 1..2: from value 3 to before 6; both ends split, so no neighbours.
    expect(x(keys, 1.5)).toBeCloseTo(closedForm(0.5, 3, 3, 6, 6), 12);
  });

  it('wraps catmull-rom neighbours in loop mode with three or more keyframes', () => {
    const keys = [key(0, 0, 'catmullrom'), key(1, 5, 'catmullrom'), key(2, 2, 'catmullrom'), key(3, 0, 'catmullrom')];
    expect(x(keys, 0.5, true)).toBeCloseTo(closedForm(0.5, 2, 0, 5, 2), 12);
    expect(x(keys, 2.5, true)).toBeCloseTo(closedForm(0.5, 5, 2, 0, 5), 12);
    expect(x(keys, 0.5, false)).toBeCloseTo(closedForm(0.5, 0, 0, 5, 2), 12);
    const two = [key(0, 0, 'catmullrom'), key(2, 8, 'catmullrom')];
    expect(x(two, 0.5, true)).toBe(x(two, 0.5, false));
  });

  it('is exact at keyframes for every pair rule', () => {
    const keys = [key(0, 1, 'catmullrom'), key(1, 7, 'step'), key(2, -3), key(3, 9, 'catmullrom', 4)];
    expect(keys.map((k) => x(keys, k.time))).toEqual([1, 7, -3, 4]);
  });
});
