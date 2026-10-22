import { describe, expect, it } from 'vitest';
import * as scene from '../src/index';

describe('@modelshot/scene', () => {
  it('names itself', () => {
    expect(scene.packageName).toBe('@modelshot/scene');
  });

  it('exports the material alpha rule', () => {
    expect(typeof scene.resolveMaterialAlpha).toBe('function');
    expect(typeof scene.texelCoverage).toBe('function');
    expect(scene.DEFAULT_ALPHA_CUTOFF).toBe(0.5);
    expect(scene.RENDER_ORDER_TIE_DISTANCE).toBe(1e-3);
    expect(scene.BACK_SIDE_RENDER_ORDER).toBe(-1 / 16);
    expect(scene.MAX_ABS_RENDER_ORDER).toBe(1024);
  });

  it('exports the texture frame default, one Minecraft tick', () => {
    expect(scene.DEFAULT_TEXTURE_FRAME_TIME).toBe(0.05);
    const frames: scene.SceneTextureFrames = { count: 4 };
    const texture: scene.SceneTexture = {
      name: 'strip',
      mimeType: 'image/png',
      bytes: null,
      width: 16,
      height: 64,
      uvWidth: 16,
      uvHeight: 16,
      missing: false,
      frames,
    };
    expect(texture.frames?.frameTime ?? scene.DEFAULT_TEXTURE_FRAME_TIME).toBe(0.05);
  });

  it('accepts every loader format as a scene source', () => {
    const sources: scene.SceneSource[] = [
      { format: 'bbmodel', formatVersion: '4.10', modelFormat: 'free' },
      { format: 'gltf', formatVersion: '2.0', modelFormat: 'glb' },
      { format: 'obj', formatVersion: '', modelFormat: 'obj' },
    ];
    const formats: scene.SceneSourceFormat[] = sources.map((source) => source.format);
    expect(formats).toEqual(['bbmodel', 'gltf', 'obj']);
  });
});
