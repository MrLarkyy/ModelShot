import { describe, expect, it } from 'vitest';
import { catcherShade } from '../src/catcherShade';
import shadowCatcherSource from '../src/glsl/shadowCatcher.glsl?raw';
import { LIGHT_RIG_V0 } from '../src/lightRig';
import { lookShaderChunks } from '../src/lookShaderChunks';
import { linkShader } from '../src/linkShader';

const RECT = [-10, -10, 10, 10] as const;
const rig = LIGHT_RIG_V0;
const shade = (fill: readonly [number, number, number], keyT: number, xz: readonly [number, number] = [0, 0]) =>
  catcherShade(rig, fill, keyT, xz, RECT);

describe('catcherShade', () => {
  it('is 1 where nothing blocks the light', () => {
    expect(shade(rig.skyFill, 1)).toBeCloseTo(1, 12);
  });

  it('loses the catcher strength where fill and key are fully blocked', () => {
    expect(shade([0, 0, 0], 0)).toBeCloseTo(1 - rig.catcherStrength, 12);
  });

  it('is affine in fill and key visibility, so per-sample means agree with the shade of means', () => {
    const a = shade([0.1, 0.2, 0.3], 0.25);
    const b = shade([0.5, 0.4, 0.2], 0.75);
    const mean = shade([0.3, 0.3, 0.25], 0.5);
    expect((a + b) / 2).toBeCloseTo(mean, 12);
    // Noise above the unoccluded fill is not clamped: clamping per sample would bias the path tracer's mean.
    expect(shade([1, 1, 1], 1)).toBeGreaterThan(1);
  });

  it('fades to 1 over the outer 10 % of the rectangle', () => {
    expect(shade([0, 0, 0], 0, [-10, 0])).toBeCloseTo(1, 12);
    expect(shade([0, 0, 0], 0, [-9, 0])).toBeCloseTo(1 - rig.catcherStrength * 0.5, 12);
    expect(shade([0, 0, 0], 0, [-8, 0])).toBeCloseTo(1 - rig.catcherStrength, 12);
    expect(shade([0, 0, 0], 0, [10, 10])).toBeCloseTo(1, 12);
  });

  it('the GLSL chunk defines the same function and links with the look chunks', () => {
    expect(shadowCatcherSource).toContain('float catcherShade(vec3 fill, float keyT, vec2 xz, vec4 rect)');
    expect(shadowCatcherSource).toContain('vec3(0.2126, 0.7152, 0.0722)');
    const linked = linkShader('#include "shadowCatcher"', lookShaderChunks);
    expect(linked).toContain('const float CATCHER_STRENGTH');
    expect(linked).toContain('float catcherShade(');
  });
});
