import { describe, expect, it } from 'vitest';
import { GltfAccessors } from '../../src/gltf/GltfAccessors';
import { GltfBuffers } from '../../src/gltf/GltfBuffers';
import { DEFAULT_GLTF_LIMITS } from '../../src/gltf/GltfLoadOptions';
import { GltfError } from '../../src/index';
import { ResourceFiles } from '../../src/resources/ResourceFiles';
import { base64, type Json } from './gltfBuilder';

function accessorsOver(bytes: Uint8Array, bufferViews: Json[], accessors: Json[]): GltfAccessors {
  const json = {
    buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${base64(bytes)}` }],
    bufferViews,
    accessors,
  };
  const buffers = new GltfBuffers(json, {
    bin: null,
    files: new ResourceFiles(undefined),
    limits: DEFAULT_GLTF_LIMITS,
  });
  return new GltfAccessors(json, buffers, DEFAULT_GLTF_LIMITS);
}

function failure(run: () => unknown): GltfError {
  try {
    run();
  } catch (error) {
    if (error instanceof GltfError) return error;
    throw error;
  }
  throw new Error('expected a GltfError');
}

const floats = (...values: number[]) => new Uint8Array(new Float32Array(values).buffer);

describe('GltfAccessors', () => {
  it('reads interleaved attributes through byteStride', () => {
    // Two vertices of position (3 floats) + uv (2 floats): stride 20.
    const bytes = floats(1, 2, 3, 0.25, 0.5, 4, 5, 6, 0.75, 1);
    const accessors = accessorsOver(
      bytes,
      [{ buffer: 0, byteLength: 40, byteStride: 20 }],
      [
        { bufferView: 0, componentType: 5126, count: 2, type: 'VEC3' },
        { bufferView: 0, byteOffset: 12, componentType: 5126, count: 2, type: 'VEC2' },
      ],
    );
    expect([...accessors.readFloats(accessors.describe(0, 'POSITION'))]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...accessors.readFloats(accessors.describe(1, 'TEXCOORD'))]).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('maps normalized unsigned byte and short UVs to 0..1', () => {
    const bytes = new Uint8Array([0, 255, 51, 0, 0, 0, 255, 255]);
    const accessors = accessorsOver(
      bytes,
      [
        { buffer: 0, byteLength: 4 },
        { buffer: 0, byteOffset: 4, byteLength: 4 },
      ],
      [
        { bufferView: 0, componentType: 5121, normalized: true, count: 2, type: 'VEC2' },
        { bufferView: 1, componentType: 5123, normalized: true, count: 1, type: 'VEC2' },
      ],
    );
    expect([...accessors.readFloats(accessors.describe(0, 'TEXCOORD'))].map((x) => Math.round(x * 100) / 100)).toEqual([
      0, 1, 0.2, 0,
    ]);
    expect([...accessors.readFloats(accessors.describe(1, 'TEXCOORD'))]).toEqual([0, 1]);
  });

  it('an accessor without a buffer view reads as zeros', () => {
    const accessors = accessorsOver(new Uint8Array(4), [], [{ componentType: 5126, count: 2, type: 'VEC3' }]);
    expect([...accessors.readFloats(accessors.describe(0, 'POSITION'))]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('rejects an accessor that reads one byte past its view, or past 2^32 by count × stride', () => {
    const bytes = floats(0, 0, 0, 0, 0, 0);
    const past = accessorsOver(
      bytes,
      [{ buffer: 0, byteLength: 24 }],
      [{ bufferView: 0, byteOffset: 1, componentType: 5126, count: 2, type: 'VEC3' }],
    );
    expect(failure(() => past.describe(0, 'POSITION'))).toMatchObject({
      code: 'ACCESSOR_OUT_OF_BOUNDS',
      path: '$.accessors[0]',
    });
    // count × stride passes 2^32: a 32-bit offset would wrap around to a small one.
    const count = Math.ceil(2 ** 32 / 252) + 1;
    const wrapping = accessorsOver(
      bytes,
      [{ buffer: 0, byteLength: 24, byteStride: 252 }],
      [{ bufferView: 0, componentType: 5126, count, type: 'VEC3' }],
    );
    expect(failure(() => wrapping.describe(0, 'POSITION')).code).toBe('ACCESSOR_OUT_OF_BOUNDS');
  });

  it('rejects a buffer view past its buffer', () => {
    const accessors = accessorsOver(
      new Uint8Array(12),
      [{ buffer: 0, byteOffset: 4, byteLength: 12 }],
      [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    );
    expect(failure(() => accessors.describe(0, 'POSITION'))).toMatchObject({
      code: 'ACCESSOR_OUT_OF_BOUNDS',
      path: '$.bufferViews[0]',
    });
  });

  it('rejects a stride that is not a multiple of 4 or shorter than an element', () => {
    const bytes = new Uint8Array(64);
    const odd = accessorsOver(
      bytes,
      [{ buffer: 0, byteLength: 64, byteStride: 6 }],
      [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    );
    expect(failure(() => odd.describe(0, 'POSITION'))).toMatchObject({
      code: 'INVALID_FIELD',
      path: '$.bufferViews[0].byteStride',
    });
    const short = accessorsOver(
      bytes,
      [{ buffer: 0, byteLength: 64, byteStride: 8 }],
      [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    );
    expect(failure(() => short.describe(0, 'POSITION')).code).toBe('INVALID_FIELD');
  });

  it('allows only the layouts glTF allows for each attribute', () => {
    const bytes = new Uint8Array(64);
    const accessors = accessorsOver(
      bytes,
      [{ buffer: 0, byteLength: 64 }],
      [
        { bufferView: 0, componentType: 5121, count: 3, type: 'VEC3' },
        { bufferView: 0, componentType: 5126, count: 1, type: 'VEC2' },
        { bufferView: 0, componentType: 5121, count: 1, type: 'VEC2' },
        { bufferView: 0, componentType: 5126, count: 1, type: 'SCALAR' },
        { bufferView: 0, componentType: 5124, count: 1, type: 'SCALAR' },
      ],
    );
    expect(failure(() => accessors.describe(0, 'POSITION')).code).toBe('INVALID_FIELD');
    expect(failure(() => accessors.describe(1, 'NORMAL')).code).toBe('INVALID_FIELD');
    expect(failure(() => accessors.describe(2, 'TEXCOORD')).code).toBe('INVALID_FIELD');
    expect(failure(() => accessors.describe(3, 'INDICES')).code).toBe('INVALID_FIELD');
    expect(failure(() => accessors.describe(4, 'INDICES'))).toMatchObject({ path: '$.accessors[4].componentType' });
  });

  it('rejects a NaN position or UV, and an index past the vertex count', () => {
    const accessors = accessorsOver(
      new Uint8Array([...floats(0, NaN, 0), 0, 1, 2, 3]),
      [
        { buffer: 0, byteLength: 12 },
        { buffer: 0, byteOffset: 12, byteLength: 4 },
      ],
      [
        { bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' },
        { bufferView: 1, componentType: 5121, count: 4, type: 'SCALAR' },
      ],
    );
    expect(failure(() => accessors.readFloats(accessors.describe(0, 'POSITION')))).toMatchObject({
      code: 'NON_FINITE_DATA',
      path: '$.accessors[0]',
    });
    expect([...accessors.readFloats(accessors.describe(0, 'NORMAL'))][1]).toBeNaN();
    expect([...accessors.readIndices(accessors.describe(1, 'INDICES'), 4)]).toEqual([0, 1, 2, 3]);
    expect(failure(() => accessors.readIndices(accessors.describe(1, 'INDICES'), 3))).toMatchObject({
      code: 'INDEX_OUT_OF_RANGE',
      path: '$.accessors[1]',
    });
  });

  it('flags sparse storage for the caller to skip', () => {
    const accessors = accessorsOver(
      new Uint8Array(12),
      [],
      [{ componentType: 5126, count: 1, type: 'VEC3', sparse: { count: 1 } }],
    );
    expect(accessors.describe(0, 'POSITION').sparse).toBe(true);
  });
});
