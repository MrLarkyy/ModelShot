import type { SceneAlphaMode, SceneMaterial } from './SceneMaterial';

/** glTF's default `alphaCutoff`. */
export const DEFAULT_ALPHA_CUTOFF = 0.5;

/** A material's alpha rule with every default applied. */
export interface MaterialAlpha {
  readonly mode: SceneAlphaMode;
  /** In 0..1. */
  readonly cutoff: number;
}

/**
 * What a texel is to every ray or pass that meets it (camera, shadow, ambient occlusion, BVH hit): `invisible` is
 * skipped as if absent, `opaque` stops the ray, `partial` (only in `blend`) is drawn order-independently and lets
 * `1 − alpha` of the light through.
 */
export type TexelCoverage = 'invisible' | 'partial' | 'opaque';

const MODES: readonly SceneAlphaMode[] = ['opaque', 'mask', 'blend'];

/**
 * The alpha rule of `material`; no material (−1) or an absent mode is `opaque`, an absent or non-finite cutoff is
 * `DEFAULT_ALPHA_CUTOFF`, a cutoff outside 0..1 is clamped.
 */
export function resolveMaterialAlpha(
  material: Pick<SceneMaterial, 'alphaMode' | 'alphaCutoff'> | undefined,
): MaterialAlpha {
  const mode = material?.alphaMode !== undefined && MODES.includes(material.alphaMode) ? material.alphaMode : 'opaque';
  const raw = material?.alphaCutoff;
  const cutoff = raw === undefined || !Number.isFinite(raw) ? DEFAULT_ALPHA_CUTOFF : Math.min(1, Math.max(0, raw));
  return { mode, cutoff };
}

/** Coverage of a texel of alpha `alpha` (0..1); a texel exactly at the cutoff is visible. */
export function texelCoverage(alpha: number, rule: MaterialAlpha): TexelCoverage {
  if (rule.mode === 'opaque') return 'opaque';
  if (alpha < rule.cutoff) return 'invisible';
  if (rule.mode === 'mask' || alpha >= 1) return 'opaque';
  return 'partial';
}
