import { describe, expect, it } from 'vitest';
import lightRigSource from '../src/glsl/lightRig.glsl?raw';
import type { Rgb } from '../src/agxToneMap';
import { LIGHT_RIG_V0, rimLight, rimWorldDirection, unoccludedRadiance, type LightRig } from '../src/lightRig';
import type { LookRimLight } from '../src/LookPreset';
import { DEFAULT_LOOK, LOOK_PRESETS } from '../src/lookPresets';
import { LOOK_UNIFORM_NAMES } from '../src/lookUniforms';
import { LOOK_VIEW_NONE, lookView, towardEye, type LookView } from '../src/LookView';

type V3 = readonly [number, number, number];

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const digits = (v: readonly number[]): string[] => v.map((x) => x.toFixed(12));

/** An orbit camera around the origin at yaw/pitch (degrees), as OrbitController and cameraBasis place it. */
function orbitView(yawDeg: number, pitchDeg: number, orthographic: boolean, distance = 40): LookView {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const back: V3 = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  const forward: V3 = [-back[0], -back[1], -back[2]];
  const right = unit(cross(forward, [0, 1, 0]));
  return lookView({
    position: [back[0] * distance, back[1] * distance, back[2] * distance],
    right,
    up: cross(right, forward),
    forward,
    orthographic,
  });
}

const rim = (change: Partial<LookRimLight> = {}): LookRimLight => ({
  direction: [0, 1, 0],
  color: [5, 5.4, 6.2],
  exponent: 3,
  albedoShare: 0.15,
  ...change,
});

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
      'u_lookRimExponent',
      'u_lookRimAlbedoShare',
      'u_lookEye',
      'u_lookCatcherStrength',
    ] as const) {
      expect(LOOK_UNIFORM_NAMES).toContain(name);
      expect(lightRigSource).toMatch(new RegExp(`^uniform (vec3|vec4|float) ${name};$`, 'm'));
    }
    expect(lightRigSource).not.toMatch(/^const /m);
    expect(lightRigSource).toContain('vec3 rimLight(vec3 n, vec3 v, vec3 albedo)');
    expect(lightRigSource).toContain('vec3 fillLight(vec3 n)');
    expect(lightRigSource).toContain('vec3 towardEye(vec3 p)');
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

  it('adds the fill accent by the cosine of its direction, without shadow', () => {
    const rig = LOOK_PRESETS['marketplace'];
    if (!rig) throw new Error('no marketplace preset');
    const n = unit(rig.lights.fill.direction);
    const withFill = unoccludedRadiance(rig, [1, 1, 1], n);
    const without = unoccludedRadiance(
      { ...rig, lights: { ...rig.lights, fill: { ...rig.lights.fill, color: [0, 0, 0] } } },
      [1, 1, 1],
      n,
    );
    for (const c of [0, 1, 2] as const) expect(withFill[c] - without[c]).toBeCloseTo(rig.lights.fill.color[c], 9);
  });

  it('adds the rim only with a camera, as rimLight in the view turned to world space', () => {
    const rig = LOOK_PRESETS['marketplace'];
    if (!rig) throw new Error('no marketplace preset');
    const view = orbitView(30, 20, false);
    const n = unit(rimWorldDirection([-1, 0.2, 0], view));
    const v = towardEye(view, [0, 0, 0]);
    const albedo: Rgb = [0.6, 0.2, 0.1];
    const seen = unoccludedRadiance(rig, albedo, n, { v, view });
    const unseen = unoccludedRadiance(rig, albedo, n);
    const r = rimLight(rig.lights.rim, rimWorldDirection(rig.lights.rim.direction, view), n, v, albedo);
    expect(r[0]).toBeGreaterThan(0.5);
    for (const c of [0, 1, 2] as const) expect(seen[c] - unseen[c]).toBeCloseTo(r[c], 12);
  });

  it('Studio with a camera: bit-equal to the shading before the rim was view-relative (its rim is black)', () => {
    const view = orbitView(30, 20, false);
    const { key, fill, rim: black } = DEFAULT_LOOK.lights;
    const { sky, ground } = DEFAULT_LOOK.environment;
    const normals: V3[] = [[0, 1, 0], unit([0.3, -0.2, 0.9]), unit([-1, 0.1, 0.2])];
    const albedos: Rgb[] = [
      [1, 1, 1],
      [0.8, 0.1, 0.3],
    ];
    for (const n of normals) {
      for (const albedo of albedos) {
        const t = n[1] * 0.5 + 0.5;
        const l = (d: V3) => Math.max(0, dot(n, d));
        const before = ([0, 1, 2] as const).map(
          (c) =>
            albedo[c] *
            (ground[c] +
              (sky[c] - ground[c]) * t +
              key.color[c] * l(key.direction) +
              fill.color[c] * l(fill.direction) +
              black.color[c] * l(black.direction)),
        );
        const v = towardEye(view, [0, 0, 0]);
        expect(unoccludedRadiance(DEFAULT_LOOK, albedo, n, { v, view })).toEqual(before);
      }
    }
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

describe('rim light', () => {
  const l: V3 = [0, 1, 0];
  const toward: V3 = [0, 0, 1];

  it('is exactly 0 on a surface facing the eye, where the rim is behind the normal, and when black', () => {
    expect(rimLight(rim(), l, [0, 0, 1], toward, [1, 1, 1])).toEqual([0, 0, 0]);
    expect(rimLight(rim(), l, [0, -1, 0], toward, [1, 1, 1])).toEqual([0, 0, 0]);
    expect(rimLight(rim(), l, [1, 0, 0], toward, [1, 1, 1])).toEqual([0, 0, 0]);
    expect(rimLight(rim({ color: [0, 0, 0] }), l, [0, 1, 0], toward, [1, 1, 1])).toEqual([0, 0, 0]);
  });

  it('grazing: near-white on a saturated texel, its own colour at albedo share 0, tinted at 1', () => {
    const n = unit([0, 0.8, -0.6]);
    const albedo: Rgb = [0.1, 0.2, 0.8];
    const facing = dot(n, l);
    const color = rim().color;
    const r = rimLight(rim(), l, n, toward, albedo);
    for (const c of [0, 1, 2] as const) expect(r[c]).toBeGreaterThanOrEqual(0.85 * color[c] * facing - 1e-12);
    const own = rimLight(rim({ albedoShare: 0 }), l, n, toward, albedo);
    for (const c of [0, 1, 2] as const) expect(own[c]).toBeCloseTo(color[c] * facing, 12);
    const tinted = rimLight(rim({ albedoShare: 1 }), l, n, toward, albedo);
    for (const c of [0, 1, 2] as const) expect(tinted[c]).toBeCloseTo(color[c] * facing * albedo[c], 12);
  });

  it('falls off as (1 - n.v)^exponent toward the eye', () => {
    const n = unit([0, 1, 1]);
    const g = 1 - dot(n, toward);
    for (const exponent of [1, 3, 16]) {
      const r = rimLight(rim({ exponent, albedoShare: 0 }), l, n, toward, [1, 1, 1]);
      expect(r[0]).toBeCloseTo(5 * g ** exponent * dot(n, l), 12);
    }
  });

  it('turns from view into world space: 12 yaws round-trip, perspective and orthographic', () => {
    const d = unit([-0.55, 0.45, -0.7]);
    for (let yaw = 0; yaw < 360; yaw += 30) {
      for (const orthographic of [false, true]) {
        const view = orbitView(yaw, 20, orthographic);
        const w = rimWorldDirection(d, view);
        expect(Math.hypot(...w)).toBeCloseTo(1, 12);
        expect(digits([dot(w, view.right), dot(w, view.up), dot(w, view.back)])).toEqual(digits(d));
        // Screen left and behind the model from every yaw.
        expect(dot(w, view.right)).toBeLessThan(0);
        expect(dot(w, view.back)).toBeLessThan(0);
      }
    }
  });

  it('the eye: a point in perspective, the back direction in orthographic; the identity for the bake', () => {
    const persp = orbitView(30, 20, false, 40);
    expect(persp.eye[3]).toBe(1);
    const p: V3 = [1, 2, 3];
    const toEye: V3 = [persp.eye[0] - 1, persp.eye[1] - 2, persp.eye[2] - 3];
    expect(digits(towardEye(persp, p))).toEqual(digits(unit(toEye)));
    const ortho = orbitView(30, 20, true);
    expect(ortho.eye).toEqual([...ortho.back, 0]);
    expect(towardEye(ortho, p)).toEqual([...ortho.back]);
    expect(rimWorldDirection([0.2, 0.3, 0.9], LOOK_VIEW_NONE)).toEqual([0.2, 0.3, 0.9]);
    expect(Object.isFrozen(LOOK_VIEW_NONE)).toBe(true);
  });
});
