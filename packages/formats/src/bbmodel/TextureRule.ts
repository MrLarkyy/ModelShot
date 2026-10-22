/**
 * Which texture a face shows in a model format (Blockbench `Face.getTexture`): `perFace` the one it stores; `single`
 * (`Format.single_texture`) the default texture on every face; `singleDefault` (`Format.single_texture_default`) the
 * default texture on blank faces only, or on every face in a format with per-group textures.
 *
 * Plugin formats are keyed by the id their plugin registers (the loader models the plugin as installed); an id no list
 * names keeps `perFace` and the project resolution.
 */
export type TextureRule = 'perFace' | 'single' | 'singleDefault';

const SINGLE_TEXTURE_FORMATS: ReadonlySet<string> = new Set([
  'bedrock',
  'bedrock_old',
  'modded_entity',
  'skin',
  'image',
  'geckolib_model',
  'animated_entity_model',
  'azure_model',
  'cosmic_reach_entity_model',
  'optifine_player_model',
]);
/** Hytale's `single_texture` is a getter that holds while the project has no collections. */
const COLLECTION_SINGLE_TEXTURE_FORMATS: ReadonlySet<string> = new Set(['hytale_character', 'hytale_prop']);
const SINGLE_TEXTURE_DEFAULT_FORMATS: ReadonlySet<string> = new Set([
  'bedrock_block',
  'optifine_entity',
  'optifine_part',
  'hytale_character',
  'hytale_prop',
]);
const PER_TEXTURE_UV_SIZE_FORMATS: ReadonlySet<string> = new Set([
  'free',
  'image',
  'optifine_entity',
  'optifine_part',
  'figura',
  'hytale_character',
  'hytale_prop',
]);
const PER_GROUP_TEXTURE_FORMATS: ReadonlySet<string> = new Set(['optifine_entity', 'optifine_part']);
const BOX_UV_FLOAT_SIZE_FORMATS: ReadonlySet<string> = new Set(['modded_entity', 'hytale_character', 'hytale_prop']);

/**
 * The format's texture rule; `hasCollections` is whether the file has a non-empty `collections` array, which turns
 * Hytale's `single_texture` off (its `single_texture_default` stays). Hytale cubes then follow their collections
 * instead (`formatCollectionTextures`), so with collections the rule decides only Hytale mesh faces.
 */
export function formatTextureRule(modelFormat: string, hasCollections = false): TextureRule {
  if (SINGLE_TEXTURE_FORMATS.has(modelFormat)) return 'single';
  if (COLLECTION_SINGLE_TEXTURE_FORMATS.has(modelFormat) && !hasCollections) return 'single';
  if (SINGLE_TEXTURE_DEFAULT_FORMATS.has(modelFormat)) return 'singleDefault';
  return 'perFace';
}

/**
 * `Format.single_texture_default`: `Texture.getDefault` prefers the first `use_as_default` texture, whether or not
 * `single_texture` also holds.
 */
export function formatSingleTextureDefault(modelFormat: string): boolean {
  return SINGLE_TEXTURE_DEFAULT_FORMATS.has(modelFormat);
}

/**
 * `Format.per_texture_uv_size`: a texture's `uv_width`/`uv_height` set its UV space (`Texture.getUVWidth`). Bedrock
 * turns it on only with a multi-file ruleset, which is runtime state not saved in the file.
 */
export function formatPerTextureUvSize(modelFormat: string): boolean {
  return PER_TEXTURE_UV_SIZE_FORMATS.has(modelFormat);
}

/** `Format.per_group_texture`: a group's `texture` (uuid) wins over its elements' faces. */
export function formatPerGroupTexture(modelFormat: string): boolean {
  return PER_GROUP_TEXTURE_FORMATS.has(modelFormat);
}

/**
 * Whether the format's cube faces follow the file's `collections` (`readCollections`): the Hytale plugin replaces
 * `CubeFace.getTexture` (hytale_plugin.js:1283-1302) so a cube in a collection shows that collection's texture and any
 * other cube the default texture, on every non-null face. Mesh faces keep `Face.getTexture`.
 */
export function formatCollectionTextures(modelFormat: string): boolean {
  return COLLECTION_SINGLE_TEXTURE_FORMATS.has(modelFormat);
}

/** `Format.box_uv_float_size`: box-UV cube sizes are not floored to whole pixels. */
export function formatBoxUvFloatSize(modelFormat: string): boolean {
  return BOX_UV_FLOAT_SIZE_FORMATS.has(modelFormat);
}

/**
 * Whether a `layered` texture composites in this format: Blockbench's cube and mesh controllers use
 * `Canvas.getLayeredMaterial` only under `single_texture` or `single_texture_default`; elsewhere `layered` draws as
 * `default`. Every Hytale format has `single_texture_default`, so its collections do not matter here.
 */
export function formatLayersTextures(modelFormat: string): boolean {
  return (
    SINGLE_TEXTURE_FORMATS.has(modelFormat) ||
    COLLECTION_SINGLE_TEXTURE_FORMATS.has(modelFormat) ||
    SINGLE_TEXTURE_DEFAULT_FORMATS.has(modelFormat)
  );
}

/**
 * Blockbench `Texture.getDefault` for a freshly opened project (no texture selected, `Texture.selected` is runtime
 * state): the first `use_as_default` texture when `useAsDefault` (`formatSingleTextureDefault`), else the last visible
 * texture when there are two or more textures and one is layered, else the first texture; −1 for none.
 */
export function defaultTexture(
  useAsDefault: boolean,
  textures: readonly { readonly useAsDefault: boolean; readonly visible: boolean; readonly renderMode: string }[],
): number {
  if (useAsDefault) {
    const marked = textures.findIndex((texture) => texture.useAsDefault);
    if (marked >= 0) return marked;
  }
  if (textures.length > 1 && textures.some((texture) => texture.renderMode === 'layered')) {
    return textures.findLastIndex((texture) => texture.visible);
  }
  return textures.length > 0 ? 0 : -1;
}
