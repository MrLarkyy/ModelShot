import type { SceneDocument, SceneMesh, SceneNode, Vec3 } from '../src/index';

export function testNode(parent: number, overrides: Partial<SceneNode> = {}): SceneNode {
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

export function testMesh(node: number, points: readonly Vec3[], overrides: Partial<SceneMesh> = {}): SceneMesh {
  const n = points.length;
  return {
    name: 'm',
    sourceId: '',
    node,
    visible: true,
    positions: new Float32Array(points.flat()),
    normals: new Float32Array(n * 3),
    uvs: new Float32Array(n * 2),
    uvRects: new Float32Array(n * 4),
    indices: new Uint32Array(0),
    groups: [],
    ...overrides,
  };
}

export function testDoc(nodes: readonly SceneNode[], meshes: readonly SceneMesh[]): SceneDocument {
  return {
    formatVersion: 1,
    source: { format: 'bbmodel', formatVersion: '4.5', modelFormat: 'free' },
    nodes,
    meshes,
    materials: [],
    textures: [],
    rootNodes: nodes.flatMap((node, index) => (node.parent < 0 ? [index] : [])),
  };
}
