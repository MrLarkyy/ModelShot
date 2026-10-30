import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GltfError,
  listGltfReferences,
  loadGltf,
  readGltfContainer,
  DEFAULT_GLTF_LIMITS,
  type GltfContainer,
} from '../../src/index';
import { GLTF_FIXTURE_NAMES, gltfFixture, gltfFixtureFiles } from './fixtures';
import { gltfDoc, toGlb } from './gltfBuilder';

const MAX_BYTES = DEFAULT_GLTF_LIMITS.maxFileBytes;
const MAX = { maxReferences: 31 };

function failure(run: () => unknown): GltfError {
  try {
    run();
  } catch (error) {
    if (error instanceof GltfError) return error;
    throw error;
  }
  throw new Error('expected a GltfError');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a glTF read once by readGltfContainer', () => {
  it.each(GLTF_FIXTURE_NAMES)('loads %s as its bytes do', (name) => {
    const bytes = new TextEncoder().encode(gltfFixture(name));
    const files = gltfFixtureFiles(name);
    const options = files ? { files } : {};
    expect(loadGltf(readGltfContainer(bytes, MAX_BYTES), options)).toEqual(loadGltf(bytes, options));
  });

  it('loads a GLB as its bytes do', () => {
    const glb = toGlb(gltfDoc());
    const container = readGltfContainer(glb, MAX_BYTES);
    expect(container.kind).toBe('glb');
    expect(loadGltf(container)).toEqual(loadGltf(glb));
  });

  it('lists the references its bytes list', () => {
    const bytes = new TextEncoder().encode(gltfFixture('external'));
    expect(listGltfReferences(readGltfContainer(bytes, MAX_BYTES), MAX)).toEqual(listGltfReferences(bytes, MAX));
  });

  it('parses the JSON once for listing and loading', () => {
    const bytes = new TextEncoder().encode(gltfFixture('external'));
    const parse = vi.spyOn(JSON, 'parse');
    const container = readGltfContainer(bytes, MAX_BYTES);
    listGltfReferences(container, MAX);
    loadGltf(container, { files: gltfFixtureFiles('external') ?? new Map() });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('keeps the size of the file it was read from, in UTF-8 bytes for text', () => {
    const text = gltfFixture('external');
    expect(readGltfContainer(new TextEncoder().encode(text), MAX_BYTES).byteLength).toBe(
      new TextEncoder().encode(text).byteLength,
    );
    const wide = JSON.stringify({ asset: { version: '2.0', generator: 'é😀€' } });
    expect(readGltfContainer(wide, MAX_BYTES).byteLength).toBe(new TextEncoder().encode(wide).byteLength);
  });

  it('is refused by a load whose size limit it is over, as its bytes are', () => {
    const glb = toGlb(gltfDoc());
    const container = readGltfContainer(glb, MAX_BYTES);
    const limits = { maxFileBytes: glb.byteLength - 1 };
    const fromContainer = failure(() => loadGltf(container, { limits }));
    const fromBytes = failure(() => loadGltf(glb, { limits }));
    expect([fromContainer.code, fromContainer.message]).toEqual([fromBytes.code, fromBytes.message]);
    expect(fromContainer.code).toBe('FILE_TOO_LARGE');
  });

  it('takes no look-alike object as a container', () => {
    const real = readGltfContainer(new TextEncoder().encode(gltfFixture('scene-nodes')), MAX_BYTES);
    const copy: GltfContainer = { ...real };
    expect(failure(() => loadGltf(copy)).code).toBe('NOT_JSON');
    expect(listGltfReferences(copy, MAX)).toEqual([]);
    expect(failure(() => loadGltf(null as unknown as GltfContainer)).code).toBe('NOT_JSON');
  });
});
