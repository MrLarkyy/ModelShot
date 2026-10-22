#version 300 es
precision highp float;
precision highp int;

#include "backdrop"
#include "agx"

uniform highp sampler2D u_sum;
uniform float u_samples;

out vec4 outColor;

// The mean of the samples so far through the same AgX as the preview; the backdrop before the first sample.
void main() {
  vec3 linearColor = u_samples > 0.0 ? texelFetch(u_sum, ivec2(gl_FragCoord.xy), 0).rgb / u_samples : backdropHere();
  outColor = vec4(agxToneMap(linearColor), 1.0);
}
