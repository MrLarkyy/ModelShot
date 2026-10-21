import agx from './glsl/agx.glsl?raw';
import edgeRounding from './glsl/edgeRounding.glsl?raw';
import faceTexels from './glsl/faceTexels.glsl?raw';
import lightRig from './glsl/lightRig.glsl?raw';
import shadowCatcher from './glsl/shadowCatcher.glsl?raw';
import texelAlpha from './glsl/texelAlpha.glsl?raw';
import type { ShaderChunks } from './linkShader';

/**
 * GLSL chunks every renderer includes through `linkShader`, so the preview and the path tracer tone-map, classify
 * texel alpha, clamp to a face's texels and light identically: `#include "agx"` (`vec3 agxToneMap(vec3)`),
 * `#include "texelAlpha"` (`int texelCoverage(float alpha, int mode, int cutoffByte)`), `#include "faceTexels"`
 * (`ivec4 faceTexelRange(vec4 uvRect, vec2 size)`) and `#include "lightRig"` (the v0 rig: `SKY_FILL`, `GROUND_FILL`,
 * `KEY_DIRECTION`, `KEY_COLOR`, `KEY_ANGULAR_RADIUS`, `CATCHER_STRENGTH`, `vec3 hemisphereFill(vec3 n)`,
 * `vec3 environmentRadiance(vec3 d)`) and `#include "shadowCatcher"`
 * (`float catcherShade(vec3 fill, float keyT, vec2 xz, vec4 rect)`) and `#include "edgeRounding"`
 * (`vec3 roundedNormal(vec3 n, vec4 d, vec4 angle, vec3 t[4], float width, vec4 footprint)`, the `EdgeLook` fillet).
 */
export const lookShaderChunks: ShaderChunks = Object.freeze({
  agx,
  texelAlpha,
  faceTexels,
  lightRig,
  shadowCatcher,
  edgeRounding,
});
