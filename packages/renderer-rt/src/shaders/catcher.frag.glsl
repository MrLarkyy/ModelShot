#version 300 es
precision highp float;
precision highp int;

#include "lightRig"
#include "shadowCatcher"
#include "backdrop"
#include "agx"

// The shadow catcher's baked light (BakedCatcher), its rectangle and lightmap size.
uniform highp sampler2D u_catcherLight;
uniform vec4 u_catcherRect;
uniform vec2 u_catcherSize;
// The no-float path draws straight into the default framebuffer: tone-map here.
uniform bool u_toneMap;

in vec2 v_xz;

out vec4 outColor;

vec4 catcherTexel(ivec2 texel) {
  return texelFetch(u_catcherLight, clamp(texel, ivec2(0), ivec2(u_catcherSize) - 1), 0);
}

// The backdrop as the catcher darkens it; bilinear between texel centres, the catcher being finer than any model texel.
void main() {
  vec2 t = (v_xz - u_catcherRect.xy) / (u_catcherRect.zw - u_catcherRect.xy) * u_catcherSize - 0.5;
  vec2 cell = floor(t);
  vec2 f = t - cell;
  ivec2 base = ivec2(cell);
  vec4 light = mix(
    mix(catcherTexel(base), catcherTexel(base + ivec2(1, 0)), f.x),
    mix(catcherTexel(base + ivec2(0, 1)), catcherTexel(base + ivec2(1, 1)), f.x),
    f.y);
  vec3 fill = light.rgb * hemisphereFill(vec3(0.0, 1.0, 0.0));
  vec3 color = backdropHere() * catcherShade(fill, light.a, v_xz, u_catcherRect);
  outColor = vec4(u_toneMap ? agxToneMap(color) : color, 1.0);
}
