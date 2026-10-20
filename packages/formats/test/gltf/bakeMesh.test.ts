import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bake from '../../src/gltf/bakeMesh';
import * as decode from '../../src/gltf/decodePrimitive';
import { loadGltf, type GltfLoadOptions } from '../../src/index';
import { expectGltfError, json } from './expectGltfError';
import { gltfDoc, TRIANGLE, type DocOptions, type Json } from './gltfBuilder';

vi.mock('../../src/gltf/bakeMesh', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/gltf/bakeMesh')>();
  return { ...original, bakeMesh: vi.fn(original.bakeMesh) };
});
vi.mock('../../src/gltf/decodePrimitive', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/gltf/decodePrimitive')>();
  return { ...original, decodePrimitive: vi.fn(original.decodePrimitive) };
});

afterEach(() => {
  vi.mocked(bake.bakeMesh).mockClear();
  vi.mocked(decode.decodePrimitive).mockClear();
});

function load(options: DocOptions, loadOptions: GltfLoadOptions = { unitScale: 1 }) {
  return loadGltf(json(gltfDoc(options)), loadOptions);
}

function triangleNormal(positions: Float32Array, indices: Uint32Array, t: number): number[] {
  const p = (c: number, k: number) => positions[(indices[t * 3 + c] ?? 0) * 3 + k] ?? 0;
  const e1 = [0, 1, 2].map((k) => p(1, k) - p(0, k));
  const e2 = [0, 1, 2].map((k) => p(2, k) - p(0, k));
  const [a = 0, b = 0, c = 0] = e1;
  const [d = 0, e = 0, f = 0] = e2;
  return [b * f - c * e, c * d - a * f, a * e - b * d];
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, k) => s + x * (b[k] ?? 0), 0);

describe('bakeMesh', () => {
  it('a mirrored node keeps counter-clockwise triangles facing along their outward normals', () => {
    const { scene } = load({ nodes: [{ mesh: 0, scale: [-1, 1, 1] }] });
    const mesh = scene.meshes[0]!;
    expect([...mesh.positions]).toEqual([0, 0, 0, -1, 0, 0, 0, 1, 0]);
    const cross = triangleNormal(mesh.positions, mesh.indices, 0);
    expect(cross[2]).toBeGreaterThan(0);
    expect(dot(cross, [...mesh.normals.slice(0, 3)])).toBeGreaterThan(0);
    expect([...mesh.indices]).toEqual([0, 2, 1]);
  });

  it('a mirrored node without normals gets outward flat normals', () => {
    const { scene } = load({ meshes: [[{ positions: TRIANGLE.positions }]], nodes: [{ mesh: 0, scale: [1, 1, -1] }] });
    const mesh = scene.meshes[0]!;
    expect([...mesh.normals.slice(0, 3)]).toEqual([0, 0, -1]);
    expect(triangleNormal(mesh.positions, mesh.indices, 0)[2]).toBeLessThan(0);
  });

  it('normals go through the inverse transpose under non-uniform scale', () => {
    // A plane x + y = 1 (normal (1, 1, 0)/√2) scaled by (2, 1, 1) has normal (1, 2, 0)/√5.
    const s = Math.SQRT1_2;
    const { scene } = load({
      meshes: [[{ positions: [1, 0, 0, 0, 1, 0, 1, 0, 1], normals: [s, s, 0, s, s, 0, s, s, 0] }]],
      nodes: [{ mesh: 0, scale: [2, 1, 1] }],
    });
    const n = [...scene.meshes[0]!.normals.slice(0, 3)];
    expect(n[0]).toBeCloseTo(1 / Math.sqrt(5), 6);
    expect(n[1]).toBeCloseTo(2 / Math.sqrt(5), 6);
  });

  it('converts strips and fans to lists, in glTF order', () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 2, 0];
    const strip = load({ meshes: [[{ positions, normals: positions.map((_, i) => (i % 3 === 2 ? 1 : 0)), mode: 5 }]] });
    expect([...strip.scene.meshes[0]!.indices]).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    const fan = load({ meshes: [[{ positions, normals: positions.map((_, i) => (i % 3 === 2 ? 1 : 0)), mode: 6 }]] });
    expect([...fan.scene.meshes[0]!.indices]).toEqual([1, 2, 0, 2, 3, 0, 3, 4, 0]);
  });

  it('without NORMAL de-indexes into flat-shaded corners', () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -1];
    const { scene } = load({ meshes: [[{ positions, indices: [0, 1, 2, 0, 3, 1] }]] });
    const mesh = scene.meshes[0]!;
    expect(mesh.positions.length / 3).toBe(6);
    expect([...mesh.indices]).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...mesh.normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 0, 0, -1, 0]);
  });

  it('a zero or non-finite normal takes the face normal', () => {
    const { scene } = load({ meshes: [[{ positions: TRIANGLE.positions, normals: [0, 0, 0, 0, 0, 1, 0, 0, 0] }]] });
    expect([...scene.meshes[0]!.normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it('applies the unit scale, default 16 (1 glTF unit = 1 block)', () => {
    expect([...loadGltf(json(gltfDoc())).scene.meshes[0]!.positions]).toEqual([0, 0, 0, 16, 0, 0, 0, 16, 0]);
    expect([...load({}, { unitScale: 2 }).scene.meshes[0]!.positions]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    for (const unitScale of [0, -1, NaN, Infinity]) {
      expect(() => loadGltf(json(gltfDoc()), { unitScale }), String(unitScale)).toThrow(RangeError);
    }
  });

  it('skips the meshes of a node with a degenerate transform, with a warning', () => {
    const { scene, warnings } = load({ nodes: [{ mesh: 0, scale: [1, 0, 1] }] });
    expect(scene.meshes).toHaveLength(0);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['DEGENERATE_TRANSFORM', '$.nodes[0]']]);
  });

  it('counts every instance against the triangle limit before baking any geometry', () => {
    const nodes = [0, 1, 2].map(() => ({ mesh: 0 }));
    const twoTriangles = {
      ...TRIANGLE,
      positions: [...TRIANGLE.positions, 0, 0, 1],
      normals: [...TRIANGLE.normals!, 0, 0, 1],
      uvs: [...TRIANGLE.uvs!, 0, 0],
      indices: [0, 1, 2, 0, 3, 1],
    };
    const doc = json(gltfDoc({ meshes: [[twoTriangles]], nodes }));
    expect(loadGltf(doc, { limits: { maxTriangles: 6 } }).scene.meshes).toHaveLength(3);
    vi.mocked(bake.bakeMesh).mockClear();
    expectGltfError(doc, 'TOO_MANY_TRIANGLES', '$.nodes[2]', { limits: { maxTriangles: 5 } });
    expect(bake.bakeMesh).not.toHaveBeenCalled();
    expectGltfError(doc, 'TOO_MANY_VERTICES', '$.nodes[2]', { limits: { maxVertices: 11 } });
    expect(bake.bakeMesh).not.toHaveBeenCalled();
  });

  it('rejects a triangle list whose count is no multiple of 3, and a primitive without POSITION', () => {
    expectGltfError(
      json(gltfDoc({ meshes: [[{ ...TRIANGLE, indices: [0, 1, 2, 0] }]] })),
      'INVALID_FIELD',
      '$.accessors[3]',
    );
    const doc = gltfDoc();
    (doc.meshes as { primitives: { attributes: Record<string, unknown> }[] }[])[0]!.primitives[0]!.attributes = {
      NORMAL: 1,
    };
    expectGltfError(json(doc), 'INVALID_FIELD', '$.meshes[0].primitives[0].attributes');
  });
});

describe('instances (review round 2)', () => {
  it('decodes a primitive once however many nodes draw it', () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => ({ mesh: 0, translation: [i, 0, 0] }));
    const { scene } = load({ meshes: [[{ ...TRIANGLE, indices: [0, 1, 2] }]], nodes });
    expect(scene.meshes).toHaveLength(1000);
    expect(decode.decodePrimitive).toHaveBeenCalledTimes(1);
    expect([...scene.meshes[999]!.positions.slice(0, 3)]).toEqual([999, 0, 0]);
  });

  it('counts the vertices an index list addresses, once per primitive, before decoding', () => {
    const huge = (count: number) => {
      const doc = gltfDoc({
        meshes: [[{ positions: TRIANGLE.positions, indices: [0, 1, 2] }]],
        nodes: Array.from({ length: 1000 }, () => ({ mesh: 0 })),
      });
      (doc.accessors as Json[])[0] = { componentType: 5126, count, type: 'VEC3' };
      return json(doc);
    };
    const start = performance.now();
    // 300 000 addressed, 3 drawn per node: decoded once, baked 1000 times.
    expect(loadGltf(huge(300_000)).scene.meshes).toHaveLength(1000);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(decode.decodePrimitive).toHaveBeenCalledTimes(1);
    vi.mocked(decode.decodePrimitive).mockClear();
    expectGltfError(huge(400_001), 'TOO_MANY_VERTICES', '$.nodes[0]');
    expectGltfError(huge(2 ** 31), 'TOO_MANY_VERTICES', '$.nodes[0]');
    expect(decode.decodePrimitive).not.toHaveBeenCalled();
  });

  it('skips a strip or fan without a triangle, with a warning, and no empty mesh or group', () => {
    const { scene, warnings } = load({
      meshes: [
        [
          { positions: [0, 0, 0, 1, 0, 0], mode: 5 },
          { ...TRIANGLE, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0], mode: 6 },
        ],
        [TRIANGLE],
      ],
      nodes: [...Array.from({ length: 3 }, () => ({ mesh: 0 })), { mesh: 1 }],
    });
    expect(scene.meshes.map((m) => [m.node, m.groups.length])).toEqual([[3, 1]]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['EMPTY_PRIMITIVE', '$.meshes[0].primitives[0]'],
      ['EMPTY_PRIMITIVE', '$.meshes[0].primitives[1]'],
    ]);
  });

  it('counts drawn primitives over every instance against maxDrawnPrimitives', () => {
    const doc = json(
      gltfDoc({ meshes: [[TRIANGLE, TRIANGLE, TRIANGLE]], nodes: Array.from({ length: 4 }, () => ({ mesh: 0 })) }),
    );
    expect(loadGltf(doc, { limits: { maxDrawnPrimitives: 12 } }).scene.meshes).toHaveLength(4);
    vi.mocked(bake.bakeMesh).mockClear();
    expectGltfError(doc, 'TOO_MANY_PRIMITIVES', '$.nodes[3]', { limits: { maxDrawnPrimitives: 11 } });
    expect(bake.bakeMesh).not.toHaveBeenCalled();
  });

  it('rejects positions and UVs that overflow float32 once placed or transformed', () => {
    expect(load({ nodes: [{ mesh: 0, scale: [1e35, 1e35, 1e35] }] }).scene.meshes).toHaveLength(1);
    expectGltfError(
      json(gltfDoc({ nodes: [{ mesh: 0, scale: [1e38, 1e38, 1e38] }] })),
      'NON_FINITE_DATA',
      '$.accessors[0]',
      {
        unitScale: 16,
      },
    );
    const transformed = gltfDoc({
      meshes: [[{ ...TRIANGLE, uvs: [0, 0, 10, 0, 0, 10], material: 0 }]],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { scale: [1e38, 1e38] } } },
          },
        },
      ],
      textures: [{ source: 0 }],
      images: [{ uri: 'data:image/png;base64,' }],
    });
    expectGltfError(json(transformed), 'NON_FINITE_DATA', '$.accessors[2]');
  });
});
