import { describe, expect, it } from 'vitest';
import lightRigSource from '../src/glsl/lightRig.glsl?raw';
import { LIGHT_RIG_V0, unoccludedRadiance, type LightRig } from '../src/lightRig';
import { LOOK_PRESETS } from '../src/lookPresets';
import { LOOK_UNIFORM_NAMES } from '../src/lookUniforms';

type V3 = readonly [number, number, number];

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Irradiance / pi of `radiance(d.y)` over the hemisphere around unit `n`, by the midpoint rule in (cos theta, phi). */
function cosineMean(n: V3, radiance: (dy: number) => number): number {
  const t = unit(cross(Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n));
  const b = cross(n, t);
  const steps = 400;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const cosTheta = (i + 0.5) / steps;
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    for (let j = 0; j < steps; j++) {
      const phi = ((j + 0.5) / steps) * 2 * Math.PI;
      const dy = (t[1] * Math.cos(phi) + b[1] * Math.sin(phi)) * sinTheta + n[1] * cosTheta;
      sum += radiance(dy) * cosTheta;
    }
  }
  return (sum * (2 * Math.PI)) / (steps * steps) / Math.PI;
}

/** The rig with only its dome: key and accents black. */
function domeOnly(rig: LightRig): LightRig {
  const dark = [0, 0, 0] as const;
  const { key, fill, rim } = rig.lights;
  return {
    ...rig,
    lights: { key: { ...key, color: dark }, fill: { ...fill, color: dark }, rim: { ...rim, color: dark } },
  };
}

describe('light rig', () => {
  it('the chunk reads every rig value from a look uniform, no constant', () => {
    for (const name of [
      'u_lookSky',
      'u_lookGround',
      'u_lookKeyDirection',
      'u_lookKeyColor',
      'u_lookKeyCosRadius',
      'u_lookFillDirection',
      'u_lookFillColor',
      'u_lookRimDirection',
      'u_lookRimColor',
      'u_lookCatcherStrength',
    ] as const) {
      expect(LOOK_UNIFORM_NAMES).toContain(name);
      expect(lightRigSource).toMatch(new RegExp(`^uniform (vec3|float) ${name};$`, 'm'));
    }
    expect(lightRigSource).not.toMatch(/^const /m);
  });

  it('v0 is a unit key above the horizon with black accents', () => {
    expect(Math.hypot(...LIGHT_RIG_V0.lights.key.direction)).toBeCloseTo(1, 4);
    expect(LIGHT_RIG_V0.lights.fill.color).toEqual([0, 0, 0]);
    expect(LIGHT_RIG_V0.lights.rim.color).toEqual([0, 0, 0]);
  });

  it('shades like the preview: fill by the normal plus the key', () => {
    const up = unoccludedRadiance(LIGHT_RIG_V0, [1, 1, 1], [0, 1, 0]);
    expect(up[0]).toBeCloseTo(0.5 + 1.25 * 0.79808, 6);
    const down = unoccludedRadiance(LIGHT_RIG_V0, [0.5, 0.5, 0.5], [0, -1, 0]);
    expect(down[0]).toBeCloseTo(0.1, 9);
    expect(down[2]).toBeCloseTo(0.09, 9);
  });

  it('adds the fill and rim accents by the cosine of their directions, without shadow', () => {
    const rig = LOOK_PRESETS['marketplace'];
    if (!rig) throw new Error('no marketplace preset');
    const n = unit(rig.lights.rim.direction);
    const withRim = unoccludedRadiance(rig, [1, 1, 1], n);
    const without = unoccludedRadiance(
      { ...rig, lights: { ...rig.lights, rim: { ...rig.lights.rim, color: [0, 0, 0] } } },
      [1, 1, 1],
      n,
    );
    for (const c of [0, 1, 2] as const)
      expect(withRim[c] - without[c]).toBeCloseTo(rig.lights.rim.color[c] * Math.hypot(...rig.lights.rim.direction), 9);
  });

  // The identity that makes the path tracer converge to the preview on an unoccluded surface (lightRig.glsl).
  for (const [name, rig] of [['v0', LIGHT_RIG_V0] as const, ...Object.entries(LOOK_PRESETS)]) {
    it(`${name}: the environment radiance integrates to the hemisphere fill for any normal`, () => {
      const { sky, ground } = rig.environment;
      for (const n of [
        [0, 1, 0],
        [0, -1, 0],
        [1, 0, 0],
        [0.6, 0.8, 0],
        [0, -0.6, 0.8],
      ] as const) {
        for (const c of [0, 1, 2] as const) {
          const environment = (dy: number): number => ground[c] + (sky[c] - ground[c]) * (0.75 * dy + 0.5);
          const fill = unoccludedRadiance(domeOnly(rig), [1, 1, 1], n)[c];
          expect(cosineMean(n, environment), `n = ${n.join(', ')}, channel ${c}`).toBeCloseTo(fill, 5);
        }
      }
    });

    it(`${name}: the environment radiance is never negative`, () => {
      const { sky, ground } = rig.environment;
      for (const c of [0, 1, 2] as const) {
        expect(ground[c] - 0.25 * (sky[c] - ground[c])).toBeGreaterThanOrEqual(0);
        expect(sky[c] + 0.25 * (sky[c] - ground[c])).toBeGreaterThanOrEqual(0);
      }
    });
  }
});
