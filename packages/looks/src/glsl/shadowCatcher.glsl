// The shadow catcher: a horizontal plane under the model that shows only how much light the model takes from it. A
// catcher point multiplies the backdrop by catcherShade; catcherShade.ts mirrors it.
#include "lightRig"

float catcherLuminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// fill: the fill light reaching the point (environment radiance of the unblocked cosine-weighted directions, whose
// unoccluded mean is hemisphereFill(up)); keyT: the key's visibility 0..1; xz: the point; rect: the catcher's
// [minX, minZ, maxX, maxZ]. Affine in fill and keyT, so the path tracer may average it over samples and the preview
// may evaluate it once on baked means: both give the same value. 1 where nothing blocks the light, fading to 1 over the
// outer 10 % of the rectangle so the catcher has no visible edge.
float catcherShade(vec3 fill, float keyT, vec2 xz, vec4 rect) {
  float keyWeight = catcherLuminance(u_lookKeyColor) * u_lookKeyDirection.y;
  float fillWeight = catcherLuminance(hemisphereFill(vec3(0.0, 1.0, 0.0)));
  float lit = (catcherLuminance(fill) + keyWeight * keyT) / max(fillWeight + keyWeight, 1.0e-6);
  vec2 size = max(rect.zw - rect.xy, vec2(1.0e-6));
  vec2 u = (xz - rect.xy) / size;
  float edge = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y));
  float fade = clamp(edge / 0.1, 0.0, 1.0);
  return 1.0 - u_lookCatcherStrength * (1.0 - lit) * fade;
}
