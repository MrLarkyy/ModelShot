// Inclusive texel range [xy, zw] of a face from its normalised UV rectangle [uMin, vMin, uMax, vMax] in a texture of
// `size` texels. Every renderer clamps its texel lookups to it, so no texel of a neighbouring atlas region is read.
ivec4 faceTexelRange(vec4 uvRect, vec2 size) {
  vec2 lo = floor(uvRect.xy * size + 1.0e-3);
  vec2 hi = max(ceil(uvRect.zw * size - 1.0e-3) - 1.0, lo);
  return ivec4(lo, hi);
}

// Bits of a texture's sampling flags (textureSamplingFlags.ts): lookups past the image repeat it; from bit 8 up, the
// frame count of a strip minus 1.
const int TEXTURE_FLAG_REPEAT = 1;
const int TEXTURE_FRAMES_SHIFT = 8;

// t modulo s in [0, s), s > 0. GLSL ES 3.00 leaves % undefined for a negative operand, so both operands stay >= 0.
int repeatTexel(int t, int s) {
  return t >= 0 ? t % s : s - 1 - (-t - 1) % s;
}

// The texels a lookup may read: the whole image, or of a strip (SceneTextureFrames) frame 0, the frame its UVs map
// into, rows rounded as faceTexelRange rounds a face spanning that frame. No renderer plays frames yet; playback must
// offset this by the played frame.
ivec2 wrapSize(ivec2 size, int flags) {
  int frames = (flags >> TEXTURE_FRAMES_SHIFT) + 1;
  if (frames <= 1) return size;
  int rows = int(ceil(float(size.y) / float(frames) - 1.0e-3));
  return ivec2(size.x, clamp(rows, 1, size.y));
}

// The texel a lookup reads: within the face's range (faceTexelRange), then inside the image (a strip: its frame,
// wrapSize), by repeating it (TEXTURE_FLAG_REPEAT in `flags`) or by taking the edge texel. A face whose UVs pass the
// texture thus reads the same texels in every renderer, and never a texel outside its image or of another frame.
ivec2 faceTexel(ivec2 texel, ivec4 range, ivec2 size, int flags) {
  ivec2 t = clamp(texel, range.xy, range.zw);
  ivec2 s = wrapSize(size, flags);
  if ((flags & TEXTURE_FLAG_REPEAT) != 0) return ivec2(repeatTexel(t.x, s.x), repeatTexel(t.y, s.y));
  return clamp(t, ivec2(0), s - 1);
}
