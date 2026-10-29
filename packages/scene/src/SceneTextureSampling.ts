import type { SceneTexture } from './SceneTexture';

/**
 * What a texel lookup past the texture's edge reads: `clamp` the edge texel, `repeat` the texel of the texture
 * repeated (u and v taken modulo the texture size). Lookups stay inside the face's own texel range first, so only a
 * face whose UVs pass the texture reaches beyond it.
 */
export type SceneTextureWrap = 'clamp' | 'repeat';

export const SCENE_TEXTURE_WRAPS: readonly SceneTextureWrap[] = ['clamp', 'repeat'];

/** The wrap of a texture without `wrap`. */
export const DEFAULT_TEXTURE_WRAP: SceneTextureWrap = 'clamp';

/**
 * How a texture's colour is read between texel centres: `nearest` one texel (pixel art), `linear` the bilinear blend
 * of the four texels around the point, each addressed as a nearest lookup is (face range, wrap, frame). Only the colour
 * is filtered: whether a point is cut out or partly transparent stays the nearest texel's in every renderer.
 */
export type SceneTextureFilter = 'nearest' | 'linear';

export const SCENE_TEXTURE_FILTERS: readonly SceneTextureFilter[] = ['nearest', 'linear'];

/** The filter of a texture without `filter`. */
export const DEFAULT_TEXTURE_FILTER: SceneTextureFilter = 'nearest';

/** How both renderers sample a texture, every optional field resolved to its default. */
export interface TextureSampling {
  readonly wrap: SceneTextureWrap;
  /**
   * Frames of a strip (`frames.count`), 1 for a still image: a lookup past the face stays in the frame its UVs map
   * into, clamped or repeated there, never in another frame.
   */
  readonly frames: number;
  readonly filter: SceneTextureFilter;
}

/** The sampling of `texture`; absent fields take their defaults. */
export function textureSampling(
  texture: Pick<SceneTexture, 'wrap' | 'frames' | 'filter'> | undefined,
): TextureSampling {
  return {
    wrap: texture?.wrap ?? DEFAULT_TEXTURE_WRAP,
    frames: texture?.frames?.count ?? 1,
    filter: texture?.filter ?? DEFAULT_TEXTURE_FILTER,
  };
}
