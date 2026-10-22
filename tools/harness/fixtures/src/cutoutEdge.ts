import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import { encodeRgbaPng } from './encodeRgbaPng';

/** Texels per side of the cutout-edge texture; one texel is one unit on the quad. */
export const CUTOUT_EDGE_TEXELS = 8;
/** The opaque texels' colour: far from every look's backdrop in each channel's direction. */
export const CUTOUT_EDGE_COLOR: readonly [number, number, number] = [255, 255, 255];

/** Whether texel (column, row) of the texture is opaque: the one-texel ring and the inner checker's even cells. */
export function cutoutEdgeOpaque(column: number, row: number): boolean {
  const last = CUTOUT_EDGE_TEXELS - 1;
  if (column === 0 || row === 0 || column === last || row === last) return true;
  return (column + row) % 2 === 0;
}

/** World point of texture position (u, v) in texels, u right, v down from the top-left corner. */
export function cutoutEdgePoint(u: number, v: number): [number, number, number] {
  const half = CUTOUT_EDGE_TEXELS / 2;
  return [u - half, half - v, 0];
}

/**
 * The anti-aliased cutout seam test (MS-30): one double-sided 8 x 8 unit quad at z = 0 facing +z, alpha mode MASK,
 * with an opaque one-texel ring around a checker of opaque and alpha-0 texels. The ring keeps the quad's geometric
 * outline away from the seams, so every edge inside it is a cutout seam. The texture is generated here (no file,
 * nothing to license).
 */
export function cutoutEdge(base: SceneDocument): SceneDocument {
  const n = CUTOUT_EDGE_TEXELS;
  const rgba = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    if (cutoutEdgeOpaque(i % n, Math.floor(i / n))) rgba.set([...CUTOUT_EDGE_COLOR, 255], i * 4);
  }
  const corners = [cutoutEdgePoint(0, 0), cutoutEdgePoint(n, 0), cutoutEdgePoint(n, n), cutoutEdgePoint(0, n)];
  const quad: SceneMesh = {
    name: 'edge',
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(corners.flat()),
    normals: new Float32Array(Array.from({ length: 4 }, () => [0, 0, 1]).flat()),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvRects: new Float32Array(Array.from({ length: 4 }, () => [0, 0, 1, 1]).flat()),
    // Counter-clockwise seen from +z.
    indices: new Uint32Array([0, 3, 2, 0, 2, 1]),
    groups: [{ material: 0, start: 0, count: 6, doubleSided: true }],
  };
  return {
    ...base,
    nodes: [],
    rootNodes: [],
    meshes: [quad],
    materials: [{ name: 'edge', texture: 0, alphaMode: 'mask', alphaCutoff: 0.5 }],
    textures: [
      {
        name: 'cutout-edge.png',
        mimeType: 'image/png',
        bytes: encodeRgbaPng(n, n, rgba),
        width: n,
        height: n,
        uvWidth: n,
        uvHeight: n,
        missing: false,
      },
    ],
  };
}
