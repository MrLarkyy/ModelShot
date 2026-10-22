import { NO_EDGE, type SceneDocument, type SceneMesh, type SharpEdgeAttributes } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { batchScene } from '../src/batchScene';
import { quadScene } from './testScene';

function quad(node: number, x: number, overrides: Partial<SceneMesh> = {}): SceneMesh {
  const base = quadScene().meshes[0]!;
  const positions = base.positions.map((v, i) => (i % 3 === 0 ? v + x : v));
  return { ...base, node, positions, ...overrides };
}

function doc(meshes: SceneMesh[], overrides: Partial<SceneDocument> = {}): SceneDocument {
  const scene = quadScene();
  const node = scene.nodes[0]!;
  return {
    ...scene,
    nodes: [node, { ...node, name: 'second', meshes: [] }, { ...node, name: 'hidden', visible: false, meshes: [] }],
    rootNodes: [0, 1, 2],
    materials: [
      { name: 'a', texture: 0 },
      { name: 'b', texture: 1 },
    ],
    textures: [scene.textures[0]!, scene.textures[0]!],
    meshes,
    ...overrides,
  };
}

describe('batchScene', () => {
  it('merges meshes of one node and texture into one batch with offset indices', () => {
    const batches = batchScene(doc([quad(0, 0), quad(0, 10), quad(0, 20)]));
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    expect(batch?.node).toBe(0);
    expect(batch?.texture).toBe(0);
    expect(batch?.positions.length).toBe(36);
    expect([...(batch?.indices ?? [])]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
    expect(batch?.positions[12]).toBe(10);
    expect([...(batch?.uvRects.subarray(0, 4) ?? [])]).toEqual([0, 0, 1, 1]);
  });

  it('splits by node and by texture, in order of first appearance', () => {
    const twoGroups = quad(0, 0, {
      groups: [
        { material: 0, start: 0, count: 3 },
        { material: 1, start: 3, count: 3 },
      ],
    });
    const batches = batchScene(
      doc([quad(1, 5), twoGroups, quad(-1, 0, { groups: [{ material: -1, start: 0, count: 6 }] })]),
    );
    expect(batches.map((b) => [b.node, b.texture, b.indices.length])).toEqual([
      [1, 0, 6],
      [0, 0, 3],
      [0, 1, 3],
      [-1, -1, 6],
    ]);
    expect([...(batches[2]?.indices ?? [])]).toEqual([0, 2, 3]);
  });

  it('leaves out hidden meshes, hidden nodes and empty groups', () => {
    const batches = batchScene(
      doc([quad(0, 0, { visible: false }), quad(2, 0), quad(1, 0, { groups: [{ material: 0, start: 0, count: 0 }] })]),
    );
    expect(batches).toEqual([]);
  });

  it('splits by alpha rule, sidedness and render order; an all-default scene keeps one batch', () => {
    const single = [{ material: 0, start: 0, count: 6 }];
    const double = [{ material: 0, start: 0, count: 6, doubleSided: true }];
    const scene = doc(
      [
        quad(0, 0),
        quad(0, 10, { groups: double }),
        quad(0, 20, { renderOrder: 1 }),
        quad(0, 30, { groups: [{ material: 1, start: 0, count: 6 }] }),
        quad(0, 40, { groups: single }),
      ],
      {
        materials: [
          { name: 'a', texture: 0 },
          { name: 'b', texture: 0, alphaMode: 'blend', alphaCutoff: 0.01 },
        ],
      },
    );
    const batches = batchScene(scene);
    expect(
      batches.map((b) => [b.alpha.modeId, b.alpha.cutoffByte, b.doubleSided, b.renderOrder, b.indices.length]),
    ).toEqual([
      [0, 128, false, 0, 12],
      [0, 128, true, 0, 6],
      [0, 128, false, 1, 6],
      [2, 3, false, 0, 6],
    ]);
    const untextured = batchScene(doc([quad(0, 0, { groups: [{ material: -1, start: 0, count: 6 }] })]));
    expect(untextured[0]?.alpha).toEqual({ modeId: 0, cutoffByte: 0 });
  });

  it('splits vertices as the sharp-edge attributes say, carrying every attribute along', () => {
    const a = quad(0, 0);
    const b = quad(0, 10);
    const lightmapA = Float32Array.from({ length: 16 }, (_, i) => 100 + i);
    // Vertex 0 of quad a is used twice (by both triangles); its second use becomes a split copy, output vertex 4.
    const edges: SharpEdgeAttributes = {
      vertexOf: new Uint32Array([0, 1, 2, 3, 0]),
      indices: new Uint32Array([0, 1, 2, 4, 2, 3]),
      distances: Float32Array.from({ length: 20 }, (_, i) => i),
      angles: Float32Array.from({ length: 20 }, (_, i) => -i),
      edgeCount: 1,
    };
    const [batch] = batchScene(doc([a, b]), [], [lightmapA, null], [edges, null]);
    expect(batch?.positions.length).toBe(9 * 3);
    expect([...(batch?.indices ?? [])]).toEqual([0, 1, 2, 4, 2, 3, 5, 6, 7, 5, 7, 8]);
    expect([...(batch?.positions.subarray(12, 15) ?? [])]).toEqual([...a.positions.subarray(0, 3)]);
    expect([...(batch?.normals.subarray(12, 15) ?? [])]).toEqual([...a.normals.subarray(0, 3)]);
    expect([...(batch?.uvs.subarray(8, 10) ?? [])]).toEqual([...a.uvs.subarray(0, 2)]);
    expect([...(batch?.uvRects.subarray(16, 20) ?? [])]).toEqual([...a.uvRects.subarray(0, 4)]);
    expect([...(batch?.lightmap.subarray(16, 20) ?? [])]).toEqual([100, 101, 102, 103]);
    expect([...(batch?.edgeDistances.subarray(0, 20) ?? [])]).toEqual([...edges.distances]);
    expect([...(batch?.edgeAngles.subarray(0, 20) ?? [])]).toEqual([...edges.angles]);
    // The mesh without attributes: empty slots, its own vertices.
    expect([...(batch?.edgeDistances.subarray(20) ?? [])]).toEqual(new Array(16).fill(NO_EDGE));
    expect([...(batch?.edgeAngles.subarray(20) ?? [])]).toEqual(new Array(16).fill(0));
    expect(batch?.positions[5 * 3]).toBe(10);
    expect(batch?.lightmap[5 * 4 + 2]).toBe(-1);
  });

  it('draws a world-charted mesh de-indexed per corner, through its edge split, and leaves other meshes as they were', () => {
    const a = quad(0, 0);
    const b = quad(0, 10);
    const lightmapB = Float32Array.from({ length: 16 }, (_, i) => 200 + i);
    // Per index of quad a: lightmap (x, y, -2, back) and chart (x, y, w, h).
    const corners = Float32Array.from({ length: 6 * 8 }, (_, i) => (i % 8 === 2 ? -2 : 1000 + i));
    const edges: SharpEdgeAttributes = {
      vertexOf: new Uint32Array([0, 1, 2, 3, 0]),
      indices: new Uint32Array([0, 1, 2, 4, 2, 3]),
      distances: Float32Array.from({ length: 20 }, (_, i) => i),
      angles: Float32Array.from({ length: 20 }, (_, i) => -i),
      edgeCount: 1,
    };
    const [batch] = batchScene(doc([a, b]), [], [new Float32Array(16), lightmapB], [edges, null], [corners, null]);
    // 6 corner vertices of a, then b's 4 vertices as before.
    expect(batch?.positions.length).toBe(10 * 3);
    expect([...(batch?.indices ?? [])]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 6, 8, 9]);
    a.indices.forEach((v, i) => {
      expect([...(batch?.positions.subarray(i * 3, i * 3 + 3) ?? [])]).toEqual([
        ...a.positions.subarray(v * 3, v * 3 + 3),
      ]);
      expect([...(batch?.uvs.subarray(i * 2, i * 2 + 2) ?? [])]).toEqual([...a.uvs.subarray(v * 2, v * 2 + 2)]);
      expect([...(batch?.lightmap.subarray(i * 4, i * 4 + 4) ?? [])]).toEqual([...corners.subarray(i * 8, i * 8 + 4)]);
      expect([...(batch?.lightmapChart?.subarray(i * 4, i * 4 + 4) ?? [])]).toEqual([
        ...corners.subarray(i * 8 + 4, i * 8 + 8),
      ]);
      // Edge rounding: index 3 is split vertex 4, its own distances.
      const split = edges.indices[i] ?? 0;
      expect([...(batch?.edgeDistances.subarray(i * 4, i * 4 + 4) ?? [])]).toEqual([
        ...edges.distances.subarray(split * 4, split * 4 + 4),
      ]);
      expect([...(batch?.edgeAngles.subarray(i * 4, i * 4 + 4) ?? [])]).toEqual([
        ...edges.angles.subarray(split * 4, split * 4 + 4),
      ]);
    });
    expect([...(batch?.edgeDistances.subarray(3 * 4, 4 * 4) ?? [])]).toEqual([16, 17, 18, 19]);
    // Quad b: its vertex data, no chart.
    expect([...(batch?.lightmap.subarray(6 * 4) ?? [])]).toEqual([...lightmapB]);
    expect([...(batch?.lightmapChart?.subarray(6 * 4) ?? [])]).toEqual(new Array(16).fill(0));
    const plain = batchScene(doc([quad(0, 10)]), [], [lightmapB]);
    // No world-charted mesh: no chart attribute at all (left disabled at upload).
    expect(plain[0]?.lightmapChart).toBeNull();
    expect([...(plain[0]?.positions ?? [])]).toEqual([...(batch?.positions.subarray(6 * 3) ?? [])]);
  });
});
