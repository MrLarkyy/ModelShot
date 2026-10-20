#version 300 es

uniform mat4 u_viewProjection;

// Locations match the attribute order in modelRaster.ts.
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_rect;
layout(location = 4) in int a_material;

out vec3 v_world;
out vec3 v_normal;
out vec2 v_uv;
flat out vec4 v_rect;
flat out int v_material;

void main() {
  v_world = a_position;
  v_normal = a_normal;
  v_uv = a_uv;
  v_rect = a_rect;
  v_material = a_material;
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
