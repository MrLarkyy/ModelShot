import type { SceneTextureWrap } from '@modelshot/scene';

/** A texture's `wrap_mode` in Blockbench (`Texture.wrap_mode`). */
export type TextureWrap = 'limited' | 'repeat' | 'clamp';

export const TEXTURE_WRAPS: readonly TextureWrap[] = ['limited', 'repeat', 'clamp'];

/** Formats whose `texture_wrap_default` is not Blockbench's `limited` (hytale_plugin.js:815). */
const FORMAT_WRAP_DEFAULTS: ReadonlyMap<string, TextureWrap> = new Map([
  ['hytale_character', 'clamp'],
  ['hytale_prop', 'clamp'],
]);

/**
 * The `wrap_mode` a texture without one gets in `modelFormat`: `Format.texture_wrap_default`, `limited` unless the
 * format sets it (ModelFormat format.ts:670, textures.js:2257).
 */
export function formatTextureWrapDefault(modelFormat: string): TextureWrap {
  return FORMAT_WRAP_DEFAULTS.get(modelFormat) ?? 'limited';
}

/**
 * How Blockbench draws a wrap mode (textures.js:726): `repeat` as RepeatWrapping, `limited` and `clamp` alike as
 * ClampToEdgeWrapping. Only `repeat` reaches the scene (`SceneTexture.wrap`).
 */
export function drawnTextureWrap(mode: TextureWrap): SceneTextureWrap {
  return mode === 'repeat' ? 'repeat' : 'clamp';
}
