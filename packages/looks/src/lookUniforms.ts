import { isNeutralGrade } from './agxToneMap';
import type { LookPreset } from './LookPreset';

/**
 * Every uniform the look chunks declare (`lightRig`, `shadowCatcher`, `agx`, `backdrop`). A program that does not use
 * one has no location for it, and `uploadLookUniforms` skips it.
 */
export const LOOK_UNIFORM_NAMES = [
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
  'u_lookBackdropTop',
  'u_lookBackdropBottom',
  'u_lookFrameHeight',
  'u_lookExposureScale',
  'u_lookGraded',
  'u_lookSlope',
  'u_lookOffset',
  'u_lookPower',
  'u_lookSaturation',
] as const;

export type LookUniformName = (typeof LOOK_UNIFORM_NAMES)[number];

/** The part of a WebGL2 context the upload uses. */
export type LookUniformTarget = Pick<WebGL2RenderingContext, 'uniform1f' | 'uniform1i' | 'uniform3fv'>;

type Value =
  { readonly kind: 'vec3'; readonly value: Float32Array } | { readonly kind: 'float' | 'bool'; readonly value: number };

const packed = new WeakMap<LookPreset, ReadonlyMap<LookUniformName, Value>>();

function pack(look: LookPreset): ReadonlyMap<LookUniformName, Value> {
  const vec3 = (v: readonly number[]): Value => ({ kind: 'vec3', value: new Float32Array(v) });
  const float = (value: number): Value => ({ kind: 'float', value });
  const { key, fill, rim } = look.lights;
  const { grade } = look.toneMapping;
  return new Map<LookUniformName, Value>([
    ['u_lookSky', vec3(look.environment.sky)],
    ['u_lookGround', vec3(look.environment.ground)],
    ['u_lookKeyDirection', vec3(key.direction)],
    ['u_lookKeyColor', vec3(key.color)],
    // The disc's cosine in double precision, as the shaders' former constant folded it.
    ['u_lookKeyCosRadius', float(Math.cos(key.angularRadius))],
    ['u_lookFillDirection', vec3(fill.direction)],
    ['u_lookFillColor', vec3(fill.color)],
    ['u_lookRimDirection', vec3(rim.direction)],
    ['u_lookRimColor', vec3(rim.color)],
    ['u_lookCatcherStrength', float(look.catcher.strength)],
    ['u_lookBackdropTop', vec3(look.backdrop.top)],
    ['u_lookBackdropBottom', vec3(look.backdrop.bottom)],
    ['u_lookExposureScale', float(2 ** look.toneMapping.exposure)],
    ['u_lookGraded', { kind: 'bool', value: isNeutralGrade(grade) ? 0 : 1 }],
    ['u_lookSlope', vec3(grade.slope)],
    ['u_lookOffset', vec3(grade.offset)],
    ['u_lookPower', vec3(grade.power)],
    ['u_lookSaturation', float(grade.saturation)],
  ]);
}

/**
 * Uploads `look` into the program in use: `locate` gives a uniform's location (`null`: the program does not use it,
 * nothing is called). `frameHeight` is the full frame's height in pixels, which the screen-space backdrop gradient
 * spans (never a tile's). Both renderers and the light bake call it for every program that includes a look chunk,
 * once per program per frame; the values of a look are packed once and kept while it lives.
 */
export function uploadLookUniforms(
  gl: LookUniformTarget,
  locate: (name: LookUniformName) => WebGLUniformLocation | null,
  look: LookPreset,
  frameHeight: number,
): void {
  let values = packed.get(look);
  if (!values) {
    values = pack(look);
    packed.set(look, values);
  }
  for (const name of LOOK_UNIFORM_NAMES) {
    const location = locate(name);
    if (location === null) continue;
    if (name === 'u_lookFrameHeight') {
      gl.uniform1f(location, Math.max(1, frameHeight));
      continue;
    }
    const entry = values.get(name);
    if (!entry) continue;
    if (entry.kind === 'vec3') gl.uniform3fv(location, entry.value);
    else if (entry.kind === 'bool') gl.uniform1i(location, entry.value);
    else gl.uniform1f(location, entry.value);
  }
}
