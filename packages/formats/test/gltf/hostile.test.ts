import { describe, expect, it } from 'vitest';
import { loadGltf } from '../../src/index';
import { expectGltfError, gltfFailure, json } from './expectGltfError';
import { gltfDoc, toGlb, TRIANGLE, type Json } from './gltfBuilder';

const LONG = 'A'.repeat(40);

function withBufferUri(uri: string): Json {
  const doc = gltfDoc();
  (doc.buffers as Json[])[0]!.uri = uri;
  return doc;
}

describe('hostile glTF input', () => {
  it('deeply nested JSON fails as a GltfError, never a stack overflow', () => {
    expectGltfError('['.repeat(200_000), 'NOT_JSON', '$');
    // The engine's parser may accept the depth; the loader never recurses into it.
    expectGltfError(`{"asset":${'['.repeat(200_000)}${']'.repeat(200_000)}}`, 'NOT_GLTF', '$.asset');
  });

  it('a huge count without a buffer view fails on the vertex or triangle limit, never by allocating', () => {
    const doc = gltfDoc();
    (doc.accessors as Json[])[0] = { componentType: 5126, count: 2 ** 31, type: 'VEC3' };
    expectGltfError(json(doc), 'INVALID_FIELD', '$.accessors[1]');
    const positionsOnly = gltfDoc({ meshes: [[{ positions: TRIANGLE.positions }]] });
    (positionsOnly.accessors as Json[])[0] = { componentType: 5126, count: 3 * 2 ** 30, type: 'VEC3' };
    expectGltfError(json(positionsOnly), 'TOO_MANY_TRIANGLES', '$.nodes[0]');
    const withNormals = gltfDoc({ meshes: [[{ ...TRIANGLE, indices: [0, 1, 2] }]] });
    const accessors = withNormals.accessors as Json[];
    accessors[0] = { componentType: 5126, count: 2 ** 30, type: 'VEC3' };
    accessors[1] = { componentType: 5126, count: 2 ** 30, type: 'VEC3' };
    delete (withNormals.meshes as { primitives: { attributes: Json }[] }[])[0]!.primitives[0]!.attributes.TEXCOORD_0;
    expectGltfError(json(withNormals), 'TOO_MANY_VERTICES', '$.nodes[0]');
    const indexed = gltfDoc({ meshes: [[{ ...TRIANGLE, indices: [0, 1, 2] }]] });
    (indexed.accessors as Json[])[3] = { componentType: 5125, count: 3 * 2 ** 30, type: 'SCALAR' };
    expectGltfError(json(indexed), 'TOO_MANY_TRIANGLES', '$.nodes[0]');
  });

  it('a mesh instanced by thousands of nodes fails on the vertex limit', () => {
    const nodes = Array.from({ length: 10_000 }, () => ({ mesh: 0 }));
    const thousand = { positions: Array<number>(3 * 3000).fill(0), normals: Array<number>(3 * 3000).fill(1) };
    // 3000 vertices per instance: the 134th instance passes the 400 000 vertex limit.
    expectGltfError(json(gltfDoc({ meshes: [[thousand]], nodes })), 'TOO_MANY_VERTICES', '$.nodes[133]');
  });

  it('prototype keys are inert', () => {
    const text = json(gltfDoc()).replace('"nodes":[{', '"nodes":[{"__proto__":{"mesh":5},"constructor":{"x":1},');
    const { scene } = loadGltf(text);
    expect(scene.meshes).toHaveLength(1);
    expect(({} as Record<string, unknown>).mesh).toBeUndefined();
  });

  it('wrong types fail with a path, quoting at most 32 characters', () => {
    const cases: [Json, string][] = [
      [{ ...gltfDoc(), nodes: [{ name: 7 }] }, '$.nodes[0].name'],
      [{ ...gltfDoc(), nodes: 'x' }, '$.nodes'],
      [{ ...gltfDoc(), nodes: [LONG] }, '$.nodes[0]'],
      [{ ...gltfDoc(), scene: LONG }, '$.scene'],
      [withBufferUri(`data:application/octet-stream;base64,${LONG}!`), '$.buffers[0].uri'],
      [{ ...gltfDoc(), buffers: [{ byteLength: -4 }] }, '$.buffers[0].byteLength'],
      [
        { ...gltfDoc(), materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, LONG, 1] } }] },
        '$.materials[0].pbrMetallicRoughness.baseColorFactor[2]',
      ],
      [{ ...gltfDoc(), nodes: [{ translation: [1, 2] }] }, '$.nodes[0].translation'],
    ];
    for (const [doc, path] of cases) {
      const error = expectGltfError(json(doc), 'INVALID_FIELD', path);
      expect(error.message).not.toContain(LONG.slice(0, 33));
    }
  });

  it('an index past the vertex count is INDEX_OUT_OF_RANGE', () => {
    expectGltfError(
      json(gltfDoc({ meshes: [[{ ...TRIANGLE, indices: [0, 1, 3] }]] })),
      'INDEX_OUT_OF_RANGE',
      '$.accessors[3]',
    );
  });

  it('a GLB with a JSON chunk of garbage, or a BIN chunk shorter than buffer 0, fails cleanly', () => {
    const glb = toGlb(gltfDoc());
    const garbled = new Uint8Array(glb);
    garbled.fill(0x41, 20, 30);
    expect(gltfFailure(garbled).code).toBe('NOT_JSON');
    const view = new DataView(glb.buffer);
    const jsonLength = view.getUint32(12, true);
    const binAt = 20 + jsonLength;
    const short = glb.slice(0, binAt + 8 + 4);
    new DataView(short.buffer).setUint32(8, short.byteLength, true);
    new DataView(short.buffer).setUint32(binAt, 4, true);
    expect(gltfFailure(short)).toMatchObject({ code: 'MISSING_BUFFER', path: '$.buffers[0]' });
  });
});
