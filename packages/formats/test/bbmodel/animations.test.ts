import { describe, expect, it } from 'vitest';
import { animateScene } from '@modelshot/scene';
import { BbmodelError, MAX_BBMODEL_WARNINGS, loadBbmodel, type BbmodelLoadOptions } from '../../src/index';
import { cube, fixture, model } from './fixtures';
import { expectCpuBelow } from '../support/expectCpuBelow';

const ARM = '0b0d1e5a-0000-4000-8000-00000000a001';
const LEG = '0b0d1e5a-0000-4000-8000-00000000a002';

/**
 * A model with groups `arm` (uuid ARM) and `Leg` (uuid LEG) and `animations`; format 5.0 (keyframes as stored) unless
 * `meta` says otherwise.
 */
function rigged(animations: unknown, meta: Record<string, unknown> = {}): string {
  return JSON.stringify(
    model({
      meta: { format_version: '5.0', model_format: 'free', box_uv: false, ...meta },
      outliner: [
        { name: 'arm', origin: [0, 4, 0], uuid: ARM, children: ['c0'] },
        { name: 'Leg', origin: [0, 0, 0], uuid: LEG, children: [] },
      ],
      animations,
    }),
  );
}

const keyframe = (channel: string, time: number, x: unknown, y: unknown = 0, z: unknown = 0, extra = {}) => ({
  channel,
  time,
  data_points: [{ x, y, z }],
  interpolation: 'linear',
  ...extra,
});

function animation(animators: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { name: 'a', loop: 'loop', length: 1, animators, ...extra };
}

function failure(input: string, options?: BbmodelLoadOptions): BbmodelError {
  try {
    loadBbmodel(input, options);
  } catch (error) {
    if (error instanceof BbmodelError) return error;
    throw error;
  }
  throw new Error('expected loading to fail');
}

describe('bbmodel animations', () => {
  const axes = [
    animation({
      [ARM]: {
        keyframes: [
          keyframe('rotation', 0, 10, 20, 30),
          keyframe('position', 0, 1, 2, 3),
          keyframe('scale', 0, 2, 3, 4),
          {
            ...keyframe('rotation', 0.5, 0),
            data_points: [
              { x: 1, y: 2, z: 3 },
              { x: 0, y: '-5', z: 6 },
            ],
          },
        ],
      },
    }),
  ];
  const values = (text: string) =>
    loadBbmodel(text).scene.animations?.[0]?.channels.map((c) => [c.property, c.keyframes.at(-1)]);

  it('takes keyframes of a format 5.0 file as stored: Blockbench adds them to the bone in the group convention', () => {
    expect(values(rigged(axes))).toEqual([
      ['rotation', { time: 0.5, value: [0, -5, 6], before: [1, 2, 3], interpolation: 'linear' }],
      ['translation', { time: 0, value: [1, 2, 3], interpolation: 'linear' }],
      ['scale', { time: 0, value: [2, 3, 4], interpolation: 'linear' }],
    ]);
  });

  it.each(['4.10', '4.5', '3.6'])(
    'negates rotation x, y and position x of a format %s file, as Blockbench 5 imports it',
    (version) => {
      const { scene, warnings } = loadBbmodel(rigged(axes, { format_version: version }));
      expect(warnings).toEqual([]);
      const [rotation, translation, scale] = scene.animations?.[0]?.channels ?? [];
      expect(rotation?.keyframes).toEqual([
        { time: 0, value: [-10, -20, 30], interpolation: 'linear' },
        { time: 0.5, value: [0, 5, 6], before: [-1, -2, 3], interpolation: 'linear' },
      ]);
      // A zero stays +0, so a flipped document compares equal to a hand-written one.
      expect(Object.is(rotation?.keyframes[1]?.value[0], 0)).toBe(true);
      expect(translation?.keyframes[0]?.value).toEqual([-1, 2, 3]);
      expect(scale?.keyframes[0]?.value).toEqual([2, 3, 4]);
    },
  );

  it('negates the pre-3.7 `bones` form too', () => {
    const old = { name: 'old', bones: { arm: [{ channel: 'rotation', time: 0, x: 10, y: 20, z: 30 }] } };
    const { scene } = loadBbmodel(rigged([old], { format_version: '3.6' }));
    expect(scene.animations?.[0]?.channels[0]?.keyframes[0]?.value).toEqual([-10, -20, 30]);
  });

  it('resolves animators by uuid, then a non-uuid key by group name ignoring case', () => {
    const { scene, warnings } = loadBbmodel(
      rigged([
        animation({
          leg: { keyframes: [keyframe('rotation', 0, 1)] },
          [ARM]: { name: 'Leg', keyframes: [keyframe('rotation', 0, 2)] },
        }),
      ]),
    );
    expect(warnings).toEqual([]);
    expect(scene.animations?.[0]?.channels.map((c) => [c.node, c.keyframes[0]?.value[0]])).toEqual([
      [1, 1],
      [0, 2],
    ]);
  });

  it('reports a uuid key without its group even when a group has the animator name', () => {
    const missing = '0b0d1e5a-0000-4000-8000-00000000ffff';
    const { scene, warnings } = loadBbmodel(
      rigged([animation({ [missing]: { name: 'arm', keyframes: [keyframe('rotation', 0, 1)] } })]),
    );
    expect(scene.animations?.[0]?.channels).toEqual([]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['UNKNOWN_REFERENCE', `$.animations[0].animators.${missing}`],
    ]);
  });

  it('reads the pre-3.7 forms: `bones` and an animator that is a keyframe array, values on the keyframe', () => {
    const old = { name: 'old', loop: 'hold', bones: { arm: [{ channel: 'scale', time: 0.5, x: '2', y: 3 }] } };
    const { scene, warnings } = loadBbmodel(rigged([old]));
    expect(warnings).toEqual([]);
    expect(scene.animations).toEqual([
      {
        name: 'old',
        loop: 'hold',
        length: 0.5,
        channels: [
          { node: 0, property: 'scale', keyframes: [{ time: 0.5, value: [2, 3, 1], interpolation: 'linear' }] },
        ],
      },
    ]);
  });

  it('a later animator of the same bone replaces the earlier one', () => {
    const { scene } = loadBbmodel(
      rigged([
        animation({
          [ARM]: { keyframes: [keyframe('rotation', 0, 1), keyframe('scale', 0, 2)] },
          arm: { keyframes: [keyframe('position', 0, 3)] },
        }),
      ]),
    );
    expect(scene.animations?.[0]?.channels.map((c) => c.property)).toEqual(['translation']);
  });

  it('keeps pre and post data points and sorts keyframes stably', () => {
    const split = {
      ...keyframe('rotation', 0.5, 0),
      data_points: [
        { x: 1, y: 0, z: 0 },
        { x: '2', y: '', z: ' -3 ' },
      ],
    };
    const { scene } = loadBbmodel(
      rigged([animation({ [ARM]: { keyframes: [keyframe('rotation', 2, 9), split, keyframe('rotation', 0.5, 4)] } })]),
    );
    const [animated] = scene.animations ?? [];
    expect(animated?.channels[0]?.keyframes).toEqual([
      { time: 0.5, value: [2, 0, -3], before: [1, 0, 0], interpolation: 'linear' },
      { time: 0.5, value: [4, 0, 0], interpolation: 'linear' },
      { time: 2, value: [9, 0, 0], interpolation: 'linear' },
    ]);
  });

  it("keeps the file's length past which a trailing catmull-rom keyframe shapes the loop", () => {
    const catmullrom = { interpolation: 'catmullrom' };
    const keyframes = [0, 1, 2.5].map((time) => keyframe('rotation', time, time * 10, 0, 0, catmullrom));
    const { scene } = loadBbmodel(rigged([animation({ [ARM]: { keyframes } }, { length: 2 })]));
    expect(scene.animations?.[0]?.length).toBe(2);
    // Period 2: the third repetition starts at 4 exactly as the first did at 0.
    const at = (time: number) => animateScene(scene, { animation: 0, time });
    expect(at(4.25).clipTime).toBeCloseTo(0.25, 12);
    expect(at(4.25).document.nodes[0]?.rotation).toEqual(at(0.25).document.nodes[0]?.rotation);
  });

  it.each([
    ['missing', {}],
    ['zero', { length: 0 }],
  ])('plays to the last keyframe when the length is %s', (_name, extra) => {
    const keyframes = [keyframe('rotation', 0, 0), keyframe('rotation', 1.5, 9)];
    const { scene } = loadBbmodel(rigged([{ name: 'a', loop: 'loop', animators: { [ARM]: { keyframes } }, ...extra }]));
    expect(scene.animations?.[0]?.length).toBe(1.5);
  });

  it('leaves `animations` out when the file has none', () => {
    expect('animations' in loadBbmodel(rigged(undefined)).scene).toBe(false);
    expect('animations' in loadBbmodel(rigged([])).scene).toBe(false);
  });

  it('reports each unsupported kind exactly once, with its path', () => {
    const { warnings } = loadBbmodel(fixture('animated-unsupported'));
    const keys = warnings.map((w) => `${w.code} ${w.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    const base = '$.animations[0]';
    const bone = `${base}.animators.0b0d1e5a-0000-4000-8000-0000000000b1`;
    expect(keys).toEqual([
      `UNSUPPORTED_VALUE ${base}.anim_time_update`,
      `UNSUPPORTED_VALUE ${base}.start_delay`,
      `UNSUPPORTED_VALUE ${base}.blend_weight`,
      `UNSUPPORTED_CHANNEL ${base}.animators.effects.sound`,
      `UNSUPPORTED_CHANNEL ${base}.animators.effects.particle`,
      `UNSUPPORTED_CHANNEL ${base}.animators.effects.timeline`,
      `UNSUPPORTED_CHANNEL ${base}.animators.0b0d1e5a-0000-4000-8000-0000000000c1.position`,
      `UNSUPPORTED_CHANNEL ${bone}.rotation_global`,
      `UNSUPPORTED_CHANNEL ${bone}.quaternion_interpolation`,
      `UNSUPPORTED_CHANNEL ${bone}.keyframes[1]`,
      `UNSUPPORTED_CHANNEL ${bone}.keyframes[2].interpolation`,
      `UNSUPPORTED_VALUE ${bone}.keyframes[3]`,
      `UNSUPPORTED_CHANNEL ${bone}.squish`,
      `UNKNOWN_REFERENCE ${base}.animators.0b0d1e5a-0000-4000-8000-0000000000ff`,
    ]);
  });

  it('warns once for a whole channel of Molang or bezier keyframes and skips only the Molang ones', () => {
    const keyframes = Array.from({ length: 50 }, (_, i) =>
      i % 2
        ? keyframe('rotation', i, 'q.anim_time * 2')
        : keyframe('rotation', i, i, 0, 0, { interpolation: 'bezier' }),
    );
    const { scene, warnings } = loadBbmodel(rigged([animation({ [ARM]: { keyframes } })]));
    expect(warnings.map((w) => w.code)).toEqual(['UNSUPPORTED_CHANNEL', 'UNSUPPORTED_CHANNEL']);
    expect(scene.animations?.[0]?.channels[0]?.keyframes).toHaveLength(25);
    expect(scene.animations?.[0]?.channels[0]?.keyframes.every((k) => k.interpolation === 'linear')).toBe(true);
  });

  it('keeps the warning cap with thousands of unsupported channels', () => {
    const animators = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`ghost${i}`, { keyframes: [keyframe('rotation', 0, 1)] }]),
    );
    expect(loadBbmodel(rigged([animation(animators)])).warnings).toHaveLength(MAX_BBMODEL_WARNINGS);
  });

  it.each([
    ['a string time', keyframe('rotation', '1' as unknown as number, 0), '.time'],
    ['a negative time', keyframe('rotation', -0.5, 0), '.time'],
    ['a value of 1e308', keyframe('rotation', 0, 1e308), '.data_points[0].x'],
    ['a numeric string beyond 1e6', keyframe('rotation', 0, '2000000'), '.data_points[0].x'],
    ['a boolean value', keyframe('rotation', 0, true), '.data_points[0].x'],
    ['a channel that is not a string', { ...keyframe('rotation', 0, 0), channel: 3 }, '.channel'],
    ['an interpolation that is not a string', { ...keyframe('rotation', 0, 0), interpolation: null }, '.interpolation'],
  ])('rejects %s with INVALID_FIELD naming the path', (_name, bad, suffix) => {
    const error = failure(rigged([animation({ [ARM]: { keyframes: [bad] } })]));
    expect([error.code, error.path]).toEqual([
      'INVALID_FIELD',
      `$.animations[0].animators.${ARM}.keyframes[0]${suffix}`,
    ]);
  });

  it.each([
    ['a loop that is not a string', { loop: 1 }, '$.animations[0].loop'],
    ['an infinite-looking length', { length: 1e9 }, '$.animations[0].length'],
    ['animators that are not an object', { animators: [] }, '$.animations[0].animators'],
  ])('rejects an animation with %s', (_name, extra, path) => {
    const error = failure(rigged([animation({}, extra)]));
    expect([error.code, error.path]).toEqual(['INVALID_FIELD', path]);
  });

  it('rejects too many animations, animators or keyframes before reading keyframes', () => {
    const two = rigged([animation({}), animation({})]);
    expect(failure(two, { limits: { maxAnimations: 1 } }).code).toBe('TOO_MANY_KEYFRAMES');
    const many = rigged([
      animation({ [ARM]: { keyframes: [keyframe('rotation', 0, 0), keyframe('rotation', 1, 'x.y')] } }),
    ]);
    const error = failure(many, { limits: { maxKeyframes: 1 } });
    expect([error.code, error.path]).toEqual(['TOO_MANY_KEYFRAMES', `$.animations[0].animators.${ARM}`]);
    expect(error.message).toContain('more than 1 keyframes');
    // At most maxGroups + maxElements + 1 (the effects animator) animators: 4 here.
    const animators = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`g${i}`, {}]));
    expect(failure(rigged([animation(animators)]), { limits: { maxGroups: 2, maxElements: 1 } }).message).toContain(
      'animators',
    );
  });

  it('finds bones for many name-keyed animators in linear time and skips empty animators', () => {
    const groups = 10_000;
    const outliner = Array.from({ length: groups }, (_, i) => ({ name: `g${i}`, uuid: `group-${i}`, children: [] }));
    const animators: Record<string, unknown> = {};
    // Names in another case, so every lookup goes past the uuid to the case-insensitive name.
    for (let i = 0; i < groups; i++) animators[`G${i}`] = { keyframes: [keyframe('rotation', 0, i)] };
    for (let i = 0; i <= groups; i++) animators[`empty${i}`] = {};
    const animations = Array.from({ length: 5 }, () => animation(animators));
    const text = JSON.stringify(model({ meta: { format_version: '5.0' }, elements: [cube()], outliner, animations }));
    // One name scan per animator took over 10 s here.
    const { scene, warnings } = expectCpuBelow(3000, () => loadBbmodel(text));
    expect(warnings).toEqual([]);
    expect(scene.animations?.map((a) => a.channels.length)).toEqual([groups, groups, groups, groups, groups]);
    expect(scene.animations?.[4]?.channels.at(-1)).toMatchObject({
      node: groups - 1,
      keyframes: [{ value: [9999, 0, 0] }],
    });
  });

  it.each([
    ['free', 1],
    ['bedrock', 0],
    ['modded_entity', 0],
  ])('warns about quaternion_interpolation only where Blockbench honours it per animator: %s', (format, count) => {
    const animator = { quaternion_interpolation: true, keyframes: [keyframe('rotation', 0, 1)] };
    const { warnings } = loadBbmodel(rigged([animation({ [ARM]: animator })], { model_format: format }));
    expect(warnings.filter((w) => w.path.endsWith('quaternion_interpolation'))).toHaveLength(count);
  });

  it('rejects a million keyframes quickly, counting before reading', () => {
    const keyframes = `[${Array.from({ length: 1_000_000 }, () => '{"time":"bad"}').join(',')}]`;
    const text = rigged([animation({ [ARM]: { keyframes: [] } })]).replace(
      '"keyframes":[]',
      `"keyframes":${keyframes}`,
    );
    expect(expectCpuBelow(2000, () => failure(text)).code).toBe('TOO_MANY_KEYFRAMES');
  });
});
