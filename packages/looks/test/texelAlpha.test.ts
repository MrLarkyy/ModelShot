import { describe, expect, it } from 'vitest';
import texelAlphaGlsl from '../src/glsl/texelAlpha.glsl?raw';
import { TEXEL_ALPHA_CUTOUT_MAX, TEXEL_ALPHA_OPAQUE_MIN, classifyTexelAlpha } from '../src/texelAlpha';

describe('classifyTexelAlpha', () => {
  it('classifies 8-bit alpha 0 as cutout, 1 and 254 as partial, 255 as opaque', () => {
    expect(classifyTexelAlpha(0)).toBe('cutout');
    expect(classifyTexelAlpha(1 / 255)).toBe('partial');
    expect(classifyTexelAlpha(128 / 255)).toBe('partial');
    expect(classifyTexelAlpha(254 / 255)).toBe('partial');
    expect(classifyTexelAlpha(1)).toBe('opaque');
  });

  it('uses the same thresholds as the GLSL chunk', () => {
    expect(TEXEL_ALPHA_CUTOUT_MAX).toBe(0.5 / 255);
    expect(TEXEL_ALPHA_OPAQUE_MIN).toBe(254.5 / 255);
    expect(texelAlphaGlsl).toContain('const float TEXEL_ALPHA_CUTOUT_MAX = 0.5 / 255.0;');
    expect(texelAlphaGlsl).toContain('const float TEXEL_ALPHA_OPAQUE_MIN = 254.5 / 255.0;');
  });
});
