// Per-texel transparency classes, shared by every renderer and pass; the thresholds mirror texelAlpha.ts.
const float TEXEL_ALPHA_CUTOUT_MAX = 0.5 / 255.0;
const float TEXEL_ALPHA_OPAQUE_MIN = 254.5 / 255.0;

bool texelIsCutout(float alpha) {
  return alpha < TEXEL_ALPHA_CUTOUT_MAX;
}

bool texelIsOpaque(float alpha) {
  return alpha > TEXEL_ALPHA_OPAQUE_MIN;
}

bool texelIsPartial(float alpha) {
  return !texelIsCutout(alpha) && !texelIsOpaque(alpha);
}
