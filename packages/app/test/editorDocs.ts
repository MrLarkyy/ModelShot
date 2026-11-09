import type { SceneAnimation, SceneDocument, SceneMesh, SceneNode, Vec3 } from '@modelshot/scene';

export function node(parent: number, overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    name: 'n',
    sourceId: '',
    parent,
    children: [],
    pivot: [0, 0, 0],
    rotation: [0, 0, 0],
    translation: [0, 0, 0],
    visible: true,
    meshes: [],
    ...overrides,
  };
}

/** A box mesh around `centre`, `half` wide each way, owned by `owner`. */
export function boxMesh(
  owner: number,
  centre: Vec3 = [0, 0, 0],
  half = 1,
  overrides: Partial<SceneMesh> = {},
): SceneMesh {
  const corners: number[] = [];
  for (let i = 0; i < 8; i++) {
    corners.push(
      centre[0] + (i & 1 ? half : -half),
      centre[1] + (i & 2 ? half : -half),
      centre[2] + (i & 4 ? half : -half),
    );
  }
  return {
    name: 'box',
    sourceId: '',
    node: owner,
    visible: true,
    positions: new Float32Array(corners),
    normals: new Float32Array(24),
    uvs: new Float32Array(16),
    uvRects: new Float32Array(32),
    indices: new Uint32Array([0, 1, 3, 0, 3, 2]),
    groups: [],
    ...overrides,
  };
}

export function doc(
  nodes: readonly SceneNode[],
  meshes: readonly SceneMesh[],
  animations?: readonly SceneAnimation[],
): SceneDocument {
  return {
    formatVersion: 1,
    source: { format: 'bbmodel', formatVersion: '4.5', modelFormat: 'free' },
    nodes,
    meshes,
    materials: [],
    textures: [],
    rootNodes: nodes.flatMap((n, i) => (n.parent < 0 ? [i] : [])),
    ...(animations ? { animations } : {}),
  };
}
