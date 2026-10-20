import type { SceneTexture } from '@modelshot/scene';

/** `modern`: 64 × 64 UV space with separate left limbs and a full outer layer; `legacy`: 64 × 32, hat only. */
export type SkinLayout = 'modern' | 'legacy';

export interface SkinLoadResult {
  /** The PNG bytes (a copy), UV space 64 × 64 or 64 × 32 whatever the pixel size. */
  readonly texture: SceneTexture;
  readonly layout: SkinLayout;
  /**
   * Legacy skins only: `true` when the hat area has no transparent texel, so the player has no hat (Minecraft clears
   * such a hat area). `false` or absent: the hat is drawn; always `false` for a modern skin.
   */
  readonly legacyHatOpaque?: boolean;
}
