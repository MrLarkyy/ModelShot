import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import { cutoutEdgePoint } from './cutoutEdge';
import { encodeRgbaPng } from './encodeRgbaPng';

/** Texels per side of the partial-edge texture; one texel is one unit on the quad (the cutout-edge quad's layout). */
export const PARTIAL_EDGE_TEXELS = 8;
/** Alpha byte of the partial texels. */
export const PARTIAL_EDGE_ALPHA = 128;
/** First texel row of the strip whose checker pairs partial texels with opaque ones instead of cut-out ones. */
export const PARTIAL_EDGE_STRIP_ROW = 5;

export type PartialEdgeTexel = 'partial' | 'invisible' | 'opaque';

/**
 * Texel (column, row), v down from the top: a one-texel ring of partial texels around a checker whose even cells are
 * partial and whose odd cells are cut out (alpha 0) in rows 1-4 and opaque in rows 5-6 (`PARTIAL_EDGE_STRIP_ROW`).
 * `under`: the opaque texels partial too, the view an opaque texel covers (the opaque|partial seam's reference).
 */
export function partialEdgeTexel(column: number, row: number, under = false): PartialEdgeTexel {
  const last = PARTIAL_EDGE_TEXELS - 1;
  if (column === 0 || row === 0 || column === last || row === last) return 'partial';
  if ((column + row) % 2 === 0) return 'partial';
  if (row < PARTIAL_EDGE_STRIP_ROW) return 'invisible';
  return under ? 'partial' : 'opaque';
}

function texture(under: boolean): SceneDocument['textures'][number] {
  const n = PARTIAL_EDGE_TEXELS;
  const rgba = new Uint8Array(n * n * 4);
  const alpha: Readonly<Record<PartialEdgeTexel, number>> = { partial: PARTIAL_EDGE_ALPHA, invisible: 0, opaque: 255 };
  for (let i = 0; i < n * n; i++) {
    const kind = partialEdgeTexel(i % n, Math.floor(i / n), under);
    rgba.set([255, 255, 255, alpha[kind]], i * 4);
  }
  return {
    name: 'partial-edge.png',
    mimeType: 'image/png',
    bytes: encodeRgbaPng(n, n, rgba),
    width: n,
    height: n,
    uvWidth: n,
    uvHeight: n,
    missing: false,
  };
}

function quad(name: string, offset: readonly [number, number, number]): SceneMesh {
  const n = PARTIAL_EDGE_TEXELS;
  const corners = [cutoutEdgePoint(0, 0), cutoutEdgePoint(n, 0), cutoutEdgePoint(n, n), cutoutEdgePoint(0, n)];
  return {
    name,
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(corners.flatMap((p) => p.map((v, i) => v + (offset[i] ?? 0)))),
    normals: new Float32Array(Array.from({ length: 4 }, () => [0, 0, 1]).flat()),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvRects: new Float32Array(Array.from({ length: 4 }, () => [0, 0, 1, 1]).flat()),
    // Counter-clockwise seen from +z.
    indices: new Uint32Array([0, 3, 2, 0, 2, 1]),
    groups: [{ material: 0, start: 0, count: 6, doubleSided: true }],
  };
}

/**
 * The partial-alpha seam test (MS-60): the cutout-edge quad (8 x 8 units at z = 0 facing +z, double-sided) with alpha
 * mode BLEND and a texture of white texels (`partialEdgeTexel`): partial|invisible seams in the checker, opaque|partial
 * seams in the strip, and a face outline of partial texels only. `pair` adds a second quad, shifted right, down and
 * towards the camera, overlapping the first (order independence). The texture is generated here (no file, nothing to
 * license).
 */
export function partialEdge(base: SceneDocument, options: { under?: boolean; pair?: boolean } = {}): SceneDocument {
  const meshes = [quad('edge', [0, 0, 0])];
  if (options.pair) meshes.push(quad('edge-front', [2.5, -1.5, 1]));
  return {
    ...base,
    nodes: [],
    rootNodes: [],
    meshes,
    materials: [{ name: 'edge', texture: 0, alphaMode: 'blend', alphaCutoff: 0.01 }],
    textures: [texture(options.under ?? false)],
  };
}
