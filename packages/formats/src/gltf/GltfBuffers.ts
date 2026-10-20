import { quoteValue } from '../text/quoteValue';
import { decodeDataUri } from '../dataUri/decodeDataUri';
import type { ResourceFiles } from '../resources/ResourceFiles';
import { GltfError } from './GltfError';
import type { GltfLimits } from './GltfLoadOptions';
import { childPath, field, type JsonObject } from '../json/JsonObject';
import { readInteger, readList, readObjects, readOptionalString, readString } from './gltfFields';

export interface GltfBufferSources {
  readonly bin: Uint8Array | null;
  readonly files: ResourceFiles;
  readonly limits: GltfLimits;
}

/**
 * The document's buffers, each resolved the first time a buffer view needs it: the GLB binary chunk (buffer 0 without
 * a `uri`), an embedded `data:` URI, or a file the user picked. Never fetched: a URL or an unpicked file is a
 * `MISSING_BUFFER` error that names the file to pick.
 */
export class GltfBuffers {
  private readonly entries: JsonObject[];
  private readonly resolved = new Map<number, Uint8Array>();

  constructor(
    json: JsonObject,
    private readonly sources: GltfBufferSources,
  ) {
    const list = readList(json, 'buffers', '$', {
      max: sources.limits.maxBuffers,
      code: 'TOO_MANY_BUFFERS',
      what: 'buffers',
    });
    this.entries = readObjects(list, '$.buffers');
    this.entries.forEach((entry, index) => {
      const path = childPath('$.buffers', index);
      readInteger(field(entry, 'byteLength'), childPath(path, 'byteLength'), 1, Number.MAX_SAFE_INTEGER);
      readOptionalString(entry, 'uri', path, sources.limits.maxDataUriChars, '');
    });
  }

  get count(): number {
    return this.entries.length;
  }

  /** Declared `byteLength` of buffer `index` (checked when the buffer list was read). */
  byteLength(index: number): number {
    return field(this.entries[index] ?? {}, 'byteLength') as number;
  }

  /** The bytes of buffer `index`, exactly its declared `byteLength`. */
  get(index: number): Uint8Array {
    const cached = this.resolved.get(index);
    if (cached) return cached;
    const path = childPath('$.buffers', index);
    const entry = this.entries[index];
    if (!entry) throw new GltfError('MISSING_BUFFER', path, 'no such buffer');
    const declared = this.byteLength(index);
    const bytes = this.load(entry, index, path);
    if (bytes.byteLength < declared) {
      throw new GltfError('MISSING_BUFFER', path, `${bytes.byteLength} bytes present, byteLength declares ${declared}`);
    }
    const exact = bytes.subarray(0, declared);
    this.resolved.set(index, exact);
    return exact;
  }

  private load(entry: JsonObject, index: number, path: string): Uint8Array {
    const uriValue = field(entry, 'uri');
    if (uriValue === undefined) {
      if (index === 0 && this.sources.bin) return this.sources.bin;
      throw new GltfError('MISSING_BUFFER', path, 'no uri and no GLB binary chunk');
    }
    const uriPath = childPath(path, 'uri');
    const uri = readString(uriValue, uriPath, this.sources.limits.maxDataUriChars);
    if (/^data:/i.test(uri)) {
      const decoded = decodeDataUri(uri, this.sources.limits.maxDataUriChars);
      if (decoded.ok) return decoded.bytes;
      throw new GltfError('INVALID_FIELD', uriPath, `expected a base64 data URI, got ${quoteValue(uri)}`);
    }
    const found = this.sources.files.resolve(uri);
    if (found.ok) return found.bytes;
    throw new GltfError(
      'MISSING_BUFFER',
      uriPath,
      found.reason === 'NOT_FETCHED'
        ? `${quoteValue(uri)} is a URL and is not fetched; pick the file instead`
        : `pick the file ${quoteValue(found.wanted)} together with the model`,
    );
  }
}
