import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BbmodelError,
  DEFAULT_BBMODEL_LIMITS,
  listBbmodelReferences,
  loadBbmodel,
  readBbmodelJson,
  type BbmodelJson,
} from '../../src/index';
import { FIXTURE_NAMES, fixture, fixtureTextureFiles } from './fixtures';

const MAX_BYTES = DEFAULT_BBMODEL_LIMITS.maxFileBytes;
const MAX = { maxReferences: 31 };

function failure(run: () => unknown): BbmodelError {
  try {
    run();
  } catch (error) {
    if (error instanceof BbmodelError) return error;
    throw error;
  }
  throw new Error('expected a BbmodelError');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a .bbmodel read once by readBbmodelJson', () => {
  it.each(FIXTURE_NAMES)('loads %s as its bytes do', (name) => {
    const bytes = new TextEncoder().encode(fixture(name));
    const textureFiles = fixtureTextureFiles(name);
    const options = textureFiles ? { textureFiles } : {};
    expect(loadBbmodel(readBbmodelJson(bytes, MAX_BYTES), options)).toEqual(loadBbmodel(bytes, options));
  });

  it('parses the JSON once for listing and loading', () => {
    const bytes = new TextEncoder().encode(fixture('referenced-texture'));
    const parse = vi.spyOn(JSON, 'parse');
    const container = readBbmodelJson(bytes, MAX_BYTES);
    listBbmodelReferences(container, MAX);
    loadBbmodel(container, { textureFiles: fixtureTextureFiles('referenced-texture') ?? new Map() });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('keeps the size of the file it was read from, in UTF-8 bytes for text', () => {
    const text = fixture('single-cube');
    expect(readBbmodelJson(new TextEncoder().encode(text), MAX_BYTES).byteLength).toBe(
      new TextEncoder().encode(text).byteLength,
    );
    const wide = JSON.stringify({ meta: { format_version: '4.5' }, name: 'é😀€' });
    expect(readBbmodelJson(wide, MAX_BYTES).byteLength).toBe(new TextEncoder().encode(wide).byteLength);
  });

  it('is refused by a load whose size limit it is over, as its bytes are', () => {
    const bytes = new TextEncoder().encode(fixture('single-cube'));
    const container = readBbmodelJson(bytes, MAX_BYTES);
    const limits = { maxFileBytes: bytes.byteLength - 1 };
    const fromContainer = failure(() => loadBbmodel(container, { limits }));
    const fromBytes = failure(() => loadBbmodel(bytes, { limits }));
    expect([fromContainer.code, fromContainer.message]).toEqual([fromBytes.code, fromBytes.message]);
    expect(fromContainer.code).toBe('FILE_TOO_LARGE');
  });

  it('fails as the loader does on bad JSON', () => {
    expect(failure(() => readBbmodelJson('{"meta":', MAX_BYTES)).code).toBe('NOT_JSON');
    expect(failure(() => readBbmodelJson(new Uint8Array([0xff]), MAX_BYTES)).code).toBe('NOT_JSON');
  });

  it('takes no look-alike object as a container', () => {
    const real = readBbmodelJson(fixture('single-cube'), MAX_BYTES);
    const copy: BbmodelJson = { ...real };
    expect(failure(() => loadBbmodel(copy)).code).toBe('NOT_JSON');
    expect(listBbmodelReferences(copy, MAX)).toEqual([]);
    expect(failure(() => loadBbmodel(null as unknown as BbmodelJson)).code).toBe('NOT_JSON');
  });
});
