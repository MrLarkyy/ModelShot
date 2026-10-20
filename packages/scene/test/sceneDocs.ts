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

/**
 * The player rig of `createPlayerModel` (classic arms) without meshes: bones with Minecraft's pivots, the hands as
 * anchors at the end of the arms. Built here because scene must not depend on formats.
 */
export function playerRig(): SceneDocument {
  const bone = (name: string, parent: number, pivot: Vec3, children: number[] = []): SceneNode =>
    testNode(parent, { name, pivot, children });
  return testDoc(
    [
      bone('head', -1, [0, 24, 0]),
      bone('body', -1, [0, 24, 0]),
      bone('right_arm', -1, [5, 22, 0], [6]),
      bone('left_arm', -1, [-5, 22, 0], [7]),
      bone('right_leg', -1, [1.9, 12, 0]),
      bone('left_leg', -1, [-1.9, 12, 0]),
      bone('right_hand', 2, [6, 12, 0]),
      bone('left_hand', 3, [-6, 12, 0]),
    ],
    [],
  );
}
