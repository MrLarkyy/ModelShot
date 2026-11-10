// filterTexelColor of the mesh passes' linear variant (shaderSources.ts), drawn for a texture whose sampling flags
// carry TEXTURE_FLAG_LINEAR: its colour is the bilinear blend of the four texels around the point (texelFilter), which
// may read one texel past the face rectangle of the same image, as hardware linear filtering does, never another image
// or frame. Only the colour is filtered: the coverage above, seam-shaped at a cut-out edge, stays the nearest texels'.
#include "texelFilter"

// Straight bilinear colour at p (texelFilter) of the four texels around it, each addressed by faceTexel within the
// widened range (linearTexelRange); fallback where every one is invisible.
vec3 linearTexelColor(sampler2D tex, vec2 p, TexelAddress a, int mode, int cutoffByte, vec3 fallback) {
  LinearTaps taps = linearTaps(p);
  a.range = linearTexelRange(a.range);
  vec4 c00 = fetchTexel(tex, taps.base, a);
  vec4 c10 = fetchTexel(tex, taps.base + ivec2(1, 0), a);
  vec4 c01 = fetchTexel(tex, taps.base + ivec2(0, 1), a);
  vec4 c11 = fetchTexel(tex, taps.base + ivec2(1, 1), a);
  return bilinearColor(c00, c10, c01, c11, taps.f, mode, cutoffByte, fallback);
}

void filterTexelColor(inout TexelSample s, sampler2D tex, vec2 p, vec2 dx, vec2 dy, vec2 texelsPerPixel, TexelAddress a,
    int mode, int cutoffByte) {
  if ((a.flags & TEXTURE_FLAG_LINEAR) == 0) return;
  // The texel AA (a view option) does not turn the filter (a texture property) off. Minified, the same rotated grid
  // averages the filtered colour.
  vec3 fallback = sampleColor(s);
  vec3 color;
  if (max(texelsPerPixel.x, texelsPerPixel.y) <= 1.0) {
    color = linearTexelColor(tex, p, a, mode, cutoffByte, fallback);
  } else {
    color = 0.25 * (
      linearTexelColor(tex, p + dx * -0.125 + dy * -0.375, a, mode, cutoffByte, fallback) +
      linearTexelColor(tex, p + dx * 0.375 + dy * -0.125, a, mode, cutoffByte, fallback) +
      linearTexelColor(tex, p + dx * 0.125 + dy * 0.375, a, mode, cutoffByte, fallback) +
      linearTexelColor(tex, p + dx * -0.375 + dy * 0.125, a, mode, cutoffByte, fallback));
  }
  s.premultiplied.rgb = color * s.premultiplied.a;
}
