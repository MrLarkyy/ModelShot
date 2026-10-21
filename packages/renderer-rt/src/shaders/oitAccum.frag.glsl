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

in vec3 v_normal;
in vec2 v_uv;
flat in vec4 v_uvRect;

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

// Weighted blended order-independent transparency (McGuire and Bavoil 2013, equation 10) for partial texels.
void main() {
  prepareDepthKey();
  prepareEdges();
  TexelSample s = sampleTexels(u_texture, v_uv, v_uvRect, u_texelAntialias, u_alphaMode, u_alphaCutoffByte);
  vec4 light = vec4(1.0);
  if (u_bakeOn) light = sampleBakedLight(v_uv, v_uvRect);
  if (s.coverage != COVERAGE_PARTIAL) discard;
  float alpha = 1.0 - toHalf(1.0 - s.nearestAlpha);
  vec3 color = shadeLit(sampleColor(s), shadingNormal(v_normal), light);
  float d = 1.0 - gl_FragCoord.z;
  float weight = alpha * clamp(3.0e3 * d * d * d, 1.0e-2, 3.0e3);
  outAccum = vec4(toHalf(color * weight * alpha), alpha);
  outWeight = vec4(toHalf(weight * alpha), 0.0, 0.0, alpha);
  writeDepthKey();
}
