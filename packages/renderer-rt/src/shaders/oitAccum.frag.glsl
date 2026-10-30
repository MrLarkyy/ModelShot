#version 300 es
precision highp float;
precision highp int;

#include "texelSample"
#include "texelAlpha"
#include "shading"
#include "bakedLight"
#include "depthKey"

uniform sampler2D u_texture;
uniform bool u_texelAntialias;
uniform int u_alphaMode;
uniform int u_alphaCutoffByte;
uniform int u_seamCoverage;

in vec2 v_uv;
flat in vec4 v_uvRect;
flat in int v_textureFlags;

// Blended with (ONE, ONE) for rgb and (ZERO, ONE_MINUS_SRC_ALPHA) for alpha on both targets:
// target 0 rgb = sum of weighted premultiplied colour, a = product of (1 - alpha) (revealage, cleared to 1);
// target 1 r = sum of weighted alpha.
layout(location = 0) out vec4 outAccum;
layout(location = 1) out vec4 outWeight;

// Rounds to half precision so the blend sums of two layers are exact in either order: the accumulation targets are
// RGBA16F, and a value already representable there makes a + b and b + a round identically.
vec3 toHalf(vec3 v) {
  return vec3(unpackHalf2x16(packHalf2x16(v.xy)), unpackHalf2x16(packHalf2x16(vec2(v.z, 0.0))).x);
}

float toHalf(float v) {
  return unpackHalf2x16(packHalf2x16(vec2(v, 0.0))).x;
}

// Partial taps' share; opaque taps count as a partial nearest texel's alpha or 1 (oitSeamCoverage.ts).
float partialSeamCoverage(TexelSample s) {
  float partialTaps = s.premultiplied.a - s.opaqueCoverage;
  float opaqueTaps = s.coverage != COVERAGE_PARTIAL ? 0.0 : u_seamCoverage == 2 ? 1.0 : s.nearestAlpha;
  return clamp(partialTaps + s.opaqueCoverage * opaqueTaps, 0.0, 1.0);
}

// Weighted blended order-independent transparency (McGuire and Bavoil 2013, equation 10) for partial texels.
void main() {
  prepareDepthKey();
  prepareShading();
  TexelSample s =
    sampleTexels(u_texture, v_uv, v_uvRect, v_textureFlags, u_texelAntialias, u_alphaMode, u_alphaCutoffByte);
  vec4 light = vec4(1.0);
  if (u_bakeOn) light = sampleBakedLight(v_uv, v_uvRect);
  float coverage = s.nearestAlpha;
  if (u_seamCoverage == 0) {
    if (s.coverage != COVERAGE_PARTIAL) discard;
  } else {
    if (s.coverage == COVERAGE_OPAQUE) discard;
    coverage = partialSeamCoverage(s);
    if (coverage <= 0.0) discard;
  }
  float alpha = 1.0 - toHalf(1.0 - coverage);
  vec3 color = shadeLit(sampleColor(s), shadingNormal(), light);
  float d = 1.0 - gl_FragCoord.z;
  float weight = alpha * clamp(3.0e3 * d * d * d, 1.0e-2, 3.0e3);
  outAccum = vec4(toHalf(color * weight * alpha), alpha);
  outWeight = vec4(toHalf(weight * alpha), 0.0, 0.0, alpha);
  writeDepthKey();
}
