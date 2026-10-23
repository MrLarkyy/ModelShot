import { ALPHA_MODE_ID, alphaCutoffByte, textureSamplingFlags } from '@modelshot/looks';
import { resolveMaterialAlpha, textureSampling, type SceneDocument } from '@modelshot/scene';
import { NODE_FLOATS, type Bvh } from './buildBvh';
import type { FlatScene } from './flattenScene';
import { PathTracerError } from './PathTracerError';
import type { TexturePlacement } from './textureLayers';

/** Texels per row of every RGBA32F data texture; WebGL2 guarantees MAX_TEXTURE_SIZE ≥ 2048. */
export const DATA_TEXTURE_WIDTH = 2048;
export const NODE_TEXELS = 2;
export const TRIANGLE_POSITION_TEXELS = 3;
export const TRIANGLE_ATTRIBUTE_TEXELS = 9;
export const MATERIAL_TEXELS = 3;

/** RGBA32F texels, `DATA_TEXTURE_WIDTH` per row, padded to whole rows. */
export interface DataTexture {
  readonly rows: number;
  readonly data: Float32Array;
}

/**
 * The geometry as the trace shader reads it (sceneData.glsl), triangles in BVH leaf order. Nodes: 2 texels each, the
 * `Bvh` layout. Triangle positions: 3 texels, corner k in xyz; w holds the material slot (texel 0), 1 for double-sided
 * (texel 1) and the render order (texel 2). Attributes: 9 texels, normals in xyz of texels 0-2 with the UVs in their w
 * and texel 3 (u0, v0, u1 | v1, u2, v2), the face's UV rectangle in texel 4, corner k's four sharp-edge distances in
 * texel 5 + k (`NO_EDGE` in an empty slot) and the slots' signed angles in texel 8 (`FlatScene.edgeDistances`,
 * `edgeAngles`).
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

/** Rows of `DATA_TEXTURE_WIDTH` texels holding `texels`; over `maxTextureSize` throws `SCENE_TOO_LARGE`. */
export function rowsFor(texels: number, maxTextureSize: number, what: string): number {
  const rows = Math.max(1, Math.ceil(texels / DATA_TEXTURE_WIDTH));
  if (rows > maxTextureSize) {
    throw new PathTracerError(
      'SCENE_TOO_LARGE',
      `${what} need ${rows} rows of ${DATA_TEXTURE_WIDTH} texels; this GPU allows ${maxTextureSize}`,
    );
  }
  return rows;
}

export function dataTexture(rows: number): DataTexture {
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
    // Double-sided 1, camera-only 2 (bvhTraverse.glsl): a scene without camera-only faces packs as before.
    p[pos + 7] = (flat.doubleSided[t] ?? 0) + 2 * (flat.cameraOnly[t] ?? 0);
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
  packTriangleEdges(triAttributes, flat, bvh.order, count);
  return { nodeCount: bvh.nodeCount, triangleCount: count, nodes, triPositions, triAttributes, maxRenderOrder };
}

/**
 * Writes the sharp-edge texels (5-8) of `count` triangles into packed attributes, in the BVH `order`: what an edge
 * angle change rewrites without packing the rest again.
 */
export function packTriangleEdges(
  triAttributes: DataTexture,
  edges: Pick<FlatScene, 'edgeDistances' | 'edgeAngles'>,
  order: Uint32Array,
  count: number,
): void {
  const a = triAttributes.data;
  for (let i = 0; i < count; i++) {
    const t = order[i] ?? 0;
    const att = i * TRIANGLE_ATTRIBUTE_TEXELS * 4;
    a.set(edges.edgeDistances.subarray(t * 12, t * 12 + 12), att + 20);
    a.set(edges.edgeAngles.subarray(t * 4, t * 4 + 4), att + 32);
  }
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

/** Throws `SCENE_TOO_LARGE` when the material table of `count` materials (plus slot 0) would not fit its texture. */
export function checkMaterialCount(count: number): void {
  rowsFor((count + 1) * MATERIAL_TEXELS, DATA_TEXTURE_WIDTH, 'materials');
}

const nonNegative = (x: number | undefined): number => (x !== undefined && Number.isFinite(x) && x > 0 ? x : 0);

/**
 * The material table: slot 0 for faces without a material, slot m + 1 for `doc.materials[m]`; 3 texels each: (layer,
 * x, y, width), (height, alpha mode id, cutoff byte, texture sampling flags), (emission rgb, 0). Untextured faces are
 * opaque and have no flags, as in the preview; the flags are the texture's `textureSamplingFlags` whichever image is
 * drawn (the preview's batches carry the same); a negative or non-finite emission channel counts as 0.
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
    flags: number,
    glow: readonly number[],
  ) => {
    const at = slot * MATERIAL_TEXELS * 4;
    table.data.set([place.layer, place.x, place.y, place.width, place.height, modeId, cutoffByte, flags], at);
    table.data.set([nonNegative(glow[0]), nonNegative(glow[1]), nonNegative(glow[2]), 0], at + 8);
  };
  write(0, textures.untextured, ALPHA_MODE_ID.opaque, 0, 0, []);
  doc.materials.forEach((material, m) => {
    const glow = emission[m] ?? [];
    if (material.texture < 0) {
      write(m + 1, textures.untextured, ALPHA_MODE_ID.opaque, 0, 0, glow);
      return;
    }
    const rule = resolveMaterialAlpha(material);
    const place = textures.textures[material.texture] ?? textures.placeholder;
    const flags = textureSamplingFlags(textureSampling(doc.textures[material.texture]));
    write(m + 1, place, ALPHA_MODE_ID[rule.mode], alphaCutoffByte(rule.cutoff), flags, glow);
  });
  return table;
}
