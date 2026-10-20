#version 300 es

uniform sampler2DShadow u_shadowMap;
uniform mat4 u_lightViewProjection;
uniform float u_renderOrder;

in vec3 v_world;
in vec3 v_normal;
in vec2 v_uv;
flat in vec4 v_rect;
flat in int v_material;
flat in vec3 v_corner0;
flat in vec3 v_corner1;
flat in vec3 v_corner2;

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
  vec3 dir = cameraRayDirection(gl_FragCoord.xy);
  vec3 e1 = v_corner1 - v_corner0;
  vec3 e2 = v_corner2 - v_corner0;
  // The receiver moves along its geometric normal (toward the viewer), as in the raycast.
  vec3 geometric = normalize(cross(e1, e2));
  if (dot(geometric, dir) > 0.0) geometric = -geometric;
  float lit = shadowTerm(v_world + geometric * SHADOW_NORMAL_OFFSET);
  outColor = vec4(shade(texel.rgb, normal, lit), 1.0);
  // The depth test compares the raycast's key, computed the same way from the pixel's ray and the triangle's plane
  // (interpolated positions are not precise enough for RENDER_ORDER_TIE).
  float key = renderOrderKey(planeDistance(u_eye, dir, v_corner0, e1, e2), dir, u_renderOrder, !gl_FrontFacing);
  gl_FragDepth = clamp(key / DEPTH_RANGE, 0.0, 1.0);
}
