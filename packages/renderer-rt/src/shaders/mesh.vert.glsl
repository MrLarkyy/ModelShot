#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_uvRect;

uniform mat4 u_model;
uniform mat4 u_viewProjection;

out vec3 v_normal;
out vec2 v_uv;
// Every vertex of a face carries the same rectangle; flat avoids interpolation error at the clamp bounds.
flat out vec4 v_uvRect;

void main() {
  // Node world matrices are rigid (rotation and translation only), so their upper 3x3 also maps normals.
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;
  v_uvRect = a_uvRect;
  gl_Position = u_viewProjection * (u_model * vec4(a_position, 1.0));
}
