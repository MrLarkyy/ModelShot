/**
 * Which texture a face shows in a model format (Blockbench `Face.getTexture`): `perFace` the one it stores; `single`
 * (`Format.single_texture`) the default texture on every face; `singleDefault` (`Format.single_texture_default`) the
 * default texture on blank faces only, or on every face in a format with per-group textures.
 */
export type TextureRule = 'perFace' | 'single' | 'singleDefault';

const SINGLE_TEXTURE_FORMATS: ReadonlySet<string> = new Set([
  'bedrock',
  'bedrock_old',
  'modded_entity',
  'skin',
  'image',
]);
const SINGLE_TEXTURE_DEFAULT_FORMATS: ReadonlySet<string> = new Set([
  'bedrock_block',
  'optifine_entity',
  'optifine_part',
]);
const PER_GROUP_TEXTURE_FORMATS: ReadonlySet<string> = new Set(['optifine_entity', 'optifine_part']);

export function formatTextureRule(modelFormat: string): TextureRule {
  if (SINGLE_TEXTURE_FORMATS.has(modelFormat)) return 'single';
  if (SINGLE_TEXTURE_DEFAULT_FORMATS.has(modelFormat)) return 'singleDefault';
  return 'perFace';
}

/** `Format.per_group_texture`: a group's `texture` (uuid) wins over its elements' faces. */
export function formatPerGroupTexture(modelFormat: string): boolean {
  return PER_GROUP_TEXTURE_FORMATS.has(modelFormat);
}

/**
 * Whether a `layered` texture composites in this format: Blockbench's cube and mesh controllers use
 * `Canvas.getLayeredMaterial` only under `single_texture` or `single_texture_default`; elsewhere `layered` draws as
 * `default`.
 */
export function formatLayersTextures(modelFormat: string): boolean {
  return formatTextureRule(modelFormat) !== 'perFace';
}

/**
 * Blockbench `Texture.getDefault` for a freshly opened project (no texture selected, `Texture.selected` is runtime
 * state): the first `use_as_default` texture under `singleDefault`, else the last visible texture when there are two
 * or more textures and one is layered, else the first texture; −1 for none.
 */
export function defaultTexture(
  rule: TextureRule,
  textures: readonly { readonly useAsDefault: boolean; readonly visible: boolean; readonly renderMode: string }[],
): number {
  if (rule === 'singleDefault') {
    const marked = textures.findIndex((texture) => texture.useAsDefault);
    if (marked >= 0) return marked;
  }
  if (textures.length > 1 && textures.some((texture) => texture.renderMode === 'layered')) {
    return textures.findLastIndex((texture) => texture.visible);
  }
  return textures.length > 0 ? 0 : -1;
}
