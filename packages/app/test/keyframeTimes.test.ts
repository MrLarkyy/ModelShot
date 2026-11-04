import type { SceneAnimation } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { keyframeTimes, MAX_KEYFRAME_MARKERS } from '../src/timeline/keyframeTimes';

const key = (time: number) => ({
  time,
  value: [0, 0, 0] as [number, number, number],
  interpolation: 'linear' as const,
});
const clip = (length: number, ...channels: number[][]): SceneAnimation => ({
  name: 'c',
  loop: 'loop',
  length,
  channels: channels.map((times) => ({ node: 0, property: 'rotation' as const, keyframes: times.map(key) })),
});

describe('keyframeTimes', () => {
  it('merges the channels into sorted unique times and counts them', () => {
    const markers = keyframeTimes(clip(2, [0, 1, 2], [0.5, 1]));
    expect(markers.times).toEqual([0, 0.5, 1, 2]);
    expect(markers.count).toBe(4);
  });

  it('leaves out keyframes past the clip and bad times', () => {
    expect(keyframeTimes(clip(1, [0, 0.5, 3, NaN, -1])).times).toEqual([0, 0.5]);
  });

  it('merges markers closer than the gap but still counts every keyframe', () => {
    const markers = keyframeTimes(clip(10, [0, 0.1, 0.2, 5]), 1);
    expect(markers.times).toEqual([0, 5]);
    expect(markers.count).toBe(4);
  });

  it('caps a flood of keyframes', () => {
    const times = Array.from({ length: MAX_KEYFRAME_MARKERS + 500 }, (_, i) => i / 10_000);
    expect(keyframeTimes(clip(1, times)).times).toHaveLength(MAX_KEYFRAME_MARKERS);
  });
});
