import type { SceneAnimation, SceneDocument } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { MAX_KEYFRAME_MARKERS } from '../src/timeline/keyframeTimes';
import { laneRows, MAX_LANES } from '../src/timeline/laneRows';

const key = (time: number, x = 0) => ({
  time,
  value: [x, 0, 0] as [number, number, number],
  interpolation: 'linear' as const,
});
const clip = (length: number, channels: SceneAnimation['channels']): SceneAnimation => ({
  name: 'c',
  loop: 'loop',
  length,
  channels,
});
const docOf = (nodes: number, names: (index: number) => string = (i) => `n${i}`) =>
  ({ nodes: Array.from({ length: nodes }, (_, i) => ({ name: names(i) })), meshes: [] }) as unknown as SceneDocument;

describe('laneRows', () => {
  it('has one row per animated node in node order, with the channels of a node merged', () => {
    const animation = clip(2, [
      { node: 2, property: 'rotation', keyframes: [key(0), key(1)] },
      { node: 0, property: 'rotation', keyframes: [key(0.5)] },
      { node: 0, property: 'translation', keyframes: [key(0.5), key(2)] },
    ]);
    const { rows, more } = laneRows(animation, docOf(3));
    expect(rows.map((row) => [row.node, row.name])).toEqual([
      [0, 'n0'],
      [2, 'n2'],
    ]);
    expect(rows[0]?.markers.map((m) => m.time)).toEqual([0.5, 2]);
    expect(rows[0]?.markers[0]?.title).toBe('0.50 s · rotation 0, 0, 0; translation 0, 0, 0');
    expect(more).toBe(0);
  });

  it('merges times closer than one pixel into one diamond', () => {
    const animation = clip(10, [{ node: 0, property: 'rotation', keyframes: [key(0), key(0.1), key(0.2), key(5)] }]);
    expect(laneRows(animation, docOf(1), new Map(), 1).rows[0]?.markers.map((m) => m.time)).toEqual([0, 5]);
  });

  it('leaves out times that are not numbers, negative or past the clip, and nodes that do not exist', () => {
    const animation = clip(1, [
      { node: 0, property: 'rotation', keyframes: [key(NaN), key(-1), key(0.5), key(3)] },
      { node: 7, property: 'rotation', keyframes: [key(0)] },
      { node: -1, property: 'rotation', keyframes: [key(0)] },
      { node: 0.5, property: 'scale', keyframes: [key(0)] },
    ]);
    const { rows } = laneRows(animation, docOf(2));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.markers.map((m) => m.time)).toEqual([0.5]);
  });

  it('takes the name as plain text: a rename wins over the file, a missing name gets a number', () => {
    const doc = docOf(2, (i) => (i === 0 ? '<img src=x onerror=alert(1)>' : ''));
    const animation = clip(1, [
      { node: 0, property: 'rotation', keyframes: [key(0)] },
      { node: 1, property: 'rotation', keyframes: [key(0)] },
    ]);
    expect(laneRows(animation, doc).rows.map((r) => r.name)).toEqual(['<img src=x onerror=alert(1)>', 'Group 2']);
    const renamed = new Map([['n:0', 'Hips']]);
    expect(laneRows(animation, doc, renamed).rows[0]?.name).toBe('Hips');
  });

  it('caps the lanes and counts the rest', () => {
    const channels = Array.from({ length: MAX_LANES + 25 }, (_, node) => ({
      node,
      property: 'rotation' as const,
      keyframes: [key(0)],
    }));
    const { rows, more } = laneRows(clip(1, channels), docOf(MAX_LANES + 25));
    expect(rows).toHaveLength(MAX_LANES);
    expect(more).toBe(25);
  });

  it('caps the diamonds over all lanes', () => {
    const keyframes = Array.from({ length: 300 }, (_, i) => key(i / 1000));
    const channels = Array.from({ length: 20 }, (_, node) => ({ node, property: 'rotation' as const, keyframes }));
    const { rows } = laneRows(clip(1, channels), docOf(20));
    expect(rows.reduce((sum, row) => sum + row.markers.length, 0)).toBeLessThanOrEqual(MAX_KEYFRAME_MARKERS);
  });

  it('a clip of length 0 keeps its lanes with the keyframes at 0', () => {
    const { rows } = laneRows(clip(0, [{ node: 0, property: 'rotation', keyframes: [key(0), key(1)] }]), docOf(1));
    expect(rows[0]?.markers.map((m) => m.time)).toEqual([0]);
  });
});
