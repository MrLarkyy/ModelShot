import type { Rgb } from './agxToneMap';
import type { EdgeLook } from './EdgeLook';

/** The `format` field of every look preset file. */
export const LOOK_FORMAT = 'modelshot-look';

/** The look preset format this build reads and writes; a breaking change of the format raises it. */
export const LOOK_FORMAT_VERSION = 1;

/** World-space unit vector (toward a light, or up). */
export type Direction = readonly [number, number, number];

/** A directional light without shadows: `color × max(n · direction, 0)` on a diffuse surface of unit albedo. */
export interface LookDirectionalLight {
  /** Unit vector toward the light, in world space (a model faces −z). */
  readonly direction: Direction;
  /** Scene-linear colour, 0..16 per channel. */
  readonly color: Rgb;
}

/** The key: a directional disc light that casts the soft shadows (path tracer, light bake, shadow catcher). */
export interface LookKeyLight extends LookDirectionalLight {
  /** Angular radius of the disc in radians, 0..0.1: shadows soften with the distance to the occluder. */
  readonly angularRadius: number;
}

export interface LookLights {
  readonly key: LookKeyLight;
  /** An unshadowed accent, in the preview, the path tracer and the light bake alike. */
  readonly fill: LookDirectionalLight;
  /** An unshadowed accent from behind the model, lighting its silhouettes. */
  readonly rim: LookDirectionalLight;
}

/**
 * The environment: an analytic sky/ground dome, radiance linear in the direction's y. Each channel of `sky` and
 * `ground` stays within five times the other, so the dome is nowhere negative (`docs/look-presets.md`).
 */
export interface LookEnvironment {
  readonly kind: 'dome';
  readonly sky: Rgb;
  readonly ground: Rgb;
}

/** Scene-linear backdrop behind the model, interpolated in screen y from `bottom` (lowest row) to `top`. */
export interface LookBackdrop {
  readonly top: Rgb;
  readonly bottom: Rgb;
}

export interface LookCatcher {
  /** How much of the light a fully shadowed shadow-catcher point loses: 0 none, 1 all. */
  readonly strength: number;
}

/** ASC CDL in AgX's log space (after the contrast curve), then saturation about Rec.709 luma. */
export interface LookGrade {
  readonly slope: Rgb;
  readonly offset: Rgb;
  readonly power: Rgb;
  readonly saturation: number;
}

export interface LookToneMapping {
  readonly kind: 'agx';
  /** Stops applied to the scene-linear colour before AgX, −6..6. */
  readonly exposure: number;
  readonly grade: LookGrade;
}

/**
 * A look preset: everything that makes one look, as data (`docs/look-presets.md`, format `modelshot-look` v1). The
 * realtime preview, the path tracer and the light bake read the same object. Check untrusted input with
 * `checkLookPreset` or `parseLookPreset`.
 */
export interface LookPreset {
  readonly format: typeof LOOK_FORMAT;
  readonly version: typeof LOOK_FORMAT_VERSION;
  /** `[a-z0-9-]{1,32}`. */
  readonly id: string;
  /** Display name, 1..64 characters, no control characters. */
  readonly name: string;
  readonly lights: LookLights;
  readonly environment: LookEnvironment;
  readonly backdrop: LookBackdrop;
  readonly catcher: LookCatcher;
  readonly edges: EdgeLook;
  readonly toneMapping: LookToneMapping;
}
