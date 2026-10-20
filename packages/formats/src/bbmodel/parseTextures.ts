import type { SceneTexture } from '@modelshot/scene';
import { decodeDataUri } from '../dataUri/decodeDataUri';
import { readPngSize } from '../png/readPngSize';
import { BbmodelError } from './BbmodelError';
import type { BbmodelLimits } from './BbmodelLoadOptions';
import type { BbmodelWarningList } from './BbmodelWarning';
import {
  childPath,
  field,
  readArray,
  readObject,
  readOptionalString,
  readPositiveNumber,
  readString,
  type JsonObject,
} from './JsonFields';
import { quoteValue } from '../text/quoteValue';
import { RENDER_SIDES, type RenderSides } from './RenderSides';

/** What the loader knows about a texture before any bytes are decoded. */
export interface TextureEntry {
  readonly path: string;
  readonly name: string;
  /** Texture uuid, `''` when absent. */
  readonly sourceId: string;
  /** Embedded or external `source`, `''` when absent. */
  readonly source: string;
  /** Lower-cased base names to look up in the picked files, in order of preference. */
  readonly fileKeys: readonly string[];
  readonly uvWidth: number;
  readonly uvHeight: number;
  readonly renderSides: RenderSides;
}

export interface UvSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Reads texture metadata and checks the texture count; decodes nothing. With `perTextureUvSize` (Blockbench's `free`
 * format) a texture's `uv_width`/`uv_height` set its UV space; otherwise every texture uses the project resolution.
 */
export function readTextureEntries(
  root: JsonObject,
  resolution: UvSize,
  perTextureUvSize: boolean,
  limits: BbmodelLimits,
  warnings: BbmodelWarningList,
): TextureEntry[] {
  const value = field(root, 'textures');
  if (value === undefined) return [];
  const list = readArray(value, '$.textures', { max: limits.maxTextures, code: 'TOO_MANY_TEXTURES', what: 'textures' });
  return list.map((item, index) => {
    const path = childPath('$.textures', index);
    const fixedUvSize = perTextureUvSize ? undefined : resolution;
    return readTextureEntry(item, path, index, fixedUvSize, resolution, limits, warnings);
  });
}

/** Texture index by uuid; the first texture with a uuid wins. */
export function textureIdIndex(entries: readonly TextureEntry[]): Map<string, number> {
  const ids = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.sourceId !== '' && !ids.has(entry.sourceId)) ids.set(entry.sourceId, index);
  });
  return ids;
}

function readTextureEntry(
  value: unknown,
  path: string,
  index: number,
  fixedUvSize: UvSize | undefined,
  resolution: UvSize,
  limits: BbmodelLimits,
  warnings: BbmodelWarningList,
): TextureEntry {
  const texture = readObject(value, path);
  const name = readOptionalString(texture, 'name', path, limits.maxStringChars, `texture ${index}`);
  const sourceValue = field(texture, 'source');
  const sourcePath = childPath(path, 'source');
  if (typeof sourceValue === 'string' && sourceValue.length > limits.maxDataUriChars) {
    throw new BbmodelError(
      'TEXTURE_TOO_LARGE',
      sourcePath,
      `${sourceValue.length} characters, the limit is ${limits.maxDataUriChars}`,
    );
  }
  const source = sourceValue === undefined ? '' : readString(sourceValue, sourcePath, limits.maxDataUriChars);
  const fileKeys = ['relative_path', 'path', 'name']
    .map((key) => readOptionalString(texture, key, path, limits.maxStringChars, ''))
    .map(baseName)
    .filter((key) => key !== '');
  const uvSize = fixedUvSize ?? {
    width: readOptionalPositive(texture, 'uv_width', path, resolution.width),
    height: readOptionalPositive(texture, 'uv_height', path, resolution.height),
  };
  return {
    path,
    name,
    sourceId: readOptionalString(texture, 'uuid', path, limits.maxStringChars, ''),
    source,
    fileKeys,
    uvWidth: uvSize.width,
    uvHeight: uvSize.height,
    renderSides: readRenderSides(texture, path, warnings),
  };
}

/** Absent: `auto`; an unknown string warns and counts as `auto`. */
function readRenderSides(texture: JsonObject, path: string, warnings: BbmodelWarningList): RenderSides {
  const value = field(texture, 'render_sides');
  if (value === undefined) return 'auto';
  const valuePath = childPath(path, 'render_sides');
  if (typeof value !== 'string') {
    throw new BbmodelError('INVALID_FIELD', valuePath, `expected auto, front or double, got ${quoteValue(value)}`);
  }
  const sides = RENDER_SIDES.find((candidate) => candidate === value);
  if (sides === undefined) {
    warnings.add('UNSUPPORTED_VALUE', valuePath, `${quoteValue(value)} is not auto, front or double; using auto`);
    return 'auto';
  }
  return sides;
}

function readOptionalPositive(texture: JsonObject, key: string, path: string, fallback: number): number {
  const value = field(texture, key);
  return value === undefined ? fallback : readPositiveNumber(value, childPath(path, key));
}

function baseName(fileName: string): string {
  const parts = fileName.split(/[\\/]/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/**
 * Turns entries into scene textures: embedded PNG data URIs are decoded, anything else is looked up in the files the
 * user picked. A URL or file path in the model is never fetched or opened.
 */
export function resolveTextures(
  entries: readonly TextureEntry[],
  textureFiles: ReadonlyMap<string, Uint8Array> | undefined,
  limits: BbmodelLimits,
  warnings: BbmodelWarningList,
): SceneTexture[] {
  const files = new Map<string, Uint8Array>();
  for (const [fileName, bytes] of textureFiles ?? []) {
    const key = baseName(fileName);
    if (!files.has(key)) files.set(key, bytes);
  }
  return entries.map((entry) => resolveTexture(entry, files, limits, warnings));
}

function resolveTexture(
  entry: TextureEntry,
  files: ReadonlyMap<string, Uint8Array>,
  limits: BbmodelLimits,
  warnings: BbmodelWarningList,
): SceneTexture {
  const sourcePath = childPath(entry.path, 'source');
  let bytes: Uint8Array | undefined;
  let bytesPath = sourcePath;
  let origin = 'embedded image';
  if (/^data:/i.test(entry.source)) {
    bytes = decodeEmbedded(entry.source, sourcePath, limits);
  } else {
    if (entry.source !== '') {
      warnings.add('SOURCE_NOT_FETCHED', sourcePath, `${quoteValue(entry.source)} is not embedded; nothing is fetched`);
    }
    const key = entry.fileKeys.find((candidate) => files.has(candidate));
    bytes = key === undefined ? undefined : files.get(key);
    bytesPath = entry.path;
    origin = `picked file ${quoteValue(key)}`;
  }
  const texture = {
    name: entry.name,
    mimeType: 'image/png' as const,
    uvWidth: entry.uvWidth,
    uvHeight: entry.uvHeight,
  };
  if (!bytes) {
    const wanted = entry.fileKeys[0];
    const detail = wanted === undefined ? 'no file name to match' : `no picked file ${quoteValue(wanted)}`;
    warnings.add('MISSING_TEXTURE', entry.path, `no embedded image and ${detail}`);
    return { ...texture, bytes: null, width: 0, height: 0, missing: true };
  }
  const size = readPngSize(bytes);
  if (!size.ok) throw new BbmodelError('BAD_TEXTURE', bytesPath, `${origin}: expected a PNG image (${size.reason})`);
  if (size.width > limits.maxTextureSide || size.height > limits.maxTextureSide) {
    throw new BbmodelError(
      'TEXTURE_TOO_LARGE',
      bytesPath,
      `${origin}: ${size.width}×${size.height} pixels, the side limit is ${limits.maxTextureSide}`,
    );
  }
  if (size.width * size.height > limits.maxTexturePixels) {
    throw new BbmodelError(
      'TEXTURE_TOO_LARGE',
      bytesPath,
      `${origin}: ${size.width}×${size.height} pixels, the limit is ${limits.maxTexturePixels} pixels`,
    );
  }
  return { ...texture, bytes, width: size.width, height: size.height, missing: false };
}

function decodeEmbedded(source: string, path: string, limits: BbmodelLimits): Uint8Array {
  const decoded = decodeDataUri(source, limits.maxDataUriChars);
  if (!decoded.ok) {
    if (decoded.reason === 'TOO_LONG') {
      throw new BbmodelError('TEXTURE_TOO_LARGE', path, `the limit is ${limits.maxDataUriChars} characters`);
    }
    throw new BbmodelError('BAD_TEXTURE', path, `expected a base64 PNG data URI, got ${quoteValue(source)}`);
  }
  if (decoded.mimeType !== 'image/png') {
    throw new BbmodelError('BAD_TEXTURE', path, `expected a PNG data URI, got ${quoteValue(decoded.mimeType)}`);
  }
  return decoded.bytes;
}
