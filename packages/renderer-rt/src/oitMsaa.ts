import type { GlLimits } from './glLimits';

/**
 * Samples × pixels the multisampled OIT targets may hold at most (2^23: 4 samples of 1920 × 1080). A sample is 10 bytes
 * (RGBA16F accumulation and R16F weight), so this caps them at about 80 MB.
 */
export const OIT_MSAA_MAX_SAMPLES = 2 ** 23;

/**
 * Whether a raster frame of `width` × `height` draws its OIT pass multisampled, so the outlines of faces with only
 * partial texels are anti-aliased like opaque ones: `samples` (the opaque pass's MSAA count, whose depth the OIT
 * targets share) above 1, within the R16F weight target's sample limit (every attachment needs the same count) and
 * within `OIT_MSAA_MAX_SAMPLES`. Else the OIT pass stays single-sampled and those outlines hard.
 */
export function oitMsaaActive(width: number, height: number, samples: number, limits: GlLimits): boolean {
  if (samples <= 1 || width <= 0 || height <= 0) return false;
  if (samples > limits.maxSamplesR16f) return false;
  return samples * width * height <= OIT_MSAA_MAX_SAMPLES;
}
