import { describe, expect, it } from 'vitest';
import {
  MAX_ANIMATION_FRAMES,
  MAX_PLAYBACK_FPS,
  animationFrameCount,
  animationFrameTimes,
  animationTime,
} from '../src/index';

const clip = (length: number, loop: 'once' | 'hold' | 'loop') => ({ length, loop });

describe('animationTime', () => {
  it('loop wraps, hold stops at the end, once ends with null', () => {
    expect(animationTime(clip(2, 'loop'), 5.5)).toBe(1.5);
    expect(animationTime(clip(2, 'loop'), 2)).toBe(0);
    expect(animationTime(clip(2, 'hold'), 5.5)).toBe(2);
    expect(animationTime(clip(2, 'hold'), 1.25)).toBe(1.25);
    expect(animationTime(clip(2, 'once'), 2)).toBe(2);
    expect(animationTime(clip(2, 'once'), 2.01)).toBeNull();
  });

  it('takes a loop mode that overrides the animation', () => {
    expect(animationTime(clip(2, 'once'), 3, 'loop')).toBe(1);
    expect(animationTime(clip(2, 'loop'), 3, 'hold')).toBe(2);
  });

  it('counts negative time as 0 and keeps a zero-length clip at 0', () => {
    for (const loop of ['once', 'hold', 'loop'] as const) expect(animationTime(clip(2, loop), -1)).toBe(0);
    expect(animationTime(clip(0, 'loop'), 7)).toBe(0);
    expect(animationTime(clip(0, 'hold'), 7)).toBe(0);
    expect(animationTime(clip(0, 'once'), 0)).toBe(0);
    expect(animationTime(clip(0, 'once'), 7)).toBeNull();
  });

  it('rejects a time that is not finite', () => {
    for (const time of [NaN, Infinity, '1' as unknown as number]) {
      expect(() => animationTime(clip(2, 'loop'), time)).toThrow(RangeError);
    }
  });
});

describe('animationFrameTimes', () => {
  it('computes every time from its index', () => {
    const times = animationFrameTimes(clip(2, 'loop'), 30);
    expect(times[29]).toBe(29 / 30);
    times.forEach((time, i) => expect(time).toBe(i / 30));
  });

  it('loop leaves out the wrap frame; hold and once include the last', () => {
    expect(animationFrameTimes(clip(2, 'loop'), 30)).toHaveLength(60);
    expect(animationFrameTimes(clip(2, 'hold'), 30)).toHaveLength(61);
    expect(animationFrameTimes(clip(2, 'once'), 30)).toHaveLength(61);
    expect(animationFrameTimes(clip(2, 'once'), 30).at(-1)).toBe(2);
    // 2.4 · 30 is 71.99999999999999 in floating point; the last frame (t = 2.4) still counts.
    expect(animationFrameTimes(clip(2.4, 'hold'), 30)).toHaveLength(73);
    expect(animationFrameTimes(clip(0.01, 'loop'), 24)).toEqual([0]);
    expect(animationFrameTimes(clip(0, 'once'), 24)).toEqual([0]);
    expect(animationFrameTimes(clip(2, 'loop'), 30, 'hold')).toHaveLength(61);
  });

  it('rejects a bad frame rate or too many frames', () => {
    for (const fps of [0, -1, NaN, Infinity, MAX_PLAYBACK_FPS + 1]) {
      expect(() => animationFrameTimes(clip(1, 'loop'), fps)).toThrow(RangeError);
    }
    expect(animationFrameTimes(clip(60, 'loop'), MAX_PLAYBACK_FPS)).toHaveLength(MAX_ANIMATION_FRAMES);
    expect(() => animationFrameTimes(clip(60, 'hold'), MAX_PLAYBACK_FPS)).toThrow(RangeError);
    expect(() => animationFrameTimes(clip(1e6, 'loop'), 24)).toThrow(RangeError);
  });
});

describe('animationFrameCount', () => {
  it('counts the frames animationFrameTimes gives, without its limits', () => {
    for (const [length, fps] of [
      [2, 30],
      [2.4, 30],
      [0, 24],
      [0.3, 7],
    ] as const) {
      for (const loop of ['once', 'hold', 'loop'] as const) {
        expect(animationFrameCount(clip(length, loop), fps), `${length} ${fps} ${loop}`).toBe(
          animationFrameTimes(clip(length, loop), fps).length,
        );
      }
    }
    expect(animationFrameCount(clip(2, 'loop'), 10, 'hold')).toBe(21);
    expect(animationFrameCount(clip(1e6, 'loop'), 24)).toBe(24e6);
  });
});
