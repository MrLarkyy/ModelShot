import { describe, expect, it } from 'vitest';
import type { Rgb } from '../src/agxToneMap';
import { catcherShade, catcherShadeOfLoss } from '../src/catcherShade';
import lightRigSource from '../src/glsl/lightRig.glsl?raw';
import shadowCatcherSource from '../src/glsl/shadowCatcher.glsl?raw';
import { LIGHT_RIG_V0, type LightRig } from '../src/lightRig';
import { LOOK_PRESETS } from '../src/lookPresets';
import { lookShaderChunks } from '../src/lookShaderChunks';
import { linkShader } from '../src/linkShader';

const RECT = [-10, -10, 10, 10] as const;
const rig = LIGHT_RIG_V0;
const shade = (fill: readonly [number, number, number], keyT: number, xz: readonly [number, number] = [0, 0]) =>
  catcherShade(rig, fill, keyT, xz, RECT);

describe('catcherShade', () => {
  it('is 1 where nothing blocks the light', () => {
    expect(shade(rig.environment.sky, 1)).toBeCloseTo(1, 12);
  });

  it('loses the catcher strength where fill and key are fully blocked', () => {
    expect(shade([0, 0, 0], 0)).toBeCloseTo(1 - rig.catcher.strength, 12);
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
    expect(shade([0, 0, 0], 0, [-9, 0])).toBeCloseTo(1 - rig.catcher.strength * 0.5, 12);
    expect(shade([0, 0, 0], 0, [-8, 0])).toBeCloseTo(1 - rig.catcher.strength, 12);
    expect(shade([0, 0, 0], 0, [10, 10])).toBeCloseTo(1, 12);
  });

  it('the GLSL chunk defines the same functions and links with the look chunks', () => {
    expect(shadowCatcherSource).toContain('float catcherShade(vec3 fill, float keyT, vec2 xz, vec4 rect)');
    expect(shadowCatcherSource).toContain('float catcherShadeOfLoss(vec3 fillLost, float keyLost, vec2 xz, vec4 rect)');
    expect(shadowCatcherSource).toContain('vec3(0.2126, 0.7152, 0.0722)');
    // The loss form's numerator is the losses alone, so zero losses give exactly 1 on any GPU.
    expect(shadowCatcherSource).toContain(
      'float lost = (catcherLuminance(fillLost) + catcherKeyWeight() * keyLost) / weight;',
    );
    expect(shadowCatcherSource).toContain('return 1.0 - u_lookCatcherStrength * lost * catcherFade(xz, rect);');
    const linked = linkShader('#include "shadowCatcher"', lookShaderChunks);
    expect(linked).toContain('uniform float u_lookCatcherStrength;');
    expect(linked).toContain('float catcherShade(');
    expect(linked).toContain('float catcherShadeOfLoss(');
  });
});

/** Deterministic inputs in [0, 1) (a 32-bit LCG): the tests never use Math.random. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [3, -4],
  [-9.5, 0],
  [0, 9.2],
  [-10, -10],
  [10, 10],
  [9.9, -9.9],
];

describe('catcherShadeOfLoss', () => {
  for (const [id, look] of Object.entries(LOOK_PRESETS)) {
    it(`${id}: exactly 1 where nothing is lost, inside, in the fade band and at the corners`, () => {
      for (const xz of POINTS) expect(catcherShadeOfLoss(look, [0, 0, 0], 0, xz, RECT), xz.join(', ')).toBe(1);
    });
  }

  it('equals catcherShade of fill = sky - fillLost and keyT = 1 - keyLost', () => {
    const next = lcg(59);
    for (const look of [rig, ...Object.values(LOOK_PRESETS)]) {
      const { sky } = look.environment;
      for (let i = 0; i < 200; i++) {
        const fill: Rgb = [next() * 2, next() * 2, next() * 2];
        const keyT = next();
        const xz: [number, number] = [next() * 24 - 12, next() * 24 - 12];
        const lost: Rgb = [sky[0] - fill[0], sky[1] - fill[1], sky[2] - fill[2]];
        expect(catcherShadeOfLoss(look, lost, 1 - keyT, xz, RECT)).toBeCloseTo(
          catcherShade(look, fill, keyT, xz, RECT),
          12,
        );
      }
    }
  });

  it('a lightless look (sky, ground and key 0) has no catcher: both shades are exactly 1 whatever blocks', () => {
    const dark: LightRig = {
      ...rig,
      environment: { ...rig.environment, sky: [0, 0, 0], ground: [0, 0, 0] },
      lights: { ...rig.lights, key: { ...rig.lights.key, color: [0, 0, 0] } },
    };
    for (const xz of POINTS) {
      for (const [fill, keyT] of [
        [[0, 0, 0], 0],
        [[0, 0, 0], 1],
        [[0.2, 0.1, 0], 0.5],
      ] as const) {
        expect(catcherShade(dark, fill, keyT, xz, RECT)).toBe(1);
        expect(catcherShadeOfLoss(dark, [-fill[0], -fill[1], -fill[2]], 1 - keyT, xz, RECT)).toBe(1);
      }
    }
    expect(shadowCatcherSource.match(/if \(weight <= CATCHER_NO_LIGHT\) return 1\.0;/g)).toHaveLength(2);
  });

  it('is never above 1: no loss is negative', () => {
    expect(catcherShadeOfLoss(rig, [0.2, 0.3, 0.1], 0.5, [0, 0], RECT)).toBeLessThan(1);
    expect(catcherShadeOfLoss(rig, [0, 0, 0], 1, [0, 0], RECT)).toBeLessThan(1);
  });
});

/**
 * The GLSL dome as lightRig.glsl writes it (the source assertions pin the text): hemisphereFill(n) and
 * environmentRadiance(d), per channel.
 */
const hemisphereFill = (look: LightRig, ny: number, c: 0 | 1 | 2): number =>
  look.environment.ground[c] + (look.environment.sky[c] - look.environment.ground[c]) * (ny * 0.5 + 0.5);
const environmentRadiance = (look: LightRig, dy: number, c: 0 | 1 | 2): number =>
  look.environment.ground[c] + (look.environment.sky[c] - look.environment.ground[c]) * (dy * 0.75 + 0.5);

describe('the control variate of the path-traced catcher', () => {
  it('lightRig.glsl has the dome the quadrature below integrates', () => {
    expect(lightRigSource).toContain('return mix(u_lookGround, u_lookSky, n.y * 0.5 + 0.5);');
    expect(lightRigSource).toContain('return mix(u_lookGround, u_lookSky, d.y * 0.75 + 0.5);');
  });

  // The trace subtracts only the blocked fill from hemisphereFill(up): unbiased only while the cosine-weighted mean of
  // environmentRadiance over the up hemisphere is exactly hemisphereFill(up), whatever a look sets.
  for (const [id, look] of Object.entries(LOOK_PRESETS)) {
    it(`${id}: the cosine-weighted mean of environmentRadiance over the up hemisphere is hemisphereFill(up)`, () => {
      // Stratified cosine sampling (cosineDirection: d.y = sqrt(1 - u1)); the azimuth does not enter.
      const strata = 4096;
      for (const c of [0, 1, 2] as const) {
        let sum = 0;
        for (let i = 0; i < strata; i++) sum += environmentRadiance(look, Math.sqrt(1 - (i + 0.5) / strata), c);
        expect(Math.abs(sum / strata - hemisphereFill(look, 1, c)), `channel ${c}`).toBeLessThan(1e-4);
      }
    });
  }
});
