#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_accum;
uniform sampler2D u_weight;

out vec4 outColor;

// Resolves the weighted average of the partial layers; blended (SRC_ALPHA, ONE_MINUS_SRC_ALPHA) over the opaque image.
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 accum = texelFetch(u_accum, px, 0);
  float revealage = accum.a;
  if (revealage >= 1.0) discard;
  float weight = texelFetch(u_weight, px, 0).r;
  outColor = vec4(accum.rgb / max(weight, 1.0e-5), 1.0 - revealage);
}
