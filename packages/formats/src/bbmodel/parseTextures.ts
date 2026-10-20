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
import { quoteValue } from './quoteValue';

/** What the loader knows about a texture before any bytes are decoded. */
export interface TextureEntry {
  readonly path: string;
  readonly name: string;
  /** Embedded or external `source`, `''` when absent. */
  readonly source: string;
  /** Lower-cased base names to look up in the picked files, in order of preference. */
  readonly fileKeys: readonly string[];
  readonly uvWidth: number;
  readonly uvHeight: number;
}

export interface UvSize {
  readonly width: number;
  readonly height: number;
}

/** Reads texture metadata and checks the texture count; decodes nothing. */
export function readTextureEntries(root: JsonObject, resolution: UvSize, limits: BbmodelLimits): TextureEntry[] {
  const value = field(root, 'textures');
  if (value === undefined) return [];
  const list = readArray(value, '$.textures', { max: limits.maxTextures, code: 'TOO_MANY_TEXTURES', what: 'textures' });
  return list.map((item, index) => readTextureEntry(item, childPath('$.textures', index), index, resolution, limits));
}

function readTextureEntry(
  value: unknown,
  path: string,
  index: number,
  resolution: UvSize,
  limits: BbmodelLimits,
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
  const uvWidthValue = field(texture, 'uv_width');
  const uvHeightValue = field(texture, 'uv_height');
  return {
    path,
    name,
    source,
    fileKeys,
    uvWidth:
      uvWidthValue === undefined ? resolution.width : readPositiveNumber(uvWidthValue, childPath(path, 'uv_width')),
    uvHeight:
      uvHeightValue === undefined ? resolution.height : readPositiveNumber(uvHeightValue, childPath(path, 'uv_height')),
  };
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
