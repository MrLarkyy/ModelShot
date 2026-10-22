import { ALPHA_MODE_ID, alphaCutoffByte, type AlphaModeId } from '@modelshot/looks';
import {
  EDGE_SLOTS,
  NO_EDGE,
  meshVisible,
  nodeVisibility,
  resolveMaterialAlpha,
  type SceneDocument,
  type SceneMesh,
  type SceneMeshGroup,
  type SharpEdgeAttributes,
} from '@modelshot/scene';

/** A material's alpha rule as the shaders take it (texelAlpha): mode id and cutoff byte. */
export interface BatchAlpha {
  readonly modeId: AlphaModeId;
  readonly cutoffByte: number;
}

/**
 * The visible triangles of one node drawn with one texture, alpha rule, sidedness and render order, merged into a
 * single vertex and index buffer. Every
 * vertex keeps its own UV rectangle, so merging changes nothing per texel; it only turns a model with one mesh per
 * element (thousands for a large Blockbench model) into a few draw calls.
 */
export interface SceneBatch {
  /** Owning node (its world matrix places the batch), −1 for the model root. */
  readonly node: number;
  /** Index into `SceneDocument.textures`, −1 for untextured faces. */
  readonly texture: number;
  /** Untextured faces and materials without an alpha mode are opaque (`resolveMaterialAlpha`). */
  readonly alpha: BatchAlpha;
  readonly doubleSided: boolean;
  readonly renderOrder: number;
  /** Every mesh in it is closed and opaque on every face (`closedOpaqueMeshes`): raster frames may skip its backs. */
  readonly closedOpaque: boolean;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly uvRects: Float32Array;
  /**
   * 4 per vertex: where its baked light lies (`LightmapLayout.vertexData`, or the first 4 of `cornerData` for a
   * world-charted mesh); (0, 0, −1, 0) without a layout.
   */
  readonly lightmap: Float32Array;
  /**
   * 4 per vertex: its world chart's rectangle (the last 4 of `LightmapLayout.cornerData`), 0 for other meshes; null
   * when no mesh of the batch has world charts (the attribute is then left disabled: only world corners read it).
   */
  readonly lightmapChart: Float32Array | null;
  /** 4 per vertex: distances to its sharp-edge slots (`SharpEdgeAttributes.distances`); `NO_EDGE` without them. */
  readonly edgeDistances: Float32Array;
  /** 4 per vertex: the slots' signed angles (`SharpEdgeAttributes.angles`); 0 without them. */
  readonly edgeAngles: Float32Array;
  readonly indices: Uint32Array;
}

interface Part {
  readonly mesh: SceneMesh;
  readonly group: SceneMeshGroup;
}

function textureOf(doc: SceneDocument, group: SceneMeshGroup): number {
  return group.material >= 0 ? (doc.materials[group.material]?.texture ?? -1) : -1;
}

interface BatchKey {
  readonly node: number;
  readonly texture: number;
  readonly alpha: BatchAlpha;
  readonly doubleSided: boolean;
  readonly renderOrder: number;
  readonly closedOpaque: boolean;
}

function alphaOf(doc: SceneDocument, group: SceneMeshGroup, texture: number): BatchAlpha {
  if (texture < 0) return { modeId: ALPHA_MODE_ID.opaque, cutoffByte: 0 };
  const rule = resolveMaterialAlpha(doc.materials[group.material]);
  return { modeId: ALPHA_MODE_ID[rule.mode], cutoffByte: alphaCutoffByte(rule.cutoff) };
}

/** Copies `size` floats per vertex of `from` into `to` at vertex `base`, vertex i taking source vertex `vertexOf[i]`. */
function gather(to: Float32Array, from: Float32Array, size: number, base: number, vertexOf: Uint32Array | null): void {
  if (!vertexOf) {
    to.set(from, base * size);
    return;
  }
  for (let i = 0; i < vertexOf.length; i++) {
    const v = vertexOf[i] ?? 0;
    for (let k = 0; k < size; k++) to[(base + i) * size + k] = from[v * size + k] ?? 0;
  }
}

/**
 * A world-charted mesh drawn de-indexed: per index of the mesh, the source vertex its attributes come from and the
 * sharp-edge split vertex its edge attributes come from.
 */
function cornerSources(
  mesh: SceneMesh,
  edges: SharpEdgeAttributes | null,
): { vertexOf: Uint32Array; splitOf: Uint32Array } {
  const splitOf = Uint32Array.from(edges?.indices ?? mesh.indices);
  const vertexOf = edges ? Uint32Array.from(splitOf, (split) => edges.vertexOf[split] ?? 0) : splitOf;
  return { vertexOf, splitOf };
}

function merge(
  key: BatchKey,
  parts: readonly Part[],
  lightmapOf: (mesh: SceneMesh) => Float32Array | null,
  edgesOf: (mesh: SceneMesh) => SharpEdgeAttributes | null,
  cornersOf: (mesh: SceneMesh) => Float32Array | null,
): SceneBatch {
  const bases = new Map<SceneMesh, number>();
  let vertices = 0;
  let indexCount = 0;
  let world = false;
  for (const { mesh, group } of parts) {
    world ||= cornersOf(mesh) !== null;
    if (!bases.has(mesh)) {
      bases.set(mesh, vertices);
      vertices += cornersOf(mesh) ? mesh.indices.length : (edgesOf(mesh)?.vertexOf.length ?? mesh.positions.length / 3);
    }
    indexCount += group.count;
  }
  const batch = {
    ...key,
    positions: new Float32Array(vertices * 3),
    normals: new Float32Array(vertices * 3),
    uvs: new Float32Array(vertices * 2),
    uvRects: new Float32Array(vertices * 4),
    lightmap: new Float32Array(vertices * 4),
    lightmapChart: world ? new Float32Array(vertices * 4) : null,
    edgeDistances: new Float32Array(vertices * EDGE_SLOTS).fill(NO_EDGE),
    edgeAngles: new Float32Array(vertices * EDGE_SLOTS),
    indices: new Uint32Array(indexCount),
  };
  for (const [mesh, base] of bases) {
    const edges = edgesOf(mesh);
    const corners = cornersOf(mesh);
    if (corners) {
      const { vertexOf, splitOf } = cornerSources(mesh, edges);
      gather(batch.positions, mesh.positions, 3, base, vertexOf);
      gather(batch.normals, mesh.normals, 3, base, vertexOf);
      gather(batch.uvs, mesh.uvs, 2, base, vertexOf);
      gather(batch.uvRects, mesh.uvRects, 4, base, vertexOf);
      for (let i = 0; i < vertexOf.length; i++) {
        for (let k = 0; k < 4; k++) {
          batch.lightmap[(base + i) * 4 + k] = corners[i * 8 + k] ?? 0;
          if (batch.lightmapChart) batch.lightmapChart[(base + i) * 4 + k] = corners[i * 8 + 4 + k] ?? 0;
        }
      }
      if (edges) {
        gather(batch.edgeDistances, edges.distances, EDGE_SLOTS, base, splitOf);
        gather(batch.edgeAngles, edges.angles, EDGE_SLOTS, base, splitOf);
      }
      continue;
    }
    // A vertex split by the sharp edges copies every attribute of its source vertex.
    const vertexOf = edges?.vertexOf ?? null;
    gather(batch.positions, mesh.positions, 3, base, vertexOf);
    gather(batch.normals, mesh.normals, 3, base, vertexOf);
    gather(batch.uvs, mesh.uvs, 2, base, vertexOf);
    gather(batch.uvRects, mesh.uvRects, 4, base, vertexOf);
    const light = lightmapOf(mesh);
    const count = vertexOf?.length ?? mesh.positions.length / 3;
    if (light) gather(batch.lightmap, light, 4, base, vertexOf);
    else for (let v = base; v < base + count; v++) batch.lightmap[v * 4 + 2] = -1;
    if (edges) {
      batch.edgeDistances.set(edges.distances, base * EDGE_SLOTS);
      batch.edgeAngles.set(edges.angles, base * EDGE_SLOTS);
    }
  }
  let at = 0;
  for (const { mesh, group } of parts) {
    const base = bases.get(mesh) ?? 0;
    if (cornersOf(mesh)) {
      for (let i = 0; i < group.count; i++) batch.indices[at + i] = base + group.start + i;
      at += group.count;
      continue;
    }
    const indices = edgesOf(mesh)?.indices ?? mesh.indices;
    const source = indices.subarray(group.start, group.start + group.count);
    for (let i = 0; i < source.length; i++) batch.indices[at + i] = (source[i] ?? 0) + base;
    at += source.length;
  }
  return batch;
}

/**
 * Groups the visible triangles of a validated document by (node, texture, alpha mode, cutoff byte, sidedness, render
 * order, closed and opaque), in order of first appearance; within a batch triangles keep the document's mesh and group
 * order. `closedOpaque[m]` marks mesh `m` closed and opaque on every face (`closedOpaqueMeshes`; default none);
 * `lightmap[m]` holds mesh `m`'s per-vertex lightmap data (`LightmapLayout.vertexData`; default none); `edges[m]` its
 * sharp-edge attributes (`sceneSharpEdges`; default none), whose split vertices replace the mesh's; `corners[m]` its
 * per-index world chart data (`LightmapLayout.cornerData`; default none), which draws the mesh de-indexed, one batch
 * vertex per index, so corners shared across charts keep their own chart coordinates.
 */
export function batchScene(
  doc: SceneDocument,
  closedOpaque: readonly boolean[] = [],
  lightmap: readonly (Float32Array | null)[] = [],
  edges: readonly (SharpEdgeAttributes | null)[] = [],
  corners: readonly (Float32Array | null)[] = [],
): SceneBatch[] {
  const meshIndex = new Map(doc.meshes.map((mesh, m) => [mesh, m]));
  const cornersOf = (mesh: SceneMesh) => corners[meshIndex.get(mesh) ?? -1] ?? null;
  const lightmapOf = (mesh: SceneMesh) => lightmap[meshIndex.get(mesh) ?? -1] ?? null;
  const edgesOf = (mesh: SceneMesh) => edges[meshIndex.get(mesh) ?? -1] ?? null;
  const visibility = nodeVisibility(doc);
  const parts = new Map<string, { key: BatchKey; parts: Part[] }>();
  doc.meshes.forEach((mesh, index) => {
    if (!meshVisible(doc, index, visibility) || mesh.indices.length === 0) return;
    const groups = mesh.groups.length > 0 ? mesh.groups : [{ material: -1, start: 0, count: mesh.indices.length }];
    for (const group of groups) {
      if (group.count === 0) continue;
      const texture = textureOf(doc, group);
      const key: BatchKey = {
        node: mesh.node,
        texture,
        alpha: alphaOf(doc, group, texture),
        doubleSided: group.doubleSided ?? false,
        renderOrder: mesh.renderOrder ?? 0,
        closedOpaque: closedOpaque[index] ?? false,
      };
      const id = [
        key.node,
        key.texture,
        key.alpha.modeId,
        key.alpha.cutoffByte,
        key.doubleSided,
        key.renderOrder,
        key.closedOpaque,
      ].join(':');
      let entry = parts.get(id);
      if (!entry) {
        entry = { key, parts: [] };
        parts.set(id, entry);
      }
      entry.parts.push({ mesh, group });
    }
  });
  return [...parts.values()].map((entry) => merge(entry.key, entry.parts, lightmapOf, edgesOf, cornersOf));
}
