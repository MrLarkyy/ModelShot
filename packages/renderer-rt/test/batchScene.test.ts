import type { SceneDocument, SceneMesh } from '@modelshot/scene';
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
});
