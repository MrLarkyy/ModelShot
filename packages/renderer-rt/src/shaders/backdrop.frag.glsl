#version 300 es
precision highp float;

#include "agx"

uniform vec3 u_background;

out vec4 outColor;

// The backdrop of the no-float path, tone-mapped by the same AgX as the float path's clear colour.
void main() {
  outColor = vec4(agxToneMap(u_background), 1.0);
}
