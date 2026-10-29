import { describe, expect, it } from 'vitest';
import faceTexelsGlsl from '../src/glsl/faceTexels.glsl?raw';
import { MAX_TEXTURE_FLAG_FRAMES, TEXTURE_FLAG_REPEAT, TEXTURE_FRAMES_SHIFT, textureSamplingFlags } from '../src/index';

describe('textureSamplingFlags', () => {
  it('the GLSL bits equal the TypeScript bits', () => {
    for (const [name, value] of [
      ['TEXTURE_FLAG_REPEAT', TEXTURE_FLAG_REPEAT],
      ['TEXTURE_FRAMES_SHIFT', TEXTURE_FRAMES_SHIFT],
    ] as const) {
      const match = new RegExp(`const int ${name} = (\\d+);`).exec(faceTexelsGlsl);
      expect(match, `${name} missing from faceTexels.glsl`).not.toBeNull();
      expect(Number(match?.[1])).toBe(value);
    }
  });

  it('repeat sets the repeat bit, clamp none; a still image adds nothing', () => {
    expect(TEXTURE_FLAG_REPEAT).toBe(1);
    expect(textureSamplingFlags({ wrap: 'repeat', frames: 1 })).toBe(TEXTURE_FLAG_REPEAT);
    expect(textureSamplingFlags({ wrap: 'clamp', frames: 1 })).toBe(0);
  });

  it('carries a strip frame count minus 1 from bit 8, exactly in a 32-bit float', () => {
    expect(textureSamplingFlags({ wrap: 'clamp', frames: 2 })).toBe(256);
    expect(textureSamplingFlags({ wrap: 'repeat', frames: 4 })).toBe(3 * 256 + 1);
    const most = textureSamplingFlags({ wrap: 'repeat', frames: MAX_TEXTURE_FLAG_FRAMES });
    expect(Math.fround(most)).toBe(most);
    expect(most >> TEXTURE_FRAMES_SHIFT).toBe(MAX_TEXTURE_FLAG_FRAMES - 1);
  });

  it.each([0, 1.5, -3, Number.NaN, MAX_TEXTURE_FLAG_FRAMES + 1])('frames %s counts as a still image', (frames) => {
    expect(textureSamplingFlags({ wrap: 'clamp', frames })).toBe(0);
  });
});
