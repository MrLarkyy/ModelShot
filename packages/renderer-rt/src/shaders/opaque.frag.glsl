#version 300 es
precision highp float;
precision highp int;

#include "texelSample"
#include "texelAlpha"
#include "shading"

uniform sampler2D u_texture;
uniform bool u_texelAntialias;

in vec3 v_normal;
in vec2 v_uv;
flat in vec4 v_uvRect;

out vec4 outColor;

// Opaque texels only: cutout texels are discarded before any depth write, partial ones are left to the OIT pass.
void main() {
  TexelSample s = sampleTexels(u_texture, v_uv, v_uvRect, u_texelAntialias);
  if (!texelIsOpaque(s.nearestAlpha)) discard;
  outColor = vec4(shadeSurface(sampleColor(s), surfaceNormal(v_normal)), 1.0);
}
