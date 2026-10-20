import agx from './glsl/agx.glsl?raw';
import texelAlpha from './glsl/texelAlpha.glsl?raw';
import type { ShaderChunks } from './linkShader';

/**
 * GLSL chunks every renderer includes through `linkShader`, so the preview and the path tracer tone-map and classify
 * texel alpha identically: `#include "agx"` (`vec3 agxToneMap(vec3)`) and `#include "texelAlpha"`
 * (`int texelCoverage(float alpha, int mode, int cutoffByte)`).
 */
export const lookShaderChunks: ShaderChunks = Object.freeze({ agx, texelAlpha });
