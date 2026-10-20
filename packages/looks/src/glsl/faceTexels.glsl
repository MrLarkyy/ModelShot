// Inclusive texel range [xy, zw] of a face from its normalised UV rectangle [uMin, vMin, uMax, vMax] in a texture of
// `size` texels. Every renderer clamps its texel lookups to it, so no texel of a neighbouring atlas region is read.
ivec4 faceTexelRange(vec4 uvRect, vec2 size) {
  vec2 lo = floor(uvRect.xy * size + 1.0e-3);
  vec2 hi = max(ceil(uvRect.zw * size - 1.0e-3) - 1.0, lo);
  return ivec4(lo, hi);
}
