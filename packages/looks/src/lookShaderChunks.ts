import agx from './glsl/agx.glsl?raw';
import backdrop from './glsl/backdrop.glsl?raw';
import edgeRounding from './glsl/edgeRounding.glsl?raw';
import faceTexels from './glsl/faceTexels.glsl?raw';
import lightRig from './glsl/lightRig.glsl?raw';
import shadowCatcher from './glsl/shadowCatcher.glsl?raw';
import texelAlpha from './glsl/texelAlpha.glsl?raw';
import type { ShaderChunks } from './linkShader';

/**
 * GLSL chunks every renderer includes through `linkShader`, so the preview and the path tracer tone-map, classify
 * texel alpha, address a face's texels and light identically: `#include "agx"` (`vec3 agxToneMap(vec3)`, with the
 * look's exposure and grade), `#include "texelAlpha"` (`int texelCoverage(float alpha, int mode, int cutoffByte)`),
 * `#include "faceTexels"` (`ivec4 faceTexelRange(vec4 uvRect, vec2 size)`, `ivec2 faceTexel(ivec2 texel, ivec4 range,
 * ivec2 size, int flags)`: the texel a lookup reads, clamped or repeated by `textureSamplingFlags`),
 * `#include "lightRig"` (the look's rig as `u_look*` uniforms, `vec3 hemisphereFill(vec3 n)`, `vec3 environmentRadiance(vec3 d)`, `vec3 fillLight(vec3 n)`,
 * `vec3 towardEye(vec3 p)`, `vec3 rimLight(vec3 n, vec3 v, vec3 albedo)`),
 * `#include "backdrop"` (`vec3 backdropAt(float yNorm)`, `vec3 backdropHere()`), `#include "shadowCatcher"`
 * (`float catcherShade(vec3 fill, float keyT, vec2 xz, vec4 rect)`) and `#include "edgeRounding"`
 * (`vec3 roundedNormal(vec3 n, vec4 d, vec4 angle, vec3 t[4], float width, vec4 footprint)`, the `EdgeLook` fillet).
 * The look's uniforms (`LOOK_UNIFORM_NAMES`) are set by `uploadLookUniforms`.
 */
export const lookShaderChunks: ShaderChunks = Object.freeze({
  agx,
  texelAlpha,
  faceTexels,
  lightRig,
  backdrop,
  shadowCatcher,
  edgeRounding,
});
