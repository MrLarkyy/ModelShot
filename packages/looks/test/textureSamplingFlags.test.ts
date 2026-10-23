import { describe, expect, it } from 'vitest';
import faceTexelsGlsl from '../src/glsl/faceTexels.glsl?raw';
import { TEXTURE_FLAG_REPEAT, textureSamplingFlags } from '../src/index';

describe('textureSamplingFlags', () => {
  it('the GLSL bit equals the TypeScript bit', () => {
    const match = /const int TEXTURE_FLAG_REPEAT = (\d+);/.exec(faceTexelsGlsl);
    expect(match, 'TEXTURE_FLAG_REPEAT missing from faceTexels.glsl').not.toBeNull();
    expect(Number(match?.[1])).toBe(TEXTURE_FLAG_REPEAT);
  });

  it('repeat sets the repeat bit, clamp none', () => {
    expect(TEXTURE_FLAG_REPEAT).toBe(1);
    expect(textureSamplingFlags({ wrap: 'repeat' })).toBe(TEXTURE_FLAG_REPEAT);
    expect(textureSamplingFlags({ wrap: 'clamp' })).toBe(0);
  });
});
