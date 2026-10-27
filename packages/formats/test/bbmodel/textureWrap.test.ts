import { describe, expect, it } from 'vitest';
import { loadBbmodel } from '../../src/index';
import { drawnTextureWrap, formatTextureWrapDefault } from '../../src/bbmodel/TextureWrap';
import { cube, model, pngDataUri } from './fixtures';

/** One 24 x 16 texel face past both u edges of a 16 x 16 texture, as the wrap tests draw it. */
const PAST_EDGES = cube({
  from: [0, 0, 0],
  to: [24, 16, 4],
  faces: { south: { uv: [-4, 0, 20, 16], texture: 0 } },
});

function load(modelFormat: string, texture: Record<string, unknown>) {
  const file = model({
    meta: { format_version: '4.10', model_format: modelFormat, box_uv: false },
    elements: [PAST_EDGES],
    textures: [{ name: 't', uv_width: 16, uv_height: 16, source: pngDataUri(16, 16), ...texture }],
  });
  const { scene, warnings } = loadBbmodel(JSON.stringify(file));
  return {
    texture: scene.textures[0],
    warnings: warnings.filter((w) => w.code === 'UNSUPPORTED_VALUE'),
    rect: [...(scene.meshes[0]?.uvRects.slice(0, 4) ?? [])].map((x) => x * 16),
  };
}

describe('texture wrap_mode (Blockbench Texture.wrap_mode, textures.js:726)', () => {
  it.each(['hytale_character', 'hytale_prop'])('%s without wrap_mode clamps (texture_wrap_default clamp)', (format) => {
    const { texture, warnings, rect } = load(format, {});
    expect(formatTextureWrapDefault(format)).toBe('clamp');
    expect(texture?.wrap).toBeUndefined();
    expect(Object.keys(texture ?? {})).not.toContain('wrap');
    expect(warnings).toEqual([]);
    // The face's UVs stay past the image: the renderers clamp, the loader does not move them.
    expect(rect).toEqual([-4, 0, 20, 16]);
  });

  it.each(['free', 'java_block', 'bedrock', 'unknown-format'])(
    '%s without wrap_mode draws limited, i.e. clamped',
    (format) => {
      expect(formatTextureWrapDefault(format)).toBe('limited');
      expect(load(format, {}).texture?.wrap).toBeUndefined();
    },
  );

  it.each(['free', 'java_block', 'hytale_prop'])('a stored repeat repeats in %s', (format) => {
    const { texture, warnings } = load(format, { wrap_mode: 'repeat' });
    expect(texture?.wrap).toBe('repeat');
    expect(warnings).toEqual([]);
  });

  it.each(['limited', 'clamp'])('%s clamps without a warning', (mode) => {
    const { texture, warnings } = load('free', { wrap_mode: mode });
    expect(texture?.wrap).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('Blockbench draws only repeat repeating', () => {
    expect(['limited', 'repeat', 'clamp'].map((mode) => drawnTextureWrap(mode as 'limited'))).toEqual([
      'clamp',
      'repeat',
      'clamp',
    ]);
  });

  it.each<[string, unknown]>([
    ['an unknown mode', 'mirror'],
    ['a number', 42],
    ['null', null],
    ['an object', { mode: 'repeat' }],
    ['a 2000-character string', 'r'.repeat(2000)],
  ])('%s warns once, clamps and the file still loads', (_name, mode) => {
    const { texture, warnings } = load('hytale_prop', { wrap_mode: mode });
    expect(texture?.wrap).toBeUndefined();
    expect(texture?.missing).toBe(false);
    expect(warnings.map((w) => w.path)).toEqual(['$.textures[0].wrap_mode']);
    expect(warnings[0]?.message.length).toBeLessThan(200);
    expect(warnings[0]?.message).not.toMatch(/r{33}/);
  });

  it('a missing texture keeps its wrap', () => {
    const { texture } = load('free', { wrap_mode: 'repeat', source: undefined });
    expect(texture?.missing).toBe(true);
    expect(texture?.wrap).toBe('repeat');
  });
});
