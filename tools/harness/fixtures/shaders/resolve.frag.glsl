#version 300 es
precision highp float;

uniform sampler2D u_accum;
uniform float u_samples;

out vec4 outColor;

void main() {
  vec3 sum = texelFetch(u_accum, ivec2(gl_FragCoord.xy), 0).rgb;
  outColor = vec4(sum / u_samples, 1.0);
}
