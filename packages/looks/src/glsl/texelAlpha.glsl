// Per-texel coverage on the 8-bit texel, shared by every renderer and pass; ids and rule mirror texelAlpha.ts, which
// matches the scene format's texelCoverage for every byte.
const int ALPHA_MODE_OPAQUE = 0;
const int ALPHA_MODE_MASK = 1;
const int ALPHA_MODE_BLEND = 2;
const int COVERAGE_INVISIBLE = 0;
const int COVERAGE_PARTIAL = 1;
const int COVERAGE_OPAQUE = 2;

// alpha: the texel's alpha as sampled from an 8-bit texture (k / 255); cutoffByte from alphaCutoffByte.
int texelCoverage(float alpha, int mode, int cutoffByte) {
  if (mode == ALPHA_MODE_OPAQUE) return COVERAGE_OPAQUE;
  int k = int(round(alpha * 255.0));
  if (k < cutoffByte) return COVERAGE_INVISIBLE;
  if (mode == ALPHA_MODE_MASK || k >= 255) return COVERAGE_OPAQUE;
  return COVERAGE_PARTIAL;
}
