import { DEFAULT_TEXTURE_FILTER, type SceneDocument, type SceneTextureFilter } from '@modelshot/scene';

/** The filter each texture of the document samples with. */
export function textureFilters(doc: SceneDocument): SceneTextureFilter[] {
  return doc.textures.map((texture) => texture.filter ?? DEFAULT_TEXTURE_FILTER);
}

// The document with the texture filters the panel holds. A texture whose filter does not change keeps its identity.
export function withTextureFilters(
  base: SceneDocument,
  filters: readonly (SceneTextureFilter | undefined)[],
): SceneDocument {
  const textures = base.textures.map((texture, i) => {
    const wanted = filters[i];
    if (wanted === undefined || wanted === (texture.filter ?? DEFAULT_TEXTURE_FILTER)) return texture;
    return { ...texture, filter: wanted };
  });
  return textures.every((texture, i) => texture === base.textures[i]) ? base : { ...base, textures };
}
