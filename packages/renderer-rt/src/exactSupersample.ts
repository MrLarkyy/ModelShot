import type { GlLimits } from './glLimits';

/**
 * Sub-pixels an exact-key frame may draw at most (2^23, a 1448 × 1448 canvas or 1920 × 1080 at 2 × 2): its four
 * single-sample float targets hold about 22 bytes per sub-pixel, so this caps them near 184 MB.
 */
export const EXACT_SUPERSAMPLE_MAX_PIXELS = 2 ** 23;

/**
 * Sub-pixels per side an exact-key frame of `width` × `height` draws with on the float path. Its depth key is the
 * depth at a pixel centre, so it cannot stand for several MSAA samples; drawn at 2 × 2 every sub-pixel gets its own
 * centre and key, and the present pass averages them. 2 only where MSAA would have run (`samples` > 1), the doubled
 * size fits the renderbuffer, texture and viewport limits and stays within `EXACT_SUPERSAMPLE_MAX_PIXELS`; else 1, the
 * single-sampled frame.
 */
export function exactSupersampleScale(width: number, height: number, samples: number, limits: GlLimits): 1 | 2 {
  if (samples <= 1 || width <= 0 || height <= 0) return 1;
  const maxWidth = Math.min(limits.maxRenderbufferSize, limits.maxTextureSize, limits.maxViewport[0]);
  const maxHeight = Math.min(limits.maxRenderbufferSize, limits.maxTextureSize, limits.maxViewport[1]);
  if (2 * width > maxWidth || 2 * height > maxHeight) return 1;
  return 4 * width * height <= EXACT_SUPERSAMPLE_MAX_PIXELS ? 2 : 1;
}
