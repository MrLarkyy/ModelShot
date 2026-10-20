import { ALPHA_MODE_ID, alphaCutoffByte } from '@modelshot/looks';
import { resolveMaterialAlpha, type SceneDocument } from '@modelshot/scene';
import { NODE_FLOATS, type Bvh } from './buildBvh';
import type { FlatScene } from './flattenScene';
import { PathTracerError } from './PathTracerError';
import type { TexturePlacement } from './textureLayers';

/** Texels per row of every RGBA32F data texture; WebGL2 guarantees MAX_TEXTURE_SIZE ≥ 2048. */
export const DATA_TEXTURE_WIDTH = 2048;
export const NODE_TEXELS = 2;
export const TRIANGLE_POSITION_TEXELS = 3;
export const TRIANGLE_ATTRIBUTE_TEXELS = 5;
export const MATERIAL_TEXELS = 3;

/** RGBA32F texels, `DATA_TEXTURE_WIDTH` per row, padded to whole rows. */
export interface DataTexture {
  readonly rows: number;
  readonly data: Float32Array;
}

/**
 * The geometry as the trace shader reads it (sceneData.glsl), triangles in BVH leaf order. Nodes: 2 texels each, the
 * `Bvh` layout. Triangle positions: 3 texels, corner k in xyz; w holds the material slot (texel 0), 1 for double-sided
 * (texel 1) and the render order (texel 2). Attributes: 5 texels, normals in xyz of texels 0-2 with the UVs in their w
 * and texel 3 (u0, v0, u1 | v1, u2, v2), the face's UV rectangle in texel 4.
 */
export interface PackedGeometry {
  readonly nodeCount: number;
  readonly triangleCount: number;
  readonly nodes: DataTexture;
  readonly triPositions: DataTexture;
  readonly triAttributes: DataTexture;
  /** Largest render order of any triangle (0 without any): bounds how far behind a better key a node can win. */
  readonly maxRenderOrder: number;
}

function rowsFor(texels: number, maxTextureSize: number, what: string): number {
  const rows = Math.max(1, Math.ceil(texels / DATA_TEXTURE_WIDTH));
  if (rows > maxTextureSize) {
    throw new PathTracerError(
      'SCENE_TOO_LARGE',
      `${what} need ${rows} rows of ${DATA_TEXTURE_WIDTH} texels; this GPU allows ${maxTextureSize}`,
    );
  }
  return rows;
}

function dataTexture(rows: number): DataTexture {
  return { rows, data: new Float32Array(rows * DATA_TEXTURE_WIDTH * 4) };
}

/** Packs `flat` in the order of `bvh`. Rows over `maxTextureSize` throw `SCENE_TOO_LARGE` before allocating. */
export function packGeometry(flat: FlatScene, bvh: Bvh, maxTextureSize: number): PackedGeometry {
  const count = flat.count;
  // Every limit before any allocation.
  const nodeRows = rowsFor(bvh.nodeCount * NODE_TEXELS, maxTextureSize, 'BVH nodes');
  const positionRows = rowsFor(count * TRIANGLE_POSITION_TEXELS, maxTextureSize, 'triangle positions');
  const attributeRows = rowsFor(count * TRIANGLE_ATTRIBUTE_TEXELS, maxTextureSize, 'triangle attributes');
  const nodes = dataTexture(nodeRows);
  nodes.data.set(bvh.nodes.subarray(0, bvh.nodeCount * NODE_FLOATS));
  const triPositions = dataTexture(positionRows);
  const triAttributes = dataTexture(attributeRows);
  const p = triPositions.data;
  const a = triAttributes.data;
  let maxRenderOrder = count > 0 ? -Infinity : 0;
  for (let i = 0; i < count; i++) {
    const t = bvh.order[i] ?? 0;
    const pos = i * TRIANGLE_POSITION_TEXELS * 4;
    for (let c = 0; c < 3; c++) {
      p.set(flat.positions.subarray(t * 9 + c * 3, t * 9 + c * 3 + 3), pos + c * 4);
    }
    const order = flat.renderOrders[t] ?? 0;
    p[pos + 3] = (flat.materials[t] ?? -1) + 1;
    p[pos + 7] = flat.doubleSided[t] ?? 0;
    p[pos + 11] = order;
    maxRenderOrder = Math.max(maxRenderOrder, order);

    const att = i * TRIANGLE_ATTRIBUTE_TEXELS * 4;
    const uv = flat.uvs.subarray(t * 6, t * 6 + 6);
    for (let c = 0; c < 3; c++) a.set(flat.normals.subarray(t * 9 + c * 3, t * 9 + c * 3 + 3), att + c * 4);
    a[att + 3] = uv[0] ?? 0;
    a[att + 7] = uv[1] ?? 0;
    a[att + 11] = uv[2] ?? 0;
    a[att + 12] = uv[3] ?? 0;
    a[att + 13] = uv[4] ?? 0;
    a[att + 14] = uv[5] ?? 0;
    a.set(flat.uvRects.subarray(t * 4, t * 4 + 4), att + 16);
  }
  return { nodeCount: bvh.nodeCount, triangleCount: count, nodes, triPositions, triAttributes, maxRenderOrder };
}

/** Where each image the materials read lies in the texture layers (`planTextureLayers`, same order). */
export interface MaterialTextures {
  /** Faces without a material or texture. */
  readonly untextured: TexturePlacement;
  /** Textures that are missing or were rejected. */
  readonly placeholder: TexturePlacement;
  /** Per `SceneDocument.textures` entry: its placement, `null` where the placeholder is drawn. */
  readonly textures: readonly (TexturePlacement | null)[];
}

const nonNegative = (x: number | undefined): number => (x !== undefined && Number.isFinite(x) && x > 0 ? x : 0);

/**
 * The material table: slot 0 for faces without a material, slot m + 1 for `doc.materials[m]`; 3 texels each: (layer,
 * x, y, width), (height, alpha mode id, cutoff byte, 0), (emission rgb, 0). Untextured faces are opaque, as in the
 * preview; a negative or non-finite emission channel counts as 0.
 */
export function packMaterials(
  doc: SceneDocument,
  textures: MaterialTextures,
  emission: readonly (readonly [number, number, number] | undefined)[] = [],
): DataTexture {
  const slots = doc.materials.length + 1;
  // 2048 rows hold 1.4 M materials; every GPU allows them.
  const table = dataTexture(rowsFor(slots * MATERIAL_TEXELS, DATA_TEXTURE_WIDTH, 'materials'));
  const write = (
    slot: number,
    place: TexturePlacement,
    modeId: number,
    cutoffByte: number,
    glow: readonly number[],
  ) => {
    const at = slot * MATERIAL_TEXELS * 4;
    table.data.set([place.layer, place.x, place.y, place.width, place.height, modeId, cutoffByte, 0], at);
    table.data.set([nonNegative(glow[0]), nonNegative(glow[1]), nonNegative(glow[2]), 0], at + 8);
  };
  write(0, textures.untextured, ALPHA_MODE_ID.opaque, 0, []);
  doc.materials.forEach((material, m) => {
    const glow = emission[m] ?? [];
    if (material.texture < 0) {
      write(m + 1, textures.untextured, ALPHA_MODE_ID.opaque, 0, glow);
      return;
    }
    const rule = resolveMaterialAlpha(material);
    const place = textures.textures[material.texture] ?? textures.placeholder;
    write(m + 1, place, ALPHA_MODE_ID[rule.mode], alphaCutoffByte(rule.cutoff), glow);
  });
  return table;
}
