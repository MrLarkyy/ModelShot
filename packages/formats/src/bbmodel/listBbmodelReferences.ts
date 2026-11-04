import { field, isJsonObject, type JsonObject } from '../json/JsonObject';
import { ReferenceList } from '../resources/ReferenceList';
import type { ReferenceListOptions } from '../resources/ReferenceListOptions';
import { BbmodelError } from './BbmodelError';
import { DEFAULT_BBMODEL_LIMITS } from './BbmodelLoadOptions';
import { formatVersionBefore } from './formatVersionBefore';
import { readBbmodelJson, type BbmodelJson } from './readBbmodelJson';

/**
 * The texture files a `.bbmodel` refers to, in order, each spelling once: per texture without an embedded (`data:`)
 * `source`, its `relative_path` (relative to the model's directory), else its `name`. Never `path`, the author's
 * absolute path that Blockbench writes next to `relative_path` with the same base name, and never `source`. Before
 * format 4.10 Blockbench wrote `relative_path` against the model file itself, one `..` too many, and drops it on import
 * (`../tex/a.png` is `tex/a.png` next to the model); the list does the same, and keeps every other value as written.
 * A value longer than the loader's string limit lists nothing for its texture (the loader refuses it). A file the
 * loader would refuse for its JSON, root or texture count lists nothing; loading it reports why.
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
  if (!isJsonObject(root)) return [];
  const meta = field(root, 'meta');
  if (!isJsonObject(meta)) return [];
  const textures = field(root, 'textures');
  if (!Array.isArray(textures) || textures.length > limits.maxTextures) return [];
  const fileRelative = relativeToFile(meta);
  const list = new ReferenceList(options.maxReferences);
  for (const texture of textures as readonly unknown[]) {
    if (list.full) break;
    if (!isJsonObject(texture)) continue;
    const source = field(texture, 'source');
    if (typeof source === 'string' && /^data:/i.test(source)) continue;
    const relativePath = nonEmptyString(field(texture, 'relative_path'));
    const reference = relativePath ?? nonEmptyString(field(texture, 'name'));
    if (reference === undefined || reference.length > limits.maxStringChars) continue;
    list.add(relativePath !== undefined && fileRelative ? reference.replace(/^\.\.[/\\]/, '') : reference);
  }
  return list.references;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A `format_version` before 4.10; a missing or malformed one counts as current, its paths read as written. */
function relativeToFile(meta: JsonObject): boolean {
  const value = field(meta, 'format_version');
  const version = typeof value === 'number' ? String(value) : value;
  if (typeof version !== 'string' || version.length > 32 || !/^\d{1,4}(\.\d{1,4}){0,3}$/.test(version)) return false;
  return formatVersionBefore(version, '4.10');
}
