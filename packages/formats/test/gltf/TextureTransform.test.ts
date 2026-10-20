import { describe, expect, it } from 'vitest';
import { applyTextureTransform, textureTransformMatrix } from '../../src/gltf/TextureTransform';

const round = (values: Iterable<number>) => [...values].map((x) => Math.round(x * 1e6) / 1e6 || 0);

describe('KHR_texture_transform', () => {
  const transform = {
    offset: [0.5, 0.25] as const,
    rotation: Math.PI / 6,
    scale: [2, 3] as const,
    texCoord: undefined,
  };
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);

  it('is T · R · S with the extension rotation matrix, computed by hand', () => {
    // T = [1 0 .5; 0 1 .25; 0 0 1], R = [c s 0; −s c 0; 0 0 1], S = [2 0 0; 0 3 0; 0 0 1]:
    // T · R · S = [2c 3s .5; −2s 3c .25; 0 0 1].
    expect(round(textureTransformMatrix(transform))).toEqual(round([2 * c, 3 * s, 0.5, -2 * s, 3 * c, 0.25, 0, 0, 1]));
  });

  it('applies it to every UV pair: scale first, then rotate, then offset', () => {
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    applyTextureTransform(uvs, transform);
    expect(round(uvs)).toEqual(
      round([
        0.5,
        0.25,
        2 * c + 0.5,
        -2 * s + 0.25,
        3 * s + 0.5,
        3 * c + 0.25,
        2 * c + 3 * s + 0.5,
        -2 * s + 3 * c + 0.25,
      ]),
    );
  });

  it('a quarter turn takes u to −v: the UVs turn counter-clockwise in UV space (v down)', () => {
    const uvs = new Float32Array([1, 0, 0, 1]);
    applyTextureTransform(uvs, { offset: [0, 0], rotation: Math.PI / 2, scale: [1, 1], texCoord: undefined });
    expect(round(uvs)).toEqual([0, -1, 1, 0]);
  });

  it('the identity transform changes nothing', () => {
    const uvs = new Float32Array([0.125, 0.75]);
    applyTextureTransform(uvs, { offset: [0, 0], rotation: 0, scale: [1, 1], texCoord: undefined });
    expect([...uvs]).toEqual([0.125, 0.75]);
  });
});
