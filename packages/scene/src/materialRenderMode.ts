import type { SceneBlending, SceneMaterial } from './SceneMaterial';

/** Most texture layers one material composites; bounds the samplers a renderer binds per material. */
export const MAX_MATERIAL_LAYERS = 3;

/** A material's blending, emission split and layer stack with every default applied. */
export interface MaterialRenderMode {
  readonly blending: SceneBlending;
  readonly alphaEmission: boolean;
  /** Texture indices bottom to top, 1..`MAX_MATERIAL_LAYERS` long; −1 or an index out of range is no texture. */
  readonly layers: readonly number[];
}

const BLENDINGS: readonly SceneBlending[] = ['normal', 'additive'];

/**
 * The render mode of `material`; no material or an absent or unknown `blending` is `normal`, `alphaEmission` is only
 * `true` when set to `true`, absent, empty or non-array `layers` is `[texture]`, a longer stack keeps its first
 * `MAX_MATERIAL_LAYERS` entries and a non-integer entry becomes −1.
 */
export function resolveMaterialRenderMode(
  material: Pick<SceneMaterial, 'texture' | 'blending' | 'alphaEmission' | 'layers'> | undefined,
): MaterialRenderMode {
  const blending =
    material?.blending !== undefined && BLENDINGS.includes(material.blending) ? material.blending : 'normal';
  const texture = material === undefined || !Number.isInteger(material.texture) ? -1 : material.texture;
  const raw: unknown = material?.layers;
  const layers =
    Array.isArray(raw) && raw.length > 0
      ? raw.slice(0, MAX_MATERIAL_LAYERS).map((index: unknown) => (Number.isInteger(index) ? (index as number) : -1))
      : [texture];
  return { blending, alphaEmission: material?.alphaEmission === true, layers };
}
