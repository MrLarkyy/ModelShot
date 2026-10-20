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
