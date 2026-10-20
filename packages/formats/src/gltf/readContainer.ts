import { quoteValue } from '../bbmodel/quoteValue';
import { utf8LengthExceeds } from '../text/utf8LengthExceeds';
import { GltfError } from './GltfError';
import { field, isJsonObject, readString, type JsonObject } from './gltfFields';

/** The glTF JSON and, for a GLB, its binary chunk (buffer 0 when that buffer has no `uri`). */
export interface GltfContainer {
  readonly kind: 'gltf' | 'glb';
  readonly json: JsonObject;
  readonly bin: Uint8Array | null;
  /** `asset.version`, e.g. `"2.0"`. */
  readonly version: string;
}

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/**
 * Size-checks the file, splits a GLB into its chunks (every length checked against the bytes present before anything is
 * sliced), decodes strict UTF-8, parses the JSON and checks `asset.version`. A `.gltf` given as text is never a GLB.
 */
export function readContainer(input: string | Uint8Array, maxFileBytes: number): GltfContainer {
  let text: string;
  let bin: Uint8Array | null = null;
  let kind: GltfContainer['kind'] = 'gltf';
  if (typeof input === 'string') {
    if (utf8LengthExceeds(input, maxFileBytes)) {
      throw new GltfError('FILE_TOO_LARGE', '$', `more than the limit of ${maxFileBytes} bytes`);
    }
    text = input;
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > maxFileBytes) {
      throw new GltfError('FILE_TOO_LARGE', '$', `${input.byteLength} bytes, the limit is ${maxFileBytes}`);
    }
    if (hasGlbMagic(input)) {
      kind = 'glb';
      const chunks = readGlbChunks(input);
      bin = chunks.bin;
      text = decodeUtf8(chunks.json, 'glb[20]');
    } else {
      text = decodeUtf8(input, '$');
    }
  } else {
    throw new GltfError('NOT_JSON', '$', 'expected the file as a string or bytes');
  }
  const json = parseJson(text.startsWith('\uFEFF') ? text.slice(1) : text);
  return { kind, json, bin, version: readAssetVersion(json) };
}

function hasGlbMagic(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === GLB_MAGIC;
}

function readGlbChunks(bytes: Uint8Array): { json: Uint8Array; bin: Uint8Array | null } {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new GltfError('NOT_GLB', 'glb[0]', `${bytes.byteLength} bytes, shorter than the 12-byte header`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 2) throw new GltfError('UNSUPPORTED_VERSION', 'glb[4]', `container version ${version}, expected 2`);
  const length = view.getUint32(8, true);
  if (length > bytes.byteLength || length < HEADER_BYTES + CHUNK_HEADER_BYTES) {
    throw new GltfError('NOT_GLB', 'glb[8]', `declared length ${length}, the file has ${bytes.byteLength} bytes`);
  }
  let json: Uint8Array | null = null;
  let bin: Uint8Array | null = null;
  let offset = HEADER_BYTES;
  let index = 0;
  while (offset < length) {
    if (offset + CHUNK_HEADER_BYTES > length) {
      throw new GltfError('NOT_GLB', `glb[${offset}]`, 'chunk header runs past the declared length');
    }
    const chunkLength = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + CHUNK_HEADER_BYTES;
    if (chunkLength % 4 !== 0 || chunkLength > length - start) {
      throw new GltfError('NOT_GLB', `glb[${offset}]`, `chunk length ${chunkLength} is unaligned or past the end`);
    }
    const data = bytes.subarray(start, start + chunkLength);
    if (index === 0) {
      if (type !== CHUNK_JSON) throw new GltfError('NOT_GLB', `glb[${offset + 4}]`, 'the first chunk is not JSON');
      json = data;
    } else if (type === CHUNK_JSON) {
      throw new GltfError('NOT_GLB', `glb[${offset + 4}]`, 'a second JSON chunk');
    } else if (type === CHUNK_BIN) {
      if (index !== 1) throw new GltfError('NOT_GLB', `glb[${offset + 4}]`, 'the BIN chunk must be the second chunk');
      bin = data;
    }
    // Chunks of other types are skipped, as the GLB spec asks.
    offset = start + chunkLength;
    index++;
  }
  if (!json) throw new GltfError('NOT_GLB', 'glb[12]', 'no JSON chunk');
  return { json, bin };
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new GltfError('NOT_JSON', path, 'expected UTF-8 text');
  }
}

function parseJson(text: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    // SyntaxError, or RangeError on pathological nesting; the engine's message may quote the file, so it is dropped.
    throw new GltfError('NOT_JSON', '$', 'expected a JSON document');
  }
  if (!isJsonObject(value)) throw new GltfError('NOT_GLTF', '$', `expected an object, got ${quoteValue(value)}`);
  return value;
}

/** `asset.version` must be 2.x and `asset.minVersion`, when present, at most 2.0. */
function readAssetVersion(json: JsonObject): string {
  const asset = field(json, 'asset');
  if (!isJsonObject(asset)) throw new GltfError('NOT_GLTF', '$.asset', `expected an object, got ${quoteValue(asset)}`);
  const versionValue = field(asset, 'version');
  if (versionValue === undefined) throw new GltfError('NOT_GLTF', '$.asset.version', 'expected a version string');
  const version = readString(versionValue, '$.asset.version', 32);
  const parsed = parseVersion(version);
  if (!parsed || parsed[0] !== 2) {
    throw new GltfError('UNSUPPORTED_VERSION', '$.asset.version', `expected 2.x, got ${quoteValue(version)}`);
  }
  const minValue = field(asset, 'minVersion');
  if (minValue !== undefined) {
    const min = parseVersion(readString(minValue, '$.asset.minVersion', 32));
    if (!min || min[0] > 2 || (min[0] === 2 && min[1] > 0)) {
      throw new GltfError('UNSUPPORTED_VERSION', '$.asset.minVersion', `needs ${quoteValue(minValue)}, this is 2.0`);
    }
  }
  return version;
}

function parseVersion(version: string): [number, number] | null {
  const match = /^(\d{1,4})\.(\d{1,4})$/.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : null;
}
