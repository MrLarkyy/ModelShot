// The shadow catcher: a horizontal plane under the model that shows only how much light the model takes from it. A
// catcher point multiplies the backdrop by catcherShade (the preview, on baked means) or catcherShadeOfLoss (the path
// tracer, per sample); catcherShade.ts mirrors both.
#include "lightRig"

float catcherLuminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float catcherKeyWeight() {
  return catcherLuminance(u_lookKeyColor) * u_lookKeyDirection.y;
}

// Everything an unshadowed point receives, the dome's fill and the key, in luminance; never 0.
float catcherLightWeight() {
  return max(catcherLuminance(hemisphereFill(vec3(0.0, 1.0, 0.0))) + catcherKeyWeight(), 1.0e-6);
}

// rect: the catcher's [minX, minZ, maxX, maxZ]. 1 inside, falling to 0 over the outer 10 % so the catcher has no
// visible edge.
float catcherFade(vec2 xz, vec4 rect) {
  vec2 size = max(rect.zw - rect.xy, vec2(1.0e-6));
  vec2 u = (xz - rect.xy) / size;
  float edge = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y));
  return clamp(edge / 0.1, 0.0, 1.0);
}

// fill: the fill light reaching the point (environment radiance of the unblocked cosine-weighted directions, whose
// unoccluded mean is hemisphereFill(up)); keyT: the key's visibility 0..1; xz: the point. Affine in fill and keyT, so
// the path tracer may average it over samples and the preview may evaluate it once on baked means: both give the same
// value. 1 where nothing blocks the light (up to rounding), fading to 1 at the edge.
float catcherShade(vec3 fill, float keyT, vec2 xz, vec4 rect) {
  float lit = (catcherLuminance(fill) + catcherKeyWeight() * keyT) / catcherLightWeight();
  return 1.0 - u_lookCatcherStrength * (1.0 - lit) * catcherFade(xz, rect);
}

// The same shade from what blockers take: fillLost = hemisphereFill(up) - fill, keyLost = 1 - keyT. Exactly 1 where
// both are 0, whatever the division rounds (its numerator is 0), so an unshadowed catcher sample is the bare backdrop
// and has coverage 0; affine in both, as catcherShade.
float catcherShadeOfLoss(vec3 fillLost, float keyLost, vec2 xz, vec4 rect) {
  float lost = (catcherLuminance(fillLost) + catcherKeyWeight() * keyLost) / catcherLightWeight();
  return 1.0 - u_lookCatcherStrength * lost * catcherFade(xz, rect);
}
