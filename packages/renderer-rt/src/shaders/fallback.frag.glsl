#version 300 es
precision highp float;
precision highp int;

#include "texelSample"
#include "texelAlpha"
#include "shading"
#include "hashAlpha"
#include "agx"

uniform sampler2D u_texture;
uniform bool u_texelAntialias;

in vec3 v_normal;
in vec2 v_uv;
flat in vec4 v_uvRect;

out vec4 outColor;

// No float render targets: one pass into the default framebuffer, partial texels as hashed alpha, AgX in place.
void main() {
  TexelSample s = sampleTexels(u_texture, v_uv, v_uvRect, u_texelAntialias);
  if (texelIsCutout(s.nearestAlpha)) discard;
  if (texelIsPartial(s.nearestAlpha)) {
    ivec2 texel = nearestTexel(u_texture, v_uv, v_uvRect);
    if (!hashedAlphaCovers(texel, ivec2(gl_FragCoord.xy), s.nearestAlpha)) discard;
  }
  outColor = vec4(agxToneMap(shadeSurface(sampleColor(s), surfaceNormal(v_normal))), 1.0);
}
