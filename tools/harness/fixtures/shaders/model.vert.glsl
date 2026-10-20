#version 300 es

uniform mat4 u_viewProjection;

// Locations match the attribute order in modelRaster.ts.
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_rect;
layout(location = 4) in int a_material;
// The triangle's three corners, the same on each of its vertices.
layout(location = 5) in vec3 a_corner0;
layout(location = 6) in vec3 a_corner1;
layout(location = 7) in vec3 a_corner2;

out vec3 v_world;
out vec3 v_normal;
out vec2 v_uv;
flat out vec4 v_rect;
flat out int v_material;
flat out vec3 v_corner0;
flat out vec3 v_corner1;
flat out vec3 v_corner2;

void main() {
  v_world = a_position;
  v_normal = a_normal;
  v_uv = a_uv;
  v_rect = a_rect;
  v_material = a_material;
  v_corner0 = a_corner0;
  v_corner1 = a_corner1;
  v_corner2 = a_corner2;
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
