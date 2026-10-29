#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

#include "agx"

// The sample history of an exact-key frame: one layer per jittered pass (EXACT_SAMPLE_OFFSETS).
uniform sampler2DArray u_samples;
// Layers 0 .. u_sampleCount - 1 are filled.
uniform int u_sampleCount;

out vec4 outColor;

// The mean is taken in linear HDR, before tone mapping, as the MSAA resolve does, and summed in a fixed order so a
// converged frame is the same bytes every time.
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int count = clamp(u_sampleCount, 1, 4);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= count) break;
    sum += texelFetch(u_samples, ivec3(px, i), 0).rgb;
  }
  vec3 linearColor = sum / float(count);
  outColor = vec4(agxToneMap(linearColor), 1.0);
}
