import type { GlLimits } from './glLimits';

/**
 * Pixels × slots the sample history of exact-key frames may hold at most (2^23: 4 slots of a 1448 × 1448 canvas, or
 * of 1920 × 1080). A slot is one RGBA16F layer, 8 bytes per pixel, so this caps the history at 64 MB.
 */
export const EXACT_SUPERSAMPLE_MAX_PIXELS = 2 ** 23;

/**
 * Sub-pixel offsets (in pixels, +x right, +y up) of the passes an exact-key frame accumulates, in pass order: a rotated
 * grid, so a horizontal or vertical edge crosses 4 sample rows or columns (an ordered 2 × 2 grid has 2).
 */
export const EXACT_SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [-1 / 8, -3 / 8],
  [1 / 8, 3 / 8],
  [3 / 8, -1 / 8],
  [-3 / 8, 1 / 8],
];

/**
 * Samples a still exact-key frame of `width` × `height` accumulates on the float path. Its depth key is the depth at
 * the pixel centre, so it cannot stand for several MSAA samples; instead each `render()` draws one single-sampled pass
 * shifted to the next of `EXACT_SAMPLE_OFFSETS`, and the present pass averages them. 4 only where MSAA would have run
 * (`samples` > 1), a slot fits `MAX_TEXTURE_SIZE` and the 4 slots stay within `EXACT_SUPERSAMPLE_MAX_PIXELS`; else 1, the
 * single-sampled frame at the pixel centre.
 */
export function exactSampleCount(width: number, height: number, samples: number, limits: GlLimits): 1 | 4 {
  if (samples <= 1 || width <= 0 || height <= 0) return 1;
  if (width > limits.maxTextureSize || height > limits.maxTextureSize) return 1;
  return EXACT_SAMPLE_OFFSETS.length * width * height <= EXACT_SUPERSAMPLE_MAX_PIXELS ? 4 : 1;
}
