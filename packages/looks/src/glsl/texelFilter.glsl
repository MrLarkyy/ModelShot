// Linear colour filtering of a texture whose sampling flags carry TEXTURE_FLAG_LINEAR (faceTexels): the bilinear blend
// of the four texels around a point. The caller addresses each tap through faceTexel, so the blend never reads a texel
// outside the face's range, the image (per wrap and frame) or, in the path tracer, another image of the atlas. Only the
// colour is filtered; coverage stays the nearest texel's (texelAlpha) in every pass and ray type.
#include "texelAlpha"

// The taps around p (position in texel units, texel k spanning [k, k + 1)): base, base + (1, 0), (0, 1) and (1, 1),
// weighed by f. Texel centres lie at k + 0.5, so at a centre f is 0 and the texel is read alone.
struct LinearTaps {
  ivec2 base;
  vec2 f;
};

LinearTaps linearTaps(vec2 p) {
  vec2 q = p - 0.5;
  vec2 base = floor(q);
  return LinearTaps(ivec2(base), q - base);
}

// Straight colour of the four taps (c00 at base, c10 at base + (1, 0), c01, c11) blended by f, each weighed by its
// coverage (coverageWeighted): a cut-out texel's colour, often black, adds no dark fringe beside an opaque one.
// fallback where every tap is invisible.
vec3 bilinearColor(vec4 c00, vec4 c10, vec4 c01, vec4 c11, vec2 f, int mode, int cutoffByte, vec3 fallback) {
  vec4 row0 = mix(coverageWeighted(c00, mode, cutoffByte), coverageWeighted(c10, mode, cutoffByte), f.x);
  vec4 row1 = mix(coverageWeighted(c01, mode, cutoffByte), coverageWeighted(c11, mode, cutoffByte), f.x);
  vec4 blend = mix(row0, row1, f.y);
  return blend.a > 0.0 ? blend.rgb / blend.a : fallback;
}
