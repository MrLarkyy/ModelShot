#version 300 es
precision highp float;

#include "backdrop"
#include "agx"

// The float path writes the scene-linear backdrop into its HDR target (present tone-maps it); the no-float path draws
// straight into the default framebuffer and tone-maps here, with the same AgX.
uniform bool u_toneMap;

out vec4 outColor;

// The look's backdrop gradient, behind everything, on both paths.
void main() {
  vec3 color = backdropHere();
  outColor = vec4(u_toneMap ? agxToneMap(color) : color, 1.0);
}
