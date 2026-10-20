import type { SceneDocument, SceneMesh, SceneTexture } from '@modelshot/scene';

/** One quad (two triangles) on node 0, material 0 with texture 0. */
export function quadScene(): SceneDocument {
  const mesh: SceneMesh = {
    name: 'quad',
    sourceId: '',
    node: 0,
    visible: true,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    uvRects: new Float32Array(Array.from({ length: 4 }, () => [0, 0, 1, 1]).flat()),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    groups: [{ material: 0, start: 0, count: 6 }],
  };
  return {
    formatVersion: 1,
    source: { format: 'bbmodel', formatVersion: '4.5', modelFormat: 'free' },
    nodes: [
      {
        name: 'root',
        sourceId: '',
        parent: -1,
        children: [],
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        translation: [0, 0, 0],
        visible: true,
        meshes: [0],
      },
    ],
    meshes: [mesh],
    materials: [{ name: 'm', texture: 0 }],
    textures: [testTexture()],
    rootNodes: [0],
  };
}

export function testTexture(overrides: Partial<SceneTexture> = {}): SceneTexture {
  return {
    name: 't.png',
    mimeType: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71]),
    width: 16,
    height: 16,
    uvWidth: 16,
    uvHeight: 16,
    missing: false,
    ...overrides,
  };
}
