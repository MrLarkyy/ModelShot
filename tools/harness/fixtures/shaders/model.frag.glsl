#version 300 es

uniform sampler2DShadow u_shadowMap;
uniform mat4 u_lightViewProjection;

in vec3 v_world;
in vec3 v_normal;
in vec2 v_uv;
flat in vec4 v_rect;
flat in int v_material;

out vec4 outColor;

// The shadow pass also applies a slope-scaled polygon offset; this covers the flat part of the depth error.
const float SHADOW_BIAS = 0.0005;

float shadowTerm(vec3 world) {
  vec4 clip = u_lightViewProjection * vec4(world, 1.0);
  vec3 p = clip.xyz / clip.w * 0.5 + 0.5;
  if (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)))) return 1.0;
  return texture(u_shadowMap, vec3(p.xy, p.z - SHADOW_BIAS));
}

void main() {
  vec4 texel = materialTexel(v_material, v_uv, v_rect);
  if (texelInvisible(v_material, texel.a)) discard;
  // Back faces only reach here for double-sided groups (single-sided ones are culled): face the viewer.
  vec3 normal = normalize(gl_FrontFacing ? v_normal : -v_normal);
  outColor = vec4(shade(texel.rgb, normal, shadowTerm(v_world)), 1.0);
}
