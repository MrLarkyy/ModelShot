import type { Rgb } from './agxToneMap';
import type { Direction, LookPreset } from './LookPreset';

/** The lighting part of a look: what `glsl/lightRig.glsl` reads from the look's uniforms. */
export type LightRig = Pick<LookPreset, 'lights' | 'environment' | 'catcher'>;

/**
 * The v0 rig, the compile-time constants of `glsl/lightRig.glsl` before looks were data: the Studio preset must equal
 * it, which is what keeps every golden of the v0 look unchanged.
 */
export const LIGHT_RIG_V0: LightRig = Object.freeze({
  lights: Object.freeze({
    key: Object.freeze({
      direction: Object.freeze([0.39904, 0.79808, 0.4514] as const),
      color: Object.freeze([1.25, 1.22, 1.18] as const),
      angularRadius: 0.04,
    }),
    fill: Object.freeze({ direction: Object.freeze([0, 1, 0] as const), color: Object.freeze([0, 0, 0] as const) }),
    rim: Object.freeze({ direction: Object.freeze([0, 1, 0] as const), color: Object.freeze([0, 0, 0] as const) }),
  }),
  environment: Object.freeze({
    kind: 'dome',
    sky: Object.freeze([0.5, 0.52, 0.55] as const),
    ground: Object.freeze([0.2, 0.19, 0.18] as const),
  }),
  catcher: Object.freeze({ strength: 1 }),
});

const lambert = (n: Direction, l: Direction): number => Math.max(0, n[0] * l[0] + n[1] * l[1] + n[2] * l[2]);

/**
 * Linear radiance a diffuse surface of linear `albedo` with unit normal `n` reflects under `rig` when nothing occludes
 * it: the preview's shading, and the value the path tracer converges to (the dome's `hemisphereFill`, the key, and the
 * unshadowed fill and rim accents).
 */
export function unoccludedRadiance(rig: LightRig, albedo: Rgb, n: Direction): Rgb {
  const { key, fill, rim } = rig.lights;
  const { sky, ground } = rig.environment;
  const t = n[1] * 0.5 + 0.5;
  const k = lambert(n, key.direction);
  const f = lambert(n, fill.direction);
  const r = lambert(n, rim.direction);
  const channel = (c: 0 | 1 | 2): number =>
    albedo[c] * (ground[c] + (sky[c] - ground[c]) * t + key.color[c] * k + fill.color[c] * f + rim.color[c] * r);
  return [channel(0), channel(1), channel(2)];
}
