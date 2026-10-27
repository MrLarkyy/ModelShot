import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXTURE_WRAP, SCENE_TEXTURE_WRAPS, textureSampling, type SceneTexture } from '../src/index';

const texture = (extra: Partial<SceneTexture> = {}): SceneTexture => ({
  name: 't',
  mimeType: 'image/png',
  bytes: null,
  width: 16,
  height: 16,
  uvWidth: 16,
  uvHeight: 16,
  missing: false,
  ...extra,
});

describe('textureSampling', () => {
  it('a texture without wrap clamps (documents written before MS-52 keep their meaning)', () => {
    expect(DEFAULT_TEXTURE_WRAP).toBe('clamp');
    expect(textureSampling(texture())).toEqual({ wrap: 'clamp', frames: 1 });
    expect(textureSampling(undefined)).toEqual({ wrap: 'clamp', frames: 1 });
  });

  it.each(SCENE_TEXTURE_WRAPS)('keeps wrap %s', (wrap) => {
    expect(textureSampling(texture({ wrap }))).toEqual({ wrap, frames: 1 });
  });

  it('a strip samples within its frames', () => {
    expect(textureSampling(texture({ height: 64, frames: { count: 4 } }))).toEqual({ wrap: 'clamp', frames: 4 });
  });

  it('lists both modes', () => {
    expect(SCENE_TEXTURE_WRAPS).toEqual(['clamp', 'repeat']);
  });
});
