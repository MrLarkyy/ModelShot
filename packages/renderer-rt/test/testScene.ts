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

/** The first 24 bytes of a PNG: signature and an IHDR chunk header declaring `width` x `height`. */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A texture whose bytes carry a PNG header matching its declared size, unless `bytes` is overridden. */
export function testTexture(overrides: Partial<SceneTexture> = {}): SceneTexture {
  const texture: SceneTexture = {
    name: 't.png',
    mimeType: 'image/png',
    bytes: null,
    width: 16,
    height: 16,
    uvWidth: 16,
    uvHeight: 16,
    missing: false,
    ...overrides,
  };
  return 'bytes' in overrides ? texture : { ...texture, bytes: pngHeader(texture.width, texture.height) };
}
