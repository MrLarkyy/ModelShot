#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// The canvas-size linear image of a supersampled or denoised render: each pixel the box mean of its u_scale x u_scale
// traced pixels, as the trace's jitter box-filters a pixel at scale 1. Denoised: the filtered demodulated radiance
// times the guide albedo; else the accumulated sum over the sample count. Present tone-maps it.
uniform highp sampler2D u_source;
uniform highp sampler2D u_albedo;
uniform bool u_denoised;
uniform float u_samples;
uniform int u_scale;

out vec4 outColor;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * u_scale;
  vec3 total = vec3(0.0);
  for (int y = 0; y < u_scale; y++) {
    for (int x = 0; x < u_scale; x++) {
      ivec2 p = base + ivec2(x, y);
      vec3 c = texelFetch(u_source, p, 0).rgb;
      total += u_denoised ? c * texelFetch(u_albedo, p, 0).rgb : c / u_samples;
    }
  }
  outColor = vec4(total / float(u_scale * u_scale), 1.0);
}
