import type { Rgb } from './agxToneMap';
import type { EdgeLook } from './EdgeLook';

/** The `format` field of every look preset file. */
export const LOOK_FORMAT = 'modelshot-look';

/** The look preset format this build reads and writes; a breaking change of the format raises it. */
export const LOOK_FORMAT_VERSION = 1;

/** Unit vector (toward a light, or up), in world space unless its field says otherwise. */
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

/**
 * The rim: a view-relative accent at grazing angles that draws a line along the silhouettes, added as radiance:
 * `color × (1 − clamp(n · v, 0, 1))^exponent × max(n · l, 0) × mix(1, albedo, albedoShare)`, v the unit vector toward
 * the eye and l `direction` turned from view into world space every frame. Camera-facing surfaces get none.
 */
export interface LookRimLight {
  /** Unit vector toward the light in view space: x right, y up, z toward the camera (−z points into the screen). */
  readonly direction: Direction;
  /** Scene-linear colour, 0..16 per channel. */
  readonly color: Rgb;
  /** 1..16: the higher, the closer to the silhouette the rim stays. */
  readonly exponent: number;
  /** 0..1: 0 the rim has its own colour on any texel (a white line on a red texel), 1 it is tinted like diffuse light. */
  readonly albedoShare: number;
}

export interface LookLights {
  readonly key: LookKeyLight;
  /**
   * A world-space diffuse accent, unshadowed: in the preview and at the path tracer's camera hit only, never in the
   * light bake.
   */
  readonly fill: LookDirectionalLight;
  /** A view-relative grazing accent, unshadowed: in the preview and at the path tracer's camera hit only, never baked. */
  readonly rim: LookRimLight;
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
  /** Display name, 1..64 code points, well-formed UTF-16, no C0, DEL or C1 control characters. */
  readonly name: string;
  readonly lights: LookLights;
  readonly environment: LookEnvironment;
  readonly backdrop: LookBackdrop;
  readonly catcher: LookCatcher;
  readonly edges: EdgeLook;
  readonly toneMapping: LookToneMapping;
}
