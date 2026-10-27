#version 300 es
precision highp float;
precision highp int;

#include "agx"

uniform sampler2D u_hdr;
// Sub-pixels per side in u_hdr: 2 for an exact-key frame drawn at 2 x 2, else 1.
uniform int u_supersample;

out vec4 outColor;

// The box mean of the pixel's sub-pixels is taken in linear HDR, before tone mapping, as the MSAA resolve does; with
// one sub-pixel it is that texel unchanged.
void main() {
  int s = max(u_supersample, 1);
  ivec2 base = ivec2(gl_FragCoord.xy) * s;
  vec3 sum = vec3(0.0);
  for (int y = 0; y < s; y++) {
    for (int x = 0; x < s; x++) sum += texelFetch(u_hdr, base + ivec2(x, y), 0).rgb;
  }
  vec3 linearColor = sum / float(s * s);
  outColor = vec4(agxToneMap(linearColor), 1.0);
}
