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

/** How both renderers sample a texture, every optional field resolved to its default. */
export interface TextureSampling {
  readonly wrap: SceneTextureWrap;
  /**
   * Frames of a strip (`frames.count`), 1 for a still image: a lookup past the face stays in the frame its UVs map
   * into, clamped or repeated there, never in another frame.
   */
  readonly frames: number;
}

/** The sampling of `texture`; absent fields take their defaults. */
export function textureSampling(texture: Pick<SceneTexture, 'wrap' | 'frames'> | undefined): TextureSampling {
  return { wrap: texture?.wrap ?? DEFAULT_TEXTURE_WRAP, frames: texture?.frames?.count ?? 1 };
}
