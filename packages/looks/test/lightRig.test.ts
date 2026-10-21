import { describe, expect, it } from 'vitest';
import lightRigSource from '../src/glsl/lightRig.glsl?raw';
import { LIGHT_RIG_V0, unoccludedRadiance } from '../src/lightRig';

function glslVec3(name: string): number[] {
  const match = new RegExp(`const vec3 ${name} = vec3\\(([^)]*)\\);`).exec(lightRigSource);
  if (!match?.[1]) throw new Error(`${name} not found in lightRig.glsl`);
  return match[1].split(',').map(Number);
}

function glslFloat(name: string): number {
  const match = new RegExp(`const float ${name} = ([0-9.eE+-]+);`).exec(lightRigSource);
  if (!match?.[1]) throw new Error(`${name} not found in lightRig.glsl`);
  return Number(match[1]);
}

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

describe('light rig v0', () => {
  it('mirrors the constants of lightRig.glsl', () => {
    expect(glslVec3('SKY_FILL')).toEqual([...LIGHT_RIG_V0.skyFill]);
    expect(glslVec3('GROUND_FILL')).toEqual([...LIGHT_RIG_V0.groundFill]);
    expect(glslVec3('KEY_DIRECTION')).toEqual([...LIGHT_RIG_V0.keyDirection]);
    expect(glslVec3('KEY_COLOR')).toEqual([...LIGHT_RIG_V0.keyColor]);
    expect(Math.hypot(...LIGHT_RIG_V0.keyDirection)).toBeCloseTo(1, 4);
    expect(glslFloat('KEY_ANGULAR_RADIUS')).toBe(LIGHT_RIG_V0.keyAngularRadius);
    expect(glslFloat('CATCHER_STRENGTH')).toBe(LIGHT_RIG_V0.catcherStrength);
  });

  it('shades like the preview: fill by the normal plus the key', () => {
    const up = unoccludedRadiance(LIGHT_RIG_V0, [1, 1, 1], [0, 1, 0]);
    expect(up[0]).toBeCloseTo(0.5 + 1.25 * 0.79808, 6);
    const down = unoccludedRadiance(LIGHT_RIG_V0, [0.5, 0.5, 0.5], [0, -1, 0]);
    expect(down[0]).toBeCloseTo(0.1, 9);
    expect(down[2]).toBeCloseTo(0.09, 9);
  });

  // The identity that makes the path tracer converge to the preview on an unoccluded surface (lightRig.glsl).
  it('the environment radiance integrates to the hemisphere fill for any normal', () => {
    const { skyFill, groundFill } = LIGHT_RIG_V0;
    for (const n of [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0, 0],
      [0.6, 0.8, 0],
      [0, -0.6, 0.8],
    ] as const) {
      for (const c of [0, 1, 2] as const) {
        const environment = (dy: number): number => groundFill[c] + (skyFill[c] - groundFill[c]) * (0.75 * dy + 0.5);
        const fill = unoccludedRadiance({ ...LIGHT_RIG_V0, keyColor: [0, 0, 0] }, [1, 1, 1], n)[c];
        expect(cosineMean(n, environment), `n = ${n.join(', ')}, channel ${c}`).toBeCloseTo(fill, 5);
      }
    }
  });

  it('the environment radiance stays positive straight down', () => {
    const { skyFill, groundFill } = LIGHT_RIG_V0;
    for (const c of [0, 1, 2] as const) expect(groundFill[c] - 0.25 * (skyFill[c] - groundFill[c])).toBeGreaterThan(0);
  });
});
