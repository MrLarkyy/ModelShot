import agx from './glsl/agx.glsl?raw';
import faceTexels from './glsl/faceTexels.glsl?raw';
import lightRig from './glsl/lightRig.glsl?raw';
import texelAlpha from './glsl/texelAlpha.glsl?raw';
import type { ShaderChunks } from './linkShader';

/**
 * GLSL chunks every renderer includes through `linkShader`, so the preview and the path tracer tone-map, classify
 * texel alpha, clamp to a face's texels and light identically: `#include "agx"` (`vec3 agxToneMap(vec3)`),
 * `#include "texelAlpha"` (`int texelCoverage(float alpha, int mode, int cutoffByte)`), `#include "faceTexels"`
 * (`ivec4 faceTexelRange(vec4 uvRect, vec2 size)`) and `#include "lightRig"` (the v0 rig: `SKY_FILL`, `GROUND_FILL`,
 * `KEY_DIRECTION`, `KEY_COLOR`, `vec3 hemisphereFill(vec3 n)`, `vec3 environmentRadiance(vec3 d)`).
 */
export const lookShaderChunks: ShaderChunks = Object.freeze({ agx, texelAlpha, faceTexels, lightRig });
