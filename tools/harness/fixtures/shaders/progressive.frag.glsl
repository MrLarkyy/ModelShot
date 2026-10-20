#version 300 es
precision highp float;
precision highp int;

uniform uint u_seed;
uniform uint u_sample;

out vec4 outColor;

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

float unit(uint h) {
  return float(h >> 8) * (1.0 / 16777216.0);
}

void main() {
  uvec2 px = uvec2(gl_FragCoord.xy);
  uint h = pcg(u_seed);
  h = pcg(h + u_sample);
  h = pcg(h + px.x);
  h = pcg(h + px.y);
  float jx = unit(h);
  h = pcg(h);
  float jy = unit(h);
  h = pcg(h);
  float light = unit(h);

  vec2 p = (gl_FragCoord.xy - 0.5 + vec2(jx, jy)) / 256.0;
  vec3 albedo = mix(vec3(0.15, 0.3, 0.6), vec3(0.8, 0.7, 0.4), p.y);
  if (distance(p, vec2(0.38, 0.42)) < 0.22) albedo = vec3(0.85, 0.2, 0.15);
  if (abs(p.x - 0.75) < 0.08 && p.y < 0.6) albedo = vec3(0.2, 0.75, 0.3);

  // Binary light visibility with the right mean keeps the noise high at few samples.
  float lit = light < 0.5 ? 2.0 : 0.0;
  outColor = vec4(albedo * lit, 1.0);
}
