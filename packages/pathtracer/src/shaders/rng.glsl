// Seeded random numbers, mirrored by pcgHash.ts: a PCG hash (Jarzynski and Olano, JCGT 2020) chained over seed,
// sample index and pixel, then over a dimension. No clock or other varying input, so samples are reproducible.
uint pcgHash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

uint sampleHash(uint seed, uint sampleIndex, uvec2 pixel) {
  uint h = pcgHash(seed);
  h = pcgHash(h + sampleIndex);
  h = pcgHash(h + pixel.x);
  return pcgHash(h + pixel.y);
}

// Uniform in [0, 1) with 24 bits; `extra` keys a number per surface (a triangle index) within one dimension.
float unitRandom(uint sampleKey, uint dimension, uint extra) {
  uint h = pcgHash(pcgHash(sampleKey + dimension) ^ extra);
  return float(h >> 8u) * (1.0 / 16777216.0);
}
