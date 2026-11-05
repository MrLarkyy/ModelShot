import { isNeutralGrade } from './agxToneMap';
import { environmentSh } from './environmentSh';
import { environmentYaw } from './equirect';
import { rimWorldDirection } from './lightRig';
import type { LookPreset } from './LookPreset';
import type { LookView } from './LookView';

/**
 * Every uniform the look chunks declare (`lightRig`, `shadowCatcher`, `agx`, `backdrop`). A program that does not use
 * one has no location for it, and `uploadLookUniforms` skips it.
 */
export const LOOK_UNIFORM_NAMES = [
  'u_lookEnvironmentKind',
  'u_lookSky',
  'u_lookGround',
  'u_lookEnvironmentSh',
  'u_lookEnvironmentYaw',
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
export type LookUniformTarget = Pick<
  WebGL2RenderingContext,
  'uniform1f' | 'uniform1i' | 'uniform2fv' | 'uniform3fv' | 'uniform4fv'
>;

type Value =
  | { readonly kind: 'vec2' | 'vec3'; readonly value: Float32Array }
  | { readonly kind: 'float' | 'bool' | 'int'; readonly value: number };

/** An image's nine RGB coefficients are 27 floats; a dome uploads zeros (its branch never reads them). */
const NO_SH = new Float32Array(27);

const packed = new WeakMap<LookPreset, ReadonlyMap<LookUniformName, Value>>();

function pack(look: LookPreset): ReadonlyMap<LookUniformName, Value> {
  const vec3 = (v: readonly number[]): Value => ({ kind: 'vec3', value: new Float32Array(v) });
  const float = (value: number): Value => ({ kind: 'float', value });
  const { key, fill, rim } = look.lights;
  const { grade } = look.toneMapping;
  const env = look.environment;
  const image = env.kind === 'hdri';
  return new Map<LookUniformName, Value>([
    ['u_lookEnvironmentKind', { kind: 'int', value: image ? 1 : 0 }],
    ['u_lookSky', vec3(image ? [0, 0, 0] : env.sky)],
    ['u_lookGround', vec3(image ? [0, 0, 0] : env.ground)],
    ['u_lookEnvironmentSh', { kind: 'vec3', value: image ? environmentSh(env) : NO_SH }],
    [
      'u_lookEnvironmentYaw',
      { kind: 'vec2', value: new Float32Array(image ? environmentYaw(env.rotationDeg) : [1, 0]) },
    ],
    ['u_lookKeyDirection', vec3(key.direction)],
    ['u_lookKeyColor', vec3(key.color)],
    // The disc's cosine in double precision, as the shaders' former constant folded it.
    ['u_lookKeyCosRadius', float(Math.cos(key.angularRadius))],
    ['u_lookFillDirection', vec3(fill.direction)],
    ['u_lookFillColor', vec3(fill.color)],
    ['u_lookRimColor', vec3(rim.color)],
    ['u_lookRimExponent', float(rim.exponent)],
    ['u_lookRimAlbedoShare', float(rim.albedoShare)],
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
 * spans (never a tile's). `view` is the frame's camera (`lookView`), which the rim's direction and the eye follow;
 * `LOOK_VIEW_NONE` for the light bake. Both renderers and the light bake call it for every program that includes a
 * look chunk, once per program per frame; the values of a look are packed once and kept while it lives.
 */
export function uploadLookUniforms(
  gl: LookUniformTarget,
  locate: (name: LookUniformName) => WebGLUniformLocation | null,
  look: LookPreset,
  frameHeight: number,
  view: LookView,
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
    if (name === 'u_lookRimDirection') {
      gl.uniform3fv(location, new Float32Array(rimWorldDirection(look.lights.rim.direction, view)));
      continue;
    }
    if (name === 'u_lookEye') {
      gl.uniform4fv(location, new Float32Array(view.eye));
      continue;
    }
    const entry = values.get(name);
    if (!entry) continue;
    switch (entry.kind) {
      case 'vec3':
        gl.uniform3fv(location, entry.value);
        break;
      case 'vec2':
        gl.uniform2fv(location, entry.value);
        break;
      case 'bool':
      case 'int':
        gl.uniform1i(location, entry.value);
        break;
      case 'float':
        gl.uniform1f(location, entry.value);
    }
  }
}
