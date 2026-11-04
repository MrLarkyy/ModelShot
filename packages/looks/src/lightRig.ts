import type { Rgb } from './agxToneMap';
import type { Direction, LookDomeEnvironment, LookEnvironment, LookPreset, LookRimLight } from './LookPreset';
import type { LookView } from './LookView';

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
    rim: Object.freeze({
      direction: Object.freeze([0, 1, 0] as const),
      color: Object.freeze([0, 0, 0] as const),
      exponent: 4,
      albedoShare: 1,
    }),
  }),
  environment: Object.freeze({
    kind: 'dome',
    sky: Object.freeze([0.5, 0.52, 0.55] as const),
    ground: Object.freeze([0.2, 0.19, 0.18] as const),
  }),
  catcher: Object.freeze({ strength: 1 }),
});

const dot = (a: Direction, b: Direction): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lambert = (n: Direction, l: Direction): number => Math.max(0, dot(n, l));

/** The rim's view-space `direction` (x right, y up, z toward the camera) in world space under `view`. */
export function rimWorldDirection(direction: Direction, view: Pick<LookView, 'right' | 'up' | 'back'>): Direction {
  const { right: r, up: u, back: b } = view;
  const [x, y, z] = direction;
  return [x * r[0] + y * u[0] + z * b[0], x * r[1] + y * u[1] + z * b[1], x * r[2] + y * u[2] + z * b[2]];
}

/**
 * The rim's radiance (rimLight of the lightRig chunk) on a surface of linear `albedo` with unit normal `n`, seen along
 * unit `v` toward the eye; `l` the rim's world direction (`rimWorldDirection`).
 */
export function rimLight(rim: LookRimLight, l: Direction, n: Direction, v: Direction, albedo: Rgb): Rgb {
  const grazing = 1 - Math.min(1, Math.max(0, dot(n, v)));
  const facing = lambert(n, l);
  const strength = grazing > 0 && facing > 0 ? grazing ** rim.exponent * facing : 0;
  const channel = (c: 0 | 1 | 2): number => rim.color[c] * (strength * (1 + (albedo[c] - 1) * rim.albedoShare));
  return [channel(0), channel(1), channel(2)];
}

/** `hemisphereFill` of the lightRig chunk under a dome: its sky/ground mix at the unit normal n. */
export function domeFill(environment: LookDomeEnvironment, n: Direction): Rgb {
  const { sky, ground } = environment;
  const t = n[1] * 0.5 + 0.5;
  return [
    ground[0] + (sky[0] - ground[0]) * t,
    ground[1] + (sky[1] - ground[1]) * t,
    ground[2] + (sky[2] - ground[2]) * t,
  ];
}

function domeOnly(environment: LookEnvironment, n: Direction): Rgb {
  if (environment.kind !== 'dome') {
    throw new TypeError('unoccludedRadiance under an image environment needs its fill: pass environmentFill');
  }
  return domeFill(environment, n);
}

/**
 * Linear radiance a diffuse surface of linear `albedo` with unit normal `n` reflects under `rig` when nothing occludes
 * it: the preview's shading, and the value the path tracer converges to (the environment's `hemisphereFill`, the key,
 * and the unshadowed fill accent; with `camera`, `v` the unit vector toward its eye, also the rim, which exists only
 * where a camera sees the surface). `fill` gives `hemisphereFill`: a dome's by default; a rig with an image needs
 * `environmentFill`, which this module does not import, so it stays free of the bundled image (Node-side tests import
 * it directly).
 */
export function unoccludedRadiance(
  rig: LightRig,
  albedo: Rgb,
  n: Direction,
  camera?: { readonly v: Direction; readonly view: LookView },
  fill: (environment: LookEnvironment, n: Direction) => Rgb = domeOnly,
): Rgb {
  const { key, fill: accent, rim } = rig.lights;
  const ambient = fill(rig.environment, n);
  const k = lambert(n, key.direction);
  const f = lambert(n, accent.direction);
  const channel = (c: 0 | 1 | 2): number => albedo[c] * (ambient[c] + key.color[c] * k + accent.color[c] * f);
  const diffuse: Rgb = [channel(0), channel(1), channel(2)];
  if (!camera) return diffuse;
  const rimRadiance = rimLight(rim, rimWorldDirection(rim.direction, camera.view), n, camera.v, albedo);
  return [diffuse[0] + rimRadiance[0], diffuse[1] + rimRadiance[1], diffuse[2] + rimRadiance[2]];
}
