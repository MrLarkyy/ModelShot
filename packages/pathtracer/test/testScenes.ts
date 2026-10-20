import type { SceneDocument, SceneMesh, SceneNode } from '@modelshot/scene';

export function node(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    name: 'n',
    sourceId: '',
    parent: -1,
    children: [],
    pivot: [0, 0, 0],
    rotation: [0, 0, 0],
    translation: [0, 0, 0],
    visible: true,
    meshes: [],
    ...overrides,
  };
}

/** A mesh of independent triangles: 9 position values each, normal +z, UVs (0,0) (1,0) (0,1), rect [0, 0, 1, 1]. */
export function triangleMesh(positions: readonly number[], overrides: Partial<SceneMesh> = {}): SceneMesh {
  const vertices = positions.length / 3;
  return {
    name: 'tris',
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(positions),
    normals: new Float32Array(Array.from({ length: vertices }, () => [0, 0, 1]).flat()),
    uvs: new Float32Array(Array.from({ length: vertices / 3 }, () => [0, 0, 1, 0, 0, 1]).flat()),
    uvRects: new Float32Array(Array.from({ length: vertices }, () => [0, 0, 1, 1]).flat()),
    indices: Uint32Array.from({ length: vertices }, (_, i) => i),
    groups: [{ material: 0, start: 0, count: vertices }],
    ...overrides,
  };
}

export function sceneOf(meshes: SceneMesh[], nodes: SceneNode[] = []): SceneDocument {
  return {
    formatVersion: 1,
    source: { format: 'bbmodel', formatVersion: '4.10', modelFormat: 'free' },
    nodes,
    meshes,
    materials: [{ name: 'm', texture: -1 }],
    textures: [],
    rootNodes: nodes.map((_, i) => i),
  };
}

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32) for generated test meshes. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` small random triangles in a 100-unit cube. */
export function randomTriangles(count: number, seed: number): number[] {
  const random = seededRandom(seed);
  const out: number[] = [];
  for (let t = 0; t < count; t++) {
    const c = [random() * 100, random() * 100, random() * 100];
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) out.push((c[k] ?? 0) + random() * 2 - 1);
  }
  return out;
}
