import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXTURE_FILTER,
  DEFAULT_TEXTURE_WRAP,
  SCENE_TEXTURE_FILTERS,
  SCENE_TEXTURE_WRAPS,
  textureSampling,
  type SceneTexture,
} from '../src/index';

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

const STILL = { wrap: 'clamp', frames: 1, filter: 'nearest' } as const;

describe('textureSampling', () => {
  it('a texture without wrap clamps (documents written before MS-52 keep their meaning)', () => {
    expect(DEFAULT_TEXTURE_WRAP).toBe('clamp');
    expect(textureSampling(texture())).toEqual(STILL);
    expect(textureSampling(undefined)).toEqual(STILL);
  });

  it.each(SCENE_TEXTURE_WRAPS)('keeps wrap %s', (wrap) => {
    expect(textureSampling(texture({ wrap }))).toEqual({ ...STILL, wrap });
  });

  it('a strip samples within its frames', () => {
    expect(textureSampling(texture({ height: 64, frames: { count: 4 } }))).toEqual({ ...STILL, frames: 4 });
  });

  it('lists both modes', () => {
    expect(SCENE_TEXTURE_WRAPS).toEqual(['clamp', 'repeat']);
  });

  it('a texture without filter is nearest (documents written before MS-38 keep their pixel art)', () => {
    expect(DEFAULT_TEXTURE_FILTER).toBe('nearest');
    expect(SCENE_TEXTURE_FILTERS).toEqual(['nearest', 'linear']);
    expect(textureSampling(texture()).filter).toBe('nearest');
  });

  it.each(SCENE_TEXTURE_FILTERS)('keeps filter %s beside wrap and frames', (filter) => {
    const strip = texture({ height: 32, frames: { count: 2 }, wrap: 'repeat', filter });
    expect(textureSampling(strip)).toEqual({ wrap: 'repeat', frames: 2, filter });
  });
});
