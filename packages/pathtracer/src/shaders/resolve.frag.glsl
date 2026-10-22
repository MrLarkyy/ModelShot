#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// The canvas-size linear image of a supersampled or denoised render: each pixel the box mean of its u_scale x u_scale
// traced pixels, as the trace's jitter box-filters a pixel at scale 1. Denoised: the filtered demodulated radiance
// times the guide albedo; else the accumulated sum over the sample count. Present tone-maps it. Transparent: alpha is
// the box mean of the coverage, denoised by the same edge-stopping weights as the radiance (denoise.frag), so a soft
// catcher shadow is smoothed with the colour around it and the silhouette, where those weights stop, stays sharp.
uniform highp sampler2D u_source;
uniform highp sampler2D u_albedo;
uniform bool u_denoised;
uniform float u_samples;
uniform int u_scale;
uniform bool u_transparent;
uniform highp sampler2D u_coverage;
// Denoised and transparent: the filtered mean coverage (already over the sample count) instead of the coverage sum.
uniform bool u_coverageFiltered;
uniform highp sampler2D u_filteredCoverage;

out vec4 outColor;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * u_scale;
  vec3 total = vec3(0.0);
  float coverage = 0.0;
  for (int y = 0; y < u_scale; y++) {
    for (int x = 0; x < u_scale; x++) {
      ivec2 p = base + ivec2(x, y);
      vec3 c = texelFetch(u_source, p, 0).rgb;
      total += u_denoised ? c * texelFetch(u_albedo, p, 0).rgb : c / u_samples;
      if (u_transparent) {
        coverage += u_coverageFiltered ? texelFetch(u_filteredCoverage, p, 0).r : texelFetch(u_coverage, p, 0).r / u_samples;
      }
    }
  }
  float area = float(u_scale * u_scale);
  outColor = vec4(total / area, u_transparent ? coverage / area : 1.0);
}
