// Inclusive texel range [xy, zw] of a face from its normalised UV rectangle [uMin, vMin, uMax, vMax] in a texture of
// `size` texels. Every renderer clamps its texel lookups to it, so no texel of a neighbouring atlas region is read.
ivec4 faceTexelRange(vec4 uvRect, vec2 size) {
  vec2 lo = floor(uvRect.xy * size + 1.0e-3);
  vec2 hi = max(ceil(uvRect.zw * size - 1.0e-3) - 1.0, lo);
  return ivec4(lo, hi);
}

// Bit of a texture's sampling flags (textureSamplingFlags.ts): lookups past the image repeat it.
const int TEXTURE_FLAG_REPEAT = 1;

// t modulo s in [0, s), s > 0. GLSL ES 3.00 leaves % undefined for a negative operand, so both operands stay >= 0.
int repeatTexel(int t, int s) {
  return t >= 0 ? t % s : s - 1 - (-t - 1) % s;
}

// The texel a lookup reads: within the face's range (faceTexelRange), then inside the image of `size` texels, by
// repeating it (TEXTURE_FLAG_REPEAT in `flags`) or by taking the edge texel. A face whose UVs pass the texture thus reads
// the same texels in every renderer, and never a texel outside its image.
ivec2 faceTexel(ivec2 texel, ivec4 range, ivec2 size, int flags) {
  ivec2 t = clamp(texel, range.xy, range.zw);
  if ((flags & TEXTURE_FLAG_REPEAT) != 0) return ivec2(repeatTexel(t.x, size.x), repeatTexel(t.y, size.y));
  return clamp(t, ivec2(0), size - 1);
}
