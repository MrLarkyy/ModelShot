import { field, isJsonObject } from '../json/JsonObject';
import { ReferenceList } from '../resources/ReferenceList';
import type { ReferenceListOptions } from '../resources/ReferenceListOptions';
import { BbmodelError } from './BbmodelError';
import { DEFAULT_BBMODEL_LIMITS } from './BbmodelLoadOptions';
import { readBbmodelJson, type BbmodelJson } from './readBbmodelJson';

/**
 * The texture files a `.bbmodel` refers to, as written, in order, each spelling once: per texture without an embedded
 * (`data:`) `source`, its `relative_path` (relative to the model), else its `name`. Never `path`, the author's absolute
 * path that Blockbench writes next to `relative_path` with the same base name, and never `source`. A value longer than
 * the loader's string limit lists nothing for its texture (the loader refuses it). A file the loader would refuse for
 * its JSON, root or texture count lists nothing; loading it reports why.
 */
export function listBbmodelReferences(
  input: string | Uint8Array | BbmodelJson,
  options: ReferenceListOptions,
): string[] {
  const limits = DEFAULT_BBMODEL_LIMITS;
  let root: unknown;
  try {
    ({ root } = readBbmodelJson(input, limits.maxFileBytes));
  } catch (error) {
    if (error instanceof BbmodelError) return [];
    throw error;
  }
  if (!isJsonObject(root) || !isJsonObject(field(root, 'meta'))) return [];
  const textures = field(root, 'textures');
  if (!Array.isArray(textures) || textures.length > limits.maxTextures) return [];
  const list = new ReferenceList(options.maxReferences);
  for (const texture of textures as readonly unknown[]) {
    if (list.full) break;
    if (!isJsonObject(texture)) continue;
    const source = field(texture, 'source');
    if (typeof source === 'string' && /^data:/i.test(source)) continue;
    const reference = ['relative_path', 'name']
      .map((key) => field(texture, key))
      .find((value): value is string => typeof value === 'string' && value !== '');
    if (reference !== undefined && reference.length <= limits.maxStringChars) list.add(reference);
  }
  return list.references;
}
