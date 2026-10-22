import { DEFAULT_TEXTURE_FRAME_TIME } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { BbmodelWarningList } from '../../src/bbmodel/BbmodelWarning';
import {
  MAX_FRAME_ORDER_CHARS,
  MAX_FRAME_ORDER_LENGTH,
  readTextureFrameSettings,
  textureFrames,
} from '../../src/bbmodel/textureFrames';
import { DEFAULT_BBMODEL_LIMITS, loadBbmodel } from '../../src/index';
import { cube, fixture, mesh, meshFace, model, pngDataUri } from './fixtures';

const PATH = '$.textures[0]';

/** Frames of a `width` × `height` image on a `uvWidth` × `uvHeight` UV space, with `fields` in `modelFormat`. */
function frames(
  width: number,
  height: number,
  options: { uv?: [number, number]; format?: string; fields?: Record<string, unknown> } = {},
) {
  const warnings = new BbmodelWarningList();
  const [uvWidth, uvHeight] = options.uv ?? [16, 16];
  const settings = readTextureFrameSettings(options.fields ?? {}, PATH, options.format ?? 'java_block', warnings);
  const result = textureFrames(settings, { width, height }, { width: uvWidth, height: uvHeight }, warnings);
  return { result, warnings: warnings.items };
}

/** A strip model: texture 0 is a `width` × `height` PNG header with `fields`, one cube with every face on it. */
function stripModel(width: number, height: number, format: string, fields: Record<string, unknown> = {}): string {
  const face = { uv: [0, 0, 16, 16], texture: 0 };
  return JSON.stringify(
    model({
      meta: { format_version: '4.5', model_format: format, box_uv: false },
      elements: [cube({ faces: { north: face, east: face, south: face, west: face, up: face, down: face } })],
      textures: [{ name: 'strip', source: pngDataUri(width, height), ...fields }],
    }),
  );
}

describe('frame count (Blockbench Texture.frameCount)', () => {
  it.each<[string, number, number, [number, number], number | undefined]>([
    ['16×64 on 16×16', 16, 64, [16, 16], 4],
    ['16×40 on 16×16 (ceil, frames of 13.33 px)', 16, 40, [16, 16], 3],
    ['16×17 on 16×16 (any extra row is another frame)', 16, 17, [16, 16], 2],
    ['40×81 on 16×16 (2.025 frames: within the 0.05 slack)', 40, 81, [16, 16], 2],
    ['64×32 on 64×64', 64, 32, [64, 64], undefined],
    ['32×32 on 16×16 (hi-res, same ratio)', 32, 32, [16, 16], undefined],
    ['32×128 on 16×16 (hi-res strip)', 32, 128, [16, 16], 4],
    ['missing (0×0)', 0, 0, [16, 16], undefined],
  ])('%s', (_, width, height, uv, count) => {
    expect(frames(width, height, { uv }).result?.count).toBe(count);
  });

  const ANIMATING = [
    'java_block',
    'free',
    'bedrock',
    'bedrock_block',
    'bedrock_old',
    'image',
    'geckolib_model',
    'animated_entity_model',
    'azure_model',
    'bamo_model',
    'free_rotation',
    'java_block_sequence',
    'cosmic_reach_entity_model',
  ];

  it.each(ANIMATING)('%s animates textures', (format) => {
    expect(frames(16, 64, { format }).result?.count).toBe(4);
  });

  it.each(['geckolib_model', 'free_rotation', 'java_block_sequence'])(
    '%s times frames by frame_time ticks',
    (format) => {
      expect(frames(16, 64, { format, fields: { frame_time: 4, fps: 20 } }).result?.frameTime).toBeCloseTo(0.2);
    },
  );

  it.each(['image', 'azure_model', 'animated_entity_model', 'bamo_model', 'cosmic_reach_entity_model'])(
    '%s times frames by fps',
    (format) => {
      expect(frames(16, 64, { format, fields: { frame_time: 4, fps: 20 } }).result?.frameTime).toBeCloseTo(0.05);
    },
  );

  it.each(ANIMATING.slice(5))('loading a %s model gives its strip frames without warnings', (format) => {
    const loaded = loadBbmodel(stripModel(16, 64, format));
    expect(loaded.scene.textures[0]?.frames?.count).toBe(4);
    expect(loaded.warnings).toEqual([]);
  });

  it.each([
    'modded_entity',
    'optifine_entity',
    'optifine_part',
    'optifine_player_model',
    'skin',
    'eme_entity',
    'figura',
    'hytale_character',
    'unknown',
    '',
  ])('%s draws a strip as one image and ignores its fields', (format) => {
    const { result, warnings } = frames(16, 64, { format, fields: { frame_time: 'x', fps: [] } });
    expect(result).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('a uv size under one frame pixel tall warns and draws one image, without looping over the count', () => {
    const start = performance.now();
    const { result, warnings } = frames(16, 16, { format: 'free', uv: [16, 1e-7] });
    expect(performance.now() - start).toBeLessThan(50);
    expect(result).toBeUndefined();
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNSUPPORTED_VALUE', PATH]]);
    expect(warnings[0]?.message).toContain('160000000 frames');
  });

  it('a count equal to the pixel height (one-pixel frames) is still a strip', () => {
    expect(frames(1, 4, { uv: [16, 16] }).result?.count).toBe(4);
    expect(frames(1, 4, { uv: [16, 3] }).result).toBeUndefined();
  });
});

describe('frame time in seconds', () => {
  it.each<[number | undefined, number]>([
    [undefined, 0.05],
    [1, 0.05],
    [3, 0.15],
    [0, 0.01666],
    [-5, 0.01666],
  ])('java_block frame_time %s ticks → %s s', (frameTime, seconds) => {
    const fields = frameTime === undefined ? {} : { frame_time: frameTime };
    expect(frames(16, 64, { fields }).result?.frameTime).toBe(seconds);
  });

  it.each<[number | undefined, number]>([
    [undefined, 1 / 7],
    [10, 0.1],
    [0, 1],
    [-3, 1],
  ])('free fps %s → %s s', (fps, seconds) => {
    const fields = fps === undefined ? {} : { fps };
    expect(frames(16, 64, { format: 'free', fields }).result?.frameTime).toBe(seconds);
  });

  it('java_block times by frame_time and ignores fps; other formats the reverse', () => {
    expect(frames(16, 64, { fields: { frame_time: 2, fps: 30 } }).result?.frameTime).toBe(0.1);
    expect(frames(16, 64, { format: 'bedrock', fields: { frame_time: 2, fps: 4 } }).result?.frameTime).toBe(0.25);
  });

  it('the default constant is one tick, what java_block uses without frame_time', () => {
    expect(frames(16, 64).result?.frameTime).toBe(DEFAULT_TEXTURE_FRAME_TIME);
  });
});

describe('frame order (Blockbench TextureAnimator)', () => {
  const order = (type: string, frameOrder: string | undefined, height = 64) => {
    const fields: Record<string, unknown> = { frame_order_type: type };
    if (frameOrder !== undefined) fields.frame_order = frameOrder;
    return frames(16, height, { fields });
  };

  it('loop is the plain order, left out', () => {
    expect(order('loop', '3 2 1').result?.order).toBeUndefined();
    expect(frames(16, 64).result?.order).toBeUndefined();
  });

  it('backwards and back_and_forth', () => {
    expect(order('backwards', undefined).result?.order).toEqual([3, 2, 1, 0]);
    expect(order('back_and_forth', undefined).result?.order).toEqual([0, 1, 2, 3, 2, 1]);
    expect(order('back_and_forth', undefined, 32).result?.order).toEqual([0, 1]);
    expect(order('back_and_forth', undefined, 48).result?.order).toEqual([0, 1, 2, 1]);
  });

  it('custom: parseInt per token (the :time suffix dropped), wrapped by the count', () => {
    expect(order('custom', '0 2 1:5 3').result?.order).toEqual([0, 2, 1, 3]);
    expect(order('custom', '7').result?.order).toEqual([3]);
    expect(order('custom', '1\t0\n5').result?.order).toEqual([1, 0, 1]);
  });

  it('custom: timed index:time tokens (Blockbench .mcmeta import) play their index part', () => {
    expect(order('custom', '0:2 1:4 3:1 2').result?.order).toEqual([0, 1, 3, 2]);
  });

  it('custom: an order equal to plain looping is left out', () => {
    expect(order('custom', '0 1 2 3').result?.order).toBeUndefined();
    expect(order('custom', '0 1 2 3 4 5 6 7').result?.order).toBeUndefined();
  });

  it('custom: a token that is no number plays the counter, repeating over lcm(tokens, count) steps', () => {
    // Blockbench at step a: token a % 2; "0" plays 0, "x" plays a % 4.
    const { result, warnings } = order('custom', '0 x');
    expect(result?.order).toEqual([0, 1, 0, 3]);
    expect(warnings).toEqual([]);
    expect(order('custom', 'x 2 x').result?.order).toEqual([0, 2, 2, 3, 2, 1, 2, 2, 0, 1, 2, 3]);
  });

  it('custom: empty, blank or wordless orders loop, as Blockbench plays them, without a warning', () => {
    for (const text of [undefined, '', '   ', 'x y']) {
      const { result, warnings } = order('custom', text);
      expect(result?.order).toBeUndefined();
      expect(warnings).toEqual([]);
    }
  });

  it('custom: a negative or infinite token plays frame 0 (Blockbench cube preview) with one warning', () => {
    const { result, warnings } = order('custom', `x -1 2 ${'9'.repeat(400)}`);
    expect(result?.order).toEqual([0, 0, 2, 0]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNSUPPORTED_VALUE', `${PATH}.frame_order`]]);
    expect(warnings[0]?.message).toContain('2 of 4');
    expect(order('custom', '-1 -2').result?.order).toEqual([0, 0]);
  });

  it('custom: counter slots over a period above MAX_FRAME_ORDER_LENGTH are dropped with a warning', () => {
    // 4096 one-pixel frames, 3 tokens: the period lcm(3, 4096) = 12288 is over 8192.
    const fields = { frame_order_type: 'custom', frame_order: '5 x x' };
    const start = performance.now();
    const { result, warnings } = frames(1, 4096, { fields });
    expect(performance.now() - start).toBeLessThan(50);
    expect(result?.count).toBe(4096);
    expect(result?.order).toEqual([5]);
    expect(warnings.map((w) => w.path)).toEqual([`${PATH}.frame_order`]);
    expect(warnings[0]?.message).toContain(`${MAX_FRAME_ORDER_LENGTH}`);
    // 2 tokens: lcm(2, 4096) = 4096 fits and is expanded.
    expect(frames(1, 4096, { fields: { ...fields, frame_order: '5 x' } }).result?.order).toHaveLength(4096);
  });

  it('interpolate is stored only when true', () => {
    expect(frames(16, 64).result).not.toHaveProperty('interpolate');
    expect(frames(16, 64, { fields: { frame_interpolate: false } }).result).not.toHaveProperty('interpolate');
    expect(frames(16, 64, { fields: { frame_interpolate: true } }).result?.interpolate).toBe(true);
  });
});

describe('untrusted frame fields', () => {
  it('wrong types warn, take their defaults and the model still loads', () => {
    const { scene, warnings } = loadBbmodel(
      stripModel(16, 64, 'java_block', {
        frame_time: '3',
        fps: [1],
        frame_order_type: 2,
        frame_order: { a: 1 },
        frame_interpolate: 'yes',
      }),
    );
    expect(scene.textures[0]?.frames).toEqual({ count: 4, frameTime: 0.05 });
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['UNSUPPORTED_VALUE', '$.textures[0].frame_time'],
      ['UNSUPPORTED_VALUE', '$.textures[0].fps'],
      ['UNSUPPORTED_VALUE', '$.textures[0].frame_order_type'],
      ['UNSUPPORTED_VALUE', '$.textures[0].frame_order'],
      ['UNSUPPORTED_VALUE', '$.textures[0].frame_interpolate'],
    ]);
  });

  it('non-finite-like and huge numbers and unknown order types warn', () => {
    const { warnings } = frames(16, 64, {
      fields: { frame_time: 1e8, fps: -1e8, frame_order_type: 'random' },
    });
    expect(warnings.map((w) => w.path)).toEqual([`${PATH}.frame_time`, `${PATH}.fps`, `${PATH}.frame_order_type`]);
  });

  it('a timed frame_order over maxStringChars (as Blockbench imports long .mcmeta files) loads', () => {
    const timed = Array.from({ length: 3000 }, (_, i) => `${(i * 3) % 4}:2`).join(' ');
    expect(timed.length).toBeGreaterThan(DEFAULT_BBMODEL_LIMITS.maxStringChars);
    const { scene, warnings } = loadBbmodel(
      stripModel(16, 64, 'java_block', { frame_order_type: 'custom', frame_order: timed }),
    );
    expect(warnings).toEqual([]);
    expect(scene.textures[0]?.frames?.order?.slice(0, 4)).toEqual([0, 3, 2, 1]);
    expect(scene.textures[0]?.frames?.order).toHaveLength(3000);
  });

  it('a frame_order at MAX_FRAME_ORDER_CHARS is bounded; one more warns and plays in plain order, never fails', () => {
    const longest = '1 '.repeat(MAX_FRAME_ORDER_CHARS / 2);
    const start = performance.now();
    const { scene } = loadBbmodel(
      stripModel(16, 64, 'java_block', { frame_order_type: 'custom', frame_order: longest }),
    );
    expect(performance.now() - start).toBeLessThan(1000);
    // The trailing space is a counter slot; its period lcm(32769, 4) is over the bound, so it is dropped.
    expect(scene.textures[0]?.frames?.order).toHaveLength(MAX_FRAME_ORDER_CHARS / 2);
    for (const format of ['java_block', 'modded_entity']) {
      for (const [width, height] of [
        [16, 64],
        [16, 16],
      ]) {
        const fields = { frame_order_type: 'custom', frame_order: `${longest}1` };
        const { scene: over, warnings } = loadBbmodel(stripModel(width!, height!, format, fields));
        expect(over.textures[0]?.frames?.order).toBeUndefined();
        const expected = format === 'java_block' ? [['UNSUPPORTED_VALUE', '$.textures[0].frame_order']] : [];
        expect(warnings.map((w) => [w.code, w.path])).toEqual(expected);
      }
    }
  });
});

describe('UVs of faces on a strip map into frame 0', () => {
  it('cube faces divide v by the count; a texture without frames serialises no frames key', () => {
    const strip = loadBbmodel(stripModel(16, 64, 'free')).scene;
    expect(strip.textures[0]?.frames?.count).toBe(4);
    const mesh0 = strip.meshes[0];
    expect(Math.max(...[...(mesh0?.uvs ?? [])].filter((_, i) => i % 2 === 1))).toBe(0.25);
    const still = loadBbmodel(stripModel(16, 16, 'free')).scene;
    expect(still.textures[0]).not.toHaveProperty('frames');
    expect(Math.max(...[...(still.meshes[0]?.uvs ?? [])].filter((_, i) => i % 2 === 1))).toBe(1);
  });

  it('a strip in a format without animated textures keeps whole-image UVs', () => {
    const { scene } = loadBbmodel(stripModel(16, 64, 'modded_entity'));
    expect(scene.textures[0]).not.toHaveProperty('frames');
    expect(Math.max(...[...(scene.meshes[0]?.uvs ?? [])].filter((_, i) => i % 2 === 1))).toBe(1);
  });

  it('mesh faces divide v and the rect by the count (Blockbench mesh updateUV stretches too)', () => {
    const uv = { a: [0, 0], b: [16, 0], c: [16, 16], d: [0, 8] };
    const json = JSON.stringify(
      model({
        elements: [mesh({ faces: { f: meshFace(['a', 'b', 'c', 'd'], { uv, texture: 0 }) } })],
        textures: [{ name: 'strip', source: pngDataUri(16, 64) }],
      }),
    );
    const sceneMesh = loadBbmodel(json).scene.meshes[0];
    expect([...(sceneMesh?.uvs ?? [])]).toEqual([0, 0, 1, 0, 1, 0.25, 0, 0.125]);
    expect([...(sceneMesh?.uvRects.slice(0, 4) ?? [])]).toEqual([0, 0, 1, 0.25]);
  });

  it('untextured faces next to a strip are untouched', () => {
    const json = JSON.stringify(
      model({
        elements: [cube()],
        textures: [{ name: 'strip', source: pngDataUri(16, 64) }],
      }),
    );
    const { scene } = loadBbmodel(json);
    expect(scene.textures[0]?.frames?.count).toBe(4);
    expect(Math.max(...[...(scene.meshes[0]?.uvs ?? [])])).toBe(1 / 16);
  });

  it('the frame-strip fixture loads without warnings', () => {
    expect(loadBbmodel(fixture('frame-strip')).warnings).toEqual([]);
  });
});
