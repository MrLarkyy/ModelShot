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
// On only while alpha-to-coverage turns alpha into MSAA samples (alphaToCoverage.ts): without it the band fragments
// kept below would grow the cutout shape by half a pixel.
uniform bool u_alphaToCoverage;

in vec2 v_uv;
flat in vec4 v_uvRect;
flat in int v_textureFlags;

out vec4 outColor;

// Opaque texels only: invisible texels are discarded before any depth write, partial ones are left to the OIT pass.
// Under alpha-to-coverage a fragment of an invisible texel within the anti-aliased seam of an opaque one is kept with
// its coverage as alpha; its colour is already the opaque neighbour's (premultiplied taps), so the edge resolves to a
// mix of that texel and what lies behind, its 50 % contour on the texel boundary. An opaque texel writes the taps'
// alpha-weighted coverage: beside a partial texel its covered samples carry both shares and the rest shows what lies
// behind; beside cut-out texels alone it equals opaqueCoverage bit for bit.
void main() {
  prepareDepthKey();
  prepareShading();
  TexelSample s =
    sampleTexels(u_texture, v_uv, v_uvRect, v_textureFlags, u_texelAntialias, u_alphaMode, u_alphaCutoffByte);
  vec4 light = vec4(1.0);
  if (u_bakeOn) light = sampleBakedLight(v_uv, v_uvRect);
  if (u_alphaToCoverage) {
    if (s.coverage == COVERAGE_PARTIAL || s.opaqueCoverage <= 0.0) discard;
  } else if (s.coverage != COVERAGE_OPAQUE) {
    discard;
  }
  float alpha = 1.0;
  if (u_alphaToCoverage) alpha = s.coverage == COVERAGE_OPAQUE ? s.premultiplied.a : s.opaqueCoverage;
  outColor = vec4(shadeLit(sampleColor(s), shadingNormal(), light), alpha);
  writeDepthKey();
}
