#version 300 es
precision highp float;
precision highp int;

#include "agx"

uniform sampler2D u_hdr;

out vec4 outColor;

void main() {
  vec3 linearColor = texelFetch(u_hdr, ivec2(gl_FragCoord.xy), 0).rgb;
  outColor = vec4(agxToneMap(linearColor), 1.0);
}
