#version 300 es
precision highp float;
precision highp int;

#include "backdrop"
#include "agx"

uniform highp sampler2D u_sum;
uniform float u_samples;
// A transparent request: the radiance holds no backdrop, and coverage is the coverage sum (R32F, over u_samples), or
// the alpha of u_sum when that is the resolved image.
uniform bool u_transparent;
uniform highp sampler2D u_coverage;
uniform bool u_coverageInSum;
// Drawing into the readback target: straight alpha instead of the canvas's image over the backdrop.
uniform bool u_readback;

out vec4 outColor;

// The mean of the samples so far through the same AgX as the preview; the backdrop before the first sample.
void main() {
  if (!u_transparent) {
    vec3 linearColor = u_samples > 0.0 ? texelFetch(u_sum, ivec2(gl_FragCoord.xy), 0).rgb / u_samples : backdropHere();
    outColor = vec4(agxToneMap(linearColor), 1.0);
    return;
  }
  if (u_samples <= 0.0) {
    outColor = u_readback ? vec4(0.0) : vec4(agxToneMap(backdropHere()), 1.0);
    return;
  }
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 sum = texelFetch(u_sum, p, 0);
  vec3 premultiplied = sum.rgb / u_samples;
  float coverage = u_coverageInSum ? sum.a : texelFetch(u_coverage, p, 0).r / u_samples;
  if (!u_readback) {
    // Composited in linear light: the opaque render's mean, so the canvas shows what an opaque request would.
    outColor = vec4(agxToneMap(premultiplied + backdropHere() * (1.0 - coverage)), 1.0);
    return;
  }
  float alpha = clamp(coverage, 0.0, 1.0);
  outColor = vec4(alpha > 0.0 ? agxToneMap(premultiplied / alpha) : vec3(0.0), alpha);
}
