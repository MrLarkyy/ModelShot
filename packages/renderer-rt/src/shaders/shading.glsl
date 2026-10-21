// Shading of the preview with the shared light rig (lightRig chunk of @modelshot/looks, which the path tracer reads too).
#include "lightRig"

// The back of a double-sided face (drawn in its own pass) is lit with the flipped normal.
vec3 surfaceNormal(vec3 interpolatedNormal) {
  vec3 n = normalize(interpolatedNormal);
  return gl_FrontFacing ? n : -n;
}

vec3 shadeSurface(vec3 albedo, vec3 n) {
  vec3 fill = hemisphereFill(n);
  float key = max(dot(n, KEY_DIRECTION), 0.0);
  return albedo * (fill + KEY_COLOR * key);
}

// With baked light (bakedLight): the fill times its baked share, the key times its baked visibility. Light (1, 1, 1, 1)
// gives shadeSurface's value.
vec3 shadeBaked(vec3 albedo, vec3 n, vec4 light) {
  vec3 fill = hemisphereFill(n) * light.rgb;
  float key = max(dot(n, KEY_DIRECTION), 0.0) * light.a;
  return albedo * (fill + KEY_COLOR * key);
}
