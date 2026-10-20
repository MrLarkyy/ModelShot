/** Texel alpha (0..1) below this is a cutout: invisible in every pass, depth and shadows included. */
export const TEXEL_ALPHA_CUTOUT_MAX = 0.5 / 255;
/** Texel alpha above this is opaque; anything between the two thresholds is partial and blended order-independently. */
export const TEXEL_ALPHA_OPAQUE_MIN = 254.5 / 255;

export type TexelAlphaClass = 'cutout' | 'partial' | 'opaque';

/** Class of one texel's alpha in 0..1; the same thresholds as `glsl/texelAlpha.glsl`. */
export function classifyTexelAlpha(alpha: number): TexelAlphaClass {
  if (alpha < TEXEL_ALPHA_CUTOUT_MAX) return 'cutout';
  if (alpha > TEXEL_ALPHA_OPAQUE_MIN) return 'opaque';
  return 'partial';
}
