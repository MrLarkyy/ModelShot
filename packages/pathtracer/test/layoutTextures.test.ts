import { describe, expect, it } from 'vitest';
import { layoutTextures } from '../src/layoutTextures';

const bitmap = (): ImageBitmap => ({ width: 8, height: 8, close() {} });

describe('layoutTextures', () => {
  it('places a bitmap shared by two textures once', () => {
    const shared = bitmap();
    const { images, textures } = layoutTextures([shared, null, shared, bitmap()], 64, 4);
    expect(images).toHaveLength(2 + 2);
    expect(textures.textures[0]).toBe(textures.textures[2]);
    expect(textures.textures[1]).toBeNull();
    expect(textures.textures[3]).not.toEqual(textures.textures[0]);
  });
});
