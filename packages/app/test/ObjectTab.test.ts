import type { SceneAnimation } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { nodeKeyframeTimes } from '../src/inspector/ObjectTab';

const clip: SceneAnimation = {
  name: 'walk',
  loop: 'loop',
  length: 2,
  channels: [
    {
      node: 1,
      property: 'rotation',
      keyframes: [
        { time: 0, value: [0, 0, 0], interpolation: 'linear' },
        { time: 1, value: [10, 0, 0], interpolation: 'linear' },
      ],
    },
    {
      node: 1,
      property: 'translation',
      keyframes: [
        { time: 0.5, value: [0, 1, 0], interpolation: 'linear' },
        { time: 1, value: [0, 2, 0], interpolation: 'linear' },
      ],
    },
    {
      node: 2,
      property: 'rotation',
      keyframes: [{ time: 1.5, value: [0, 0, 5], interpolation: 'linear' }],
    },
  ],
};

describe('nodeKeyframeTimes', () => {
  it('lists the distinct keyframe times of the channels that move the node, ascending', () => {
    expect(nodeKeyframeTimes(clip, 1)).toEqual([0, 0.5, 1]);
    expect(nodeKeyframeTimes(clip, 2)).toEqual([1.5]);
  });

  it('is empty for a node no channel moves', () => {
    expect(nodeKeyframeTimes(clip, 0)).toEqual([]);
  });
});
