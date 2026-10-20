#version 300 es
precision highp float;

// The shadow catcher's quad, already in world space.
layout(location = 0) in vec3 a_position;

uniform mat4 u_viewProjection;

out vec2 v_xz;

void main() {
  v_xz = a_position.xz;
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
