// Hashed (screen-door) alpha for the no-float path: a partial texel covers a pixel when an integer hash of the texel
// and the pixel falls below its alpha. Depth-tested like opaque geometry, so the result is order-independent, and
// the hash has no time or random input, so it is deterministic.
uint hashAlphaMix(uint v) {
  v ^= v >> 16;
  v *= 0x7feb352du;
  v ^= v >> 15;
  v *= 0x846ca68bu;
  v ^= v >> 16;
  return v;
}

bool hashedAlphaCovers(ivec2 texel, ivec2 pixel, float alpha) {
  uvec2 t = uvec2(texel);
  uvec2 p = uvec2(pixel);
  uint h = hashAlphaMix(t.x * 0x9e3779b9u ^ hashAlphaMix(t.y + 0x632be5abu));
  h = hashAlphaMix(h ^ p.x * 0x85ebca6bu ^ hashAlphaMix(p.y * 0xc2b2ae35u));
  return float(h >> 8) * (1.0 / 16777216.0) < alpha;
}
