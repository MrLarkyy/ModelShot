import { describe, expect, it } from 'vitest';
import {
  MAX_ANIMATION_SCALE,
  MIN_ANIMATION_SCALE,
  animateScene,
  poseScene,
  type AnimationPlaybackOptions,
  type SceneAnimation,
  type SceneDocument,
} from '../src/index';
import { testDoc, testNode } from './sceneDocs';
import { expectCpuBelow } from './expectCpuBelow';

const SWING: SceneAnimation = {
  name: 'swing',
  loop: 'loop',
  length: 2,
  channels: [
    {
      node: 0,
      property: 'rotation',
      keyframes: [
        { time: 0, value: [0, 0, 0], interpolation: 'linear' },
        { time: 1, value: [90, 0, -30], interpolation: 'linear' },
        { time: 2, value: [0, 0, 0], interpolation: 'linear' },
      ],
    },
    {
      node: 1,
      property: 'translation',
      keyframes: [
        { time: 0, value: [0, 0, 0], interpolation: 'linear' },
        { time: 2, value: [4, -2, 8], interpolation: 'linear' },
      ],
    },
    {
      node: 1,
      property: 'scale',
      keyframes: [
        { time: 0, value: [1, 1, 1], interpolation: 'linear' },
        { time: 1, value: [0, 2, -1], interpolation: 'linear' },
        { time: 2, value: [1e5, 1, 1], interpolation: 'step' },
      ],
    },
  ],
};

function rig(animations: readonly SceneAnimation[] = [SWING, { ...SWING, name: 'once', loop: 'once' }]): SceneDocument {
  return {
    ...testDoc(
      [testNode(-1, { name: 'arm', rotation: [10, 20, 0], children: [1] }), testNode(0, { name: 'hand' })],
      [],
    ),
    animations,
  };
}

function failure(doc: SceneDocument, options: unknown): RangeError {
  try {
    animateScene(doc, options as AnimationPlaybackOptions);
  } catch (error) {
    if (error instanceof RangeError) return error;
    throw error;
  }
  throw new Error('expected a RangeError');
}

describe('animateScene', () => {
  it('adds rotation samples to rest and sets translation and scale', () => {
    const { document, clipTime } = animateScene(rig(), { animation: 0, time: 0.5 });
    expect(clipTime).toBe(0.5);
    expect(document.nodes[0]).toMatchObject({
      rotation: [55, 20, -15],
      translation: [0, 0, 0],
      restRotation: [10, 20, 0],
    });
    expect(document.nodes[0]?.scale).toBeUndefined();
    expect(document.nodes[1]).toMatchObject({
      rotation: [0, 0, 0],
      translation: [1, -0.5, 2],
      scale: [0.5, 1.5, MIN_ANIMATION_SCALE],
    });
  });

  it('clamps scale to a positive range', () => {
    expect(animateScene(rig(), { animation: 0, time: 1 }).document.nodes[1]?.scale).toEqual([
      MIN_ANIMATION_SCALE,
      2,
      MIN_ANIMATION_SCALE,
    ]);
    expect(animateScene(rig(), { animation: 0, time: 2, loop: 'hold' }).document.nodes[1]?.scale).toEqual([
      MAX_ANIMATION_SCALE,
      1,
      1,
    ]);
  });

  it('gives byte-identical nodes for the same time whatever was played before', () => {
    const doc = rig();
    const direct = animateScene(doc, { animation: 'swing', time: 0.7 }).document;
    let chained = doc;
    for (const time of [1.3, 0.2, 5.9, 1]) chained = animateScene(chained, { animation: 0, time }).document;
    const seeked = animateScene(chained, { animation: 0, time: 0.7 }).document;
    expect(JSON.stringify(seeked.nodes)).toBe(JSON.stringify(direct.nodes));
    expect(animateScene(direct, { animation: 0, time: 0.7 }).document).toEqual(direct);
  });

  it('never mutates its input', () => {
    const doc = rig();
    const before = JSON.stringify(doc);
    animateScene(doc, { animation: 0, time: 0.5 });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('records the playback, drops the pose, and null returns to rest', () => {
    const posed = poseScene(rig(), { name: 'p', bones: [{ bone: 'hand', rotation: [5, 0, 0] }] }).document;
    const { document } = animateScene(posed, { animation: 'swing', time: 3, loop: 'hold' });
    expect(document.pose).toBeUndefined();
    expect(document.playback).toEqual({ animation: 0, time: 3, loop: 'hold' });
    const rest = animateScene(document, null);
    expect(rest.clipTime).toBeNull();
    expect(rest.document.playback).toBeUndefined();
    expect(rest.document.nodes.map((n) => [n.rotation, n.translation, n.scale])).toEqual([
      [[10, 20, 0], [0, 0, 0], undefined],
      [[0, 0, 0], [0, 0, 0], undefined],
    ]);
  });

  it('a once animation past its end is at rest', () => {
    const { document, clipTime } = animateScene(rig(), { animation: 'once', time: 2.5 });
    expect(clipTime).toBeNull();
    expect(document.playback).toEqual({ animation: 1, time: 2.5, loop: 'once' });
    expect(document.nodes[1]?.scale).toBeUndefined();
    expect(document.nodes[0]?.rotation).toEqual([10, 20, 0]);
  });

  it.each([
    ['options that are not an object', 5, 'options'],
    ['an index out of range', { animation: 2, time: 0 }, 'options.animation'],
    ['an unknown name', { animation: 'walk', time: 0 }, 'options.animation'],
    ['a time that is not finite', { animation: 0, time: NaN }, 'options.time'],
    ['an unknown loop mode', { animation: 0, time: 0, loop: 'bounce' }, 'options.loop'],
  ])('rejects %s with a RangeError naming the path', (_name, options, path) => {
    expect(failure(rig(), options).message.startsWith(`${path}:`)).toBe(true);
  });

  const broken = (change: (channel: Record<string, unknown>) => void): SceneAnimation => {
    const channel = structuredClone(SWING.channels[0]) as unknown as Record<string, unknown>;
    change(channel);
    return { ...SWING, channels: [channel as unknown as SceneAnimation['channels'][number]] };
  };
  const keyframes = (channel: Record<string, unknown>) => channel.keyframes as Record<string, unknown>[];

  it.each([
    ['a node out of range', broken((c) => (c.node = 2)), 'animations[0].channels'],
    [
      'a NaN value',
      broken((c) => ((keyframes(c)[1] as { value: number[] }).value[0] = NaN)),
      'animations[0].channels[0].keyframes[1].value[0]',
    ],
    [
      'a huge value',
      broken((c) => ((keyframes(c)[2] as { before: number[] }).before = [0, 2e6, 0])),
      'animations[0].channels[0].keyframes[2].before[1]',
    ],
    [
      'unsorted keyframes',
      broken((c) => ((keyframes(c)[2] as { time: number }).time = 0.5)),
      'animations[0].channels[0].keyframes[2].time',
    ],
    [
      'a negative time',
      broken((c) => ((keyframes(c)[0] as { time: number }).time = -1)),
      'animations[0].channels[0].keyframes[0].time',
    ],
    [
      'an unknown interpolation',
      broken((c) => ((keyframes(c)[0] as { interpolation: string }).interpolation = 'bezier')),
      'animations[0].channels[0].keyframes[0].interpolation',
    ],
    ['no keyframes', broken((c) => (c.keyframes = [])), 'animations[0].channels[0].keyframes'],
    ['an unknown property', broken((c) => (c.property = 'shear')), 'animations[0].channels[0].property'],
    [
      'a second channel for the same node and property',
      { ...SWING, channels: [SWING.channels[1], SWING.channels[1]] } as SceneAnimation,
      'animations[0].channels[1]',
    ],
    ['an infinite length', { ...SWING, length: Infinity }, 'animations[0].length'],
  ])('rejects an animation with %s, naming the path', (_name, animation, path) => {
    expect(failure(rig([animation]), { animation: 0, time: 0 }).message.startsWith(`${path}`)).toBe(true);
  });

  it('checks the node range for every document the animation is played on', () => {
    expect(() => animateScene(rig(), { animation: 0, time: 0 })).not.toThrow();
    const smaller: SceneDocument = { ...rig(), nodes: rig().nodes.slice(0, 1), rootNodes: [0] };
    expect(failure(smaller, { animation: 0, time: 0 }).message).toContain('node 1');
  });

  it('samples 10 000 nodes × 3 channels × 100 keyframes per frame in bounded time', () => {
    const nodes = Array.from({ length: 10_000 }, () => testNode(-1));
    const keys = Array.from({ length: 100 }, (_, k) => ({
      time: k / 10,
      value: [k, -k, k / 2] as const,
      interpolation: k % 2 ? ('catmullrom' as const) : ('linear' as const),
    }));
    const channels = nodes.flatMap((_, node) =>
      (['rotation', 'translation', 'scale'] as const).map((property) => ({ node, property, keyframes: keys })),
    );
    const doc = { ...testDoc(nodes, []), animations: [{ name: 'big', loop: 'loop' as const, length: 10, channels }] };
    animateScene(doc, { animation: 0, time: 0 });
    // 200 ms of CPU per frame over three frames.
    expectCpuBelow(600, () => {
      for (const time of [0.15, 3.33, 7.77]) animateScene(doc, { animation: 0, time });
    });
  });
});
