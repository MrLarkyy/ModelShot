#version 300 es
precision highp float;
precision highp int;

uniform int u_variant; // 0 reference, 1 broken block, 2 one-LSB nudge

out vec4 outColor;

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / 256.0;
  vec3 color;

  if (px.x < 128 && px.y < 128) {
    // Integer-texel checker, hard edges only.
    bool odd = (((px.x >> 3) + (px.y >> 3)) & 1) == 1;
    color = odd ? vec3(0.95, 0.85, 0.2) : vec3(0.15, 0.2, 0.6);
  } else {
    color = vec3(uv.x, 0.25 + 0.5 * uv.y, 1.0 - uv.x * uv.y);
    // A hard-edged disc, offset from the centre so the scene has no symmetry.
    if (distance(gl_FragCoord.xy, vec2(180.0, 190.0)) < 40.0) {
      color = vec3(0.9, 0.1, 0.1);
    }
  }
  // Orientation marker in the top-left corner (y is up in framebuffer space).
  if (px.x < 24 && px.y >= 232) {
    color = vec3(0.0, 0.8, 0.0);
  }

  if (u_variant == 1 && px.x >= 192 && px.x < 224 && px.y >= 32 && px.y < 64) {
    color = vec3(1.0, 0.0, 1.0);
  }
  if (u_variant == 2 && px.y == 200 && px.x >= 100 && px.x < 110) {
    color += vec3(1.0 / 255.0);
  }
  outColor = vec4(color, 1.0);
}
