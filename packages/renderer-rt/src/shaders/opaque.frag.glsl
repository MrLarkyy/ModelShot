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

out vec4 outColor;

// Opaque texels only: invisible texels are discarded before any depth write, partial ones are left to the OIT pass.
void main() {
  prepareDepthKey();
  prepareEdges();
  TexelSample s = sampleTexels(u_texture, v_uv, v_uvRect, u_texelAntialias, u_alphaMode, u_alphaCutoffByte);
  vec4 light = vec4(1.0);
  if (u_bakeOn) light = sampleBakedLight(v_uv, v_uvRect);
  if (s.coverage != COVERAGE_OPAQUE) discard;
  outColor = vec4(shadeLit(sampleColor(s), shadingNormal(v_normal), light), 1.0);
  writeDepthKey();
}
