import { MAX_MATERIAL_LAYERS, type SceneMaterial, type SceneTexture } from '@modelshot/scene';
import { BLOCKBENCH_ALPHA_CUTOFF } from './blockbenchAlpha';
import type { TextureEntry } from './parseTextures';
import type { RenderMode } from './RenderMode';
import { formatLayersTextures } from './TextureRule';

/** Blockbench `Canvas.getLayeredMaterial` discards composite texels below this alpha. */
export const LAYERED_ALPHA_CUTOFF = 0.05;

/**
 * The texture indices Blockbench composites when a texture is `layered` (`Canvas.getLayeredMaterial`), bottom to top:
 * the last `MAX_MATERIAL_LAYERS` visible textures, the last one on top. A missing texture keeps its slot, as in
 * Blockbench. `undefined` when nothing is layered: a format without single-texture rules, fewer than two textures, no
 * layered texture or no visible one.
 */
export function layeredStack(entries: readonly TextureEntry[], modelFormat: string): number[] | undefined {
  if (!formatLayersTextures(modelFormat) || entries.length < 2) return undefined;
  if (!entries.some((entry) => entry.renderMode === 'layered')) return undefined;
  const visible = entries.flatMap((entry, index) => (entry.visible ? [index] : []));
  return visible.length > 0 ? visible.slice(-MAX_MATERIAL_LAYERS) : undefined;
}

/**
 * One material per texture (material i shows texture i), in Blockbench's texture shader terms: every mode discards
 * texels below alpha 0.01 and blends; `emissive` forces kept texels opaque and lights `c · (1 − a)` itself; `additive`
 * adds to what lies behind; `layered` draws as `default` on its own. With a layer `stack`, one more material, the
 * composite, follows the texture materials, so indices of the texture materials stay those of their textures.
 */
export function bbmodelMaterials(
  textures: readonly SceneTexture[],
  entries: readonly TextureEntry[],
  stack: readonly number[] | undefined,
): SceneMaterial[] {
  const materials = textures.map((texture, index) =>
    textureMaterial(texture.name, index, entries[index]?.renderMode ?? 'default'),
  );
  const bottom = stack?.[0];
  if (stack === undefined || bottom === undefined) return materials;
  return [
    ...materials,
    { name: 'layered', texture: bottom, alphaMode: 'blend', alphaCutoff: LAYERED_ALPHA_CUTOFF, layers: [...stack] },
  ];
}

// Keys are added only when set, so a file without render modes serialises exactly as before render modes were read.
function textureMaterial(name: string, texture: number, mode: RenderMode): SceneMaterial {
  switch (mode) {
    case 'emissive':
      return { name, texture, alphaMode: 'mask', alphaCutoff: BLOCKBENCH_ALPHA_CUTOFF, alphaEmission: true };
    case 'additive':
      return { name, texture, alphaMode: 'blend', alphaCutoff: BLOCKBENCH_ALPHA_CUTOFF, blending: 'additive' };
    default:
      return { name, texture, alphaMode: 'blend', alphaCutoff: BLOCKBENCH_ALPHA_CUTOFF };
  }
}
