import { field, isJsonObject, type JsonObject } from '../json/JsonObject';
import { ReferenceList } from '../resources/ReferenceList';
import type { ReferenceListOptions } from '../resources/ReferenceListOptions';
import { DEFAULT_GLTF_LIMITS } from './GltfLoadOptions';
import { GltfError } from './GltfError';
import { readContainer } from './readContainer';

/**
 * The files a `.gltf` or `.glb` refers to by `uri` (`buffers[]`, then `images[]`), as written, in order, each relative
 * spelling once (`a.bin` and `./a.bin` both stay). `data:` URIs are left out: the loader decodes them. A URL is listed like
 * any other reference, for the caller to refuse. A file the loader would refuse lists nothing; loading it reports why.
 */
export function listGltfReferences(input: string | Uint8Array, options: ReferenceListOptions): string[] {
  let json: JsonObject;
  try {
    ({ json } = readContainer(input, DEFAULT_GLTF_LIMITS.maxFileBytes));
  } catch (error) {
    if (error instanceof GltfError) return [];
    throw error;
  }
  const list = new ReferenceList(options.maxReferences);
  for (const key of ['buffers', 'images']) {
    const entries = field(json, key);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as readonly unknown[]) {
      if (list.full) return list.references;
      const uri = isJsonObject(entry) ? field(entry, 'uri') : undefined;
      if (typeof uri === 'string' && !/^data:/i.test(uri)) list.add(uri);
    }
  }
  return list.references;
}
