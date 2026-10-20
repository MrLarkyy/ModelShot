#version 300 es

in vec2 v_uv;
flat in vec4 v_rect;
flat in int v_material;

// Depth only: a cutout texel writes nothing, so it casts no shadow.
void main() {
  vec4 texel = materialTexel(v_material, v_uv, v_rect);
  if (texelInvisible(v_material, texel.a)) discard;
}
