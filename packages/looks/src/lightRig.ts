import type { Rgb } from './agxToneMap';

/** The v0 look: the light rig of `glsl/lightRig.glsl` (the shaders' one source) and the backdrop both renderers read. */
export interface LightRig {
  readonly skyFill: Rgb;
  readonly groundFill: Rgb;
  /** Unit vector towards the directional key. */
  readonly keyDirection: readonly [number, number, number];
  readonly keyColor: Rgb;
  /** Scene-linear backdrop behind the model: the preview's clear colour and the path tracer's escaped camera rays. */
  readonly background: Rgb;
  /**
   * Angular radius in radians of the key light's disc: its shadows soften with the distance to the occluder. The path
   * tracer and the light bake sample visibility in this cone; the key's cosine stays that of `keyDirection`.
   */
  readonly keyAngularRadius: number;
  /** How much of the light a fully shadowed shadow-catcher point loses (0 none, 1 all): `catcherShade`. */
  readonly catcherStrength: number;
}

export const LIGHT_RIG_V0: LightRig = Object.freeze({
  skyFill: [0.5, 0.52, 0.55],
  groundFill: [0.2, 0.19, 0.18],
  keyDirection: [0.39904, 0.79808, 0.4514],
  keyColor: [1.25, 1.22, 1.18],
  background: [0.14, 0.15, 0.17],
  keyAngularRadius: 0.04,
  catcherStrength: 0.8,
} as const);

/**
 * Linear radiance a diffuse surface of linear `albedo` with unit normal `n` reflects under `rig` when nothing occludes
 * it: the preview's shading, and the value the path tracer converges to (`hemisphereFill` plus the key).
 */
export function unoccludedRadiance(rig: LightRig, albedo: Rgb, n: readonly [number, number, number]): Rgb {
  const t = n[1] * 0.5 + 0.5;
  const key = Math.max(0, n[0] * rig.keyDirection[0] + n[1] * rig.keyDirection[1] + n[2] * rig.keyDirection[2]);
  const channel = (c: 0 | 1 | 2): number =>
    albedo[c] * (rig.groundFill[c] + (rig.skyFill[c] - rig.groundFill[c]) * t + rig.keyColor[c] * key);
  return [channel(0), channel(1), channel(2)];
}
