import { describe, expect, it } from 'vitest';
import { DEFAULT_GLTF_LIMITS, loadGltf, type GltfErrorCode, type GltfLimits } from '../../src/index';
import { expectGltfError, json } from './expectGltfError';
import { base64, gltfDoc, TRIANGLE, type Json } from './gltfBuilder';
import { expectCpuBelow } from '../support/expectCpuBelow';

const many = <T>(count: number, make: (i: number) => T): T[] => Array.from({ length: count }, (_, i) => make(i));

interface LimitCase {
  readonly limit: keyof GltfLimits;
  readonly n: number;
  readonly doc: (count: number) => Json;
  readonly code: GltfErrorCode;
  readonly path: string;
}

const CASES: readonly LimitCase[] = [
  {
    limit: 'maxNodes',
    n: 4,
    doc: (c) => gltfDoc({ nodes: many(c, () => ({})) }),
    code: 'TOO_MANY_NODES',
    path: '$.nodes',
  },
  {
    limit: 'maxMeshes',
    n: 3,
    doc: (c) => gltfDoc({ meshes: many(c, () => [TRIANGLE]) }),
    code: 'TOO_MANY_MESHES',
    path: '$.meshes',
  },
  {
    limit: 'maxPrimitives',
    n: 3,
    doc: (c) => gltfDoc({ meshes: [many(c, () => TRIANGLE)] }),
    code: 'TOO_MANY_PRIMITIVES',
    path: '$.meshes[0].primitives',
  },
  {
    limit: 'maxPrimitives',
    n: 4,
    doc: (c) => gltfDoc({ meshes: [many(2, () => TRIANGLE), many(c - 2, () => TRIANGLE)] }),
    code: 'TOO_MANY_PRIMITIVES',
    path: '$.meshes[1]',
  },
  {
    limit: 'maxAccessors',
    n: 6,
    doc: (c) => gltfDoc({ meshes: many(c / 3, () => [TRIANGLE]) }),
    code: 'TOO_MANY_ACCESSORS',
    path: '$.accessors',
  },
  {
    limit: 'maxBuffers',
    n: 2,
    doc: (c) => {
      const doc = gltfDoc();
      const buffer = (doc.buffers as Json[])[0]!;
      doc.buffers = many(c, () => buffer);
      return doc;
    },
    code: 'TOO_MANY_BUFFERS',
    path: '$.buffers',
  },
  {
    limit: 'maxMaterials',
    n: 3,
    doc: (c) => gltfDoc({ materials: many(c, () => ({})) }),
    code: 'TOO_MANY_MATERIALS',
    path: '$.materials',
  },
  {
    limit: 'maxTextures',
    n: 2,
    doc: (c) => gltfDoc({ textures: many(c, () => ({})) }),
    code: 'TOO_MANY_TEXTURES',
    path: '$.textures',
  },
  {
    limit: 'maxTextures',
    n: 2,
    doc: (c) => gltfDoc({ images: many(c, () => ({})) }),
    code: 'TOO_MANY_TEXTURES',
    path: '$.images',
  },
  {
    limit: 'maxTextures',
    n: 2,
    doc: (c) => gltfDoc({ samplers: many(c, () => ({})) }),
    code: 'TOO_MANY_TEXTURES',
    path: '$.samplers',
  },
  {
    limit: 'maxTriangles',
    n: 3,
    doc: (c) => gltfDoc({ nodes: many(c, () => ({ mesh: 0 })) }),
    code: 'TOO_MANY_TRIANGLES',
    path: '$.nodes[3]',
  },
  {
    limit: 'maxVertices',
    n: 9,
    doc: (c) => gltfDoc({ nodes: many(c / 3, () => ({ mesh: 0 })) }),
    code: 'TOO_MANY_VERTICES',
    path: '$.nodes[3]',
  },
  {
    limit: 'maxNesting',
    n: 5,
    doc: (c) =>
      gltfDoc({ nodes: many(c, (i) => (i + 1 < c ? { children: [i + 1] } : { mesh: 0 })), scenes: [{ nodes: [0] }] }),
    code: 'NESTING_TOO_DEEP',
    path: '$.nodes[5]',
  },
];

describe('glTF limits: N loads, N + 1 fails before allocation', () => {
  it.each(CASES.map((c) => [`${c.limit} ${c.path}`, c] as const))('%s', (_, c) => {
    const limits = { [c.limit]: c.n };
    expect(() => loadGltf(json(c.doc(c.n)), { limits })).not.toThrow();
    const bigger = c.limit === 'maxAccessors' || c.limit === 'maxVertices' ? c.n + 3 : c.n + 1;
    expectGltfError(json(c.doc(bigger)), c.code, c.path, { limits });
  });

  it('checks the file size before parsing', () => {
    const text = json(gltfDoc());
    const size = new TextEncoder().encode(text).byteLength;
    expect(() => loadGltf(text, { limits: { maxFileBytes: size } })).not.toThrow();
    expectGltfError(text, 'FILE_TOO_LARGE', '$', { limits: { maxFileBytes: size - 1 } });
    expectGltfError(new TextEncoder().encode(text), 'FILE_TOO_LARGE', '$', { limits: { maxFileBytes: size - 1 } });
    expectGltfError('{'.repeat(2000), 'FILE_TOO_LARGE', '$', { limits: { maxFileBytes: 1999 } });
  });

  it('bounds data URIs and strings', () => {
    const doc = gltfDoc();
    const uri = (doc.buffers as { uri: string }[])[0]!.uri;
    expect(() => loadGltf(json(doc), { limits: { maxDataUriChars: uri.length } })).not.toThrow();
    expectGltfError(json(doc), 'INVALID_FIELD', '$.buffers[0].uri', { limits: { maxDataUriChars: uri.length - 1 } });
    const named = gltfDoc({ nodes: [{ mesh: 0, name: 'n'.repeat(9) }] });
    expect(() => loadGltf(json(named), { limits: { maxStringChars: 9 } })).not.toThrow();
    expectGltfError(json(named), 'INVALID_FIELD', '$.nodes[0].name', { limits: { maxStringChars: 8 } });
  });

  it('rejects invalid limit overrides with a RangeError', () => {
    for (const value of [0, -1, 1.5, NaN, '3']) {
      expect(() => loadGltf(json(gltfDoc()), { limits: { maxNodes: value as number } }), String(value)).toThrow(
        RangeError,
      );
    }
    expect(() => loadGltf(json(gltfDoc()), { limits: { maxNodes: Infinity } })).not.toThrow();
  });

  it('a model at the default triangle and vertex limits loads within 5 s of CPU', () => {
    const quads = DEFAULT_GLTF_LIMITS.maxTriangles / 2;
    const positions = new Float32Array(quads * 12);
    const normals = new Float32Array(quads * 12);
    const indices = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const x = q % 400;
      const z = Math.floor(q / 400);
      positions.set([x, 0, z, x, 0, z + 1, x + 1, 0, z + 1, x + 1, 0, z], q * 12);
      normals.set([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], q * 12);
      indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    }
    const bytes = new Uint8Array(positions.byteLength * 2 + indices.byteLength);
    bytes.set(new Uint8Array(positions.buffer), 0);
    bytes.set(new Uint8Array(normals.buffer), positions.byteLength);
    bytes.set(new Uint8Array(indices.buffer), positions.byteLength * 2);
    const vertices = quads * 4;
    const doc = {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: vertices, type: 'VEC3' },
        { bufferView: 1, componentType: 5126, count: vertices, type: 'VEC3' },
        { bufferView: 2, componentType: 5125, count: quads * 6, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteLength: positions.byteLength },
        { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength },
        { buffer: 0, byteOffset: positions.byteLength * 2, byteLength: indices.byteLength },
      ],
      buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${base64(bytes)}` }],
    };
    const text = json(doc);
    const { scene } = expectCpuBelow(5000, () => loadGltf(text));
    expect(scene.meshes[0]!.indices).toHaveLength(DEFAULT_GLTF_LIMITS.maxTriangles * 3);
    expect(scene.meshes[0]!.positions).toHaveLength(DEFAULT_GLTF_LIMITS.maxVertices * 3);
  });
});
