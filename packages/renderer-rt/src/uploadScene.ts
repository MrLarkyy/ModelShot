import {
  mat4NormalMatrix,
  meshVisible,
  nodeVisibility,
  worldMatrices,
  type SceneDocument,
  type SharpEdgeAttributes,
} from '@modelshot/scene';
import { batchScene, type BatchAlpha, type SceneBatch } from './batchScene';
import { exactEdgeWords } from './exactEdgeWords';
import { worldBounds } from './closedOpaque';
import { hasPartialCoverage, type AlphaLevels } from './textureUpload';

/** One indexed draw: a batch with its node's world matrix, texture, alpha rule, sidedness and render order. */
export interface DrawItem {
  readonly vao: WebGLVertexArrayObject;
  readonly model: Float32Array;
  /** `mat4NormalMatrix` of `model`, column-major 3×3, for `u_normalMatrix`. */
  readonly normal: Float32Array;
  /** Byte offset into the Uint32 index buffer. */
  readonly offset: number;
  readonly count: number;
  /** Index into `SceneDocument.textures`, −1 for an untextured face. */
  readonly texture: number;
  /** The texture's size in texels as the lightmap layout saw it (`SceneTexture` width, height; 1 × 1 untextured). */
  readonly textureSize: readonly [number, number];
  readonly alpha: BatchAlpha;
  /** Single-sided: back faces culled in every pass. */
  readonly cull: boolean;
  readonly renderOrder: number;
  /**
   * World bounds `[minX, minY, minZ, maxX, maxY, maxZ]` of a closed batch opaque on every face (`closedOpaqueMeshes`),
   * whose back pass raster frames skip while the camera is outside them (`backSidesVisible`); null for other batches.
   */
  readonly closedBounds: Float64Array | null;
  /** The batch's geometry, kept to build the de-indexed copy of the exact depth key on first use. */
  readonly batch: SceneBatch;
}

/**
 * De-indexed geometry with per-vertex triangle corners and edge words, built only when a frame needs them: the exact
 * depth key, or the silhouette test of a raster MSAA frame's opaque pass.
 */
export interface ExactGeometry {
  readonly vaos: ReadonlyMap<SceneBatch, WebGLVertexArrayObject>;
  readonly buffers: readonly WebGLBuffer[];
}

export interface GpuScene {
  readonly vaos: readonly WebGLVertexArrayObject[];
  readonly buffers: readonly WebGLBuffer[];
  /** Every batch, by render order descending: the opaque pass (and the whole no-float pass) draws them all. */
  readonly opaque: readonly DrawItem[];
  /** Batches with a partially covered texel under their alpha rule, drawn again by the transparency pass. */
  readonly partial: readonly DrawItem[];
  /** Some visible mesh has a non-zero renderOrder: every frame uses the exact depth key. */
  readonly hasRenderOrder: boolean;
  exact: ExactGeometry | null;
}

/** Attribute locations of `mesh.vert.glsl`. */
const ATTRIBUTES = [
  { location: 0, size: 3, key: 'positions' },
  { location: 1, size: 3, key: 'normals' },
  { location: 2, size: 2, key: 'uvs' },
  { location: 3, size: 4, key: 'uvRects' },
  { location: 8, size: 4, key: 'lightmap' },
  { location: 9, size: 4, key: 'edgeDistances' },
  { location: 10, size: 4, key: 'edgeAngles' },
  { location: 11, size: 4, key: 'lightmapChart' },
] as const satisfies readonly { location: number; size: number; key: keyof SceneBatch }[];

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const IDENTITY_3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/**
 * Uploads the visible geometry of a validated document, merged by `batchScene`, one vertex array per batch.
 * `alphaLevels[t]` holds the alpha bytes present in texture `t` (`readTextureAlpha`); a batch whose texture has a byte
 * that its alpha rule makes partial is also drawn by the transparency pass. `closedOpaque[m]` marks mesh `m` closed and
 * opaque on every face (`closedOpaqueMeshes`); `lightmap[m]` its per-vertex lightmap data (`LightmapLayout.vertexData`);
 * `edges[m]` its sharp-edge attributes (`sceneSharpEdges`); `corners[m]` its world chart data
 * (`LightmapLayout.cornerData`).
 */
export function uploadScene(
  gl: WebGL2RenderingContext,
  doc: SceneDocument,
  alphaLevels: readonly (AlphaLevels | null)[],
  closedOpaque: readonly boolean[] = [],
  lightmap: readonly (Float32Array | null)[] = [],
  edges: readonly (SharpEdgeAttributes | null)[] = [],
  corners: readonly (Float32Array | null)[] = [],
): GpuScene {
  const world = worldMatrices(doc.nodes);
  const vaos: WebGLVertexArrayObject[] = [];
  const buffers: WebGLBuffer[] = [];
  const opaque: DrawItem[] = [];
  const partial: DrawItem[] = [];
  for (const batch of batchScene(doc, closedOpaque, lightmap, edges, corners)) {
    const vao = gl.createVertexArray();
    vaos.push(vao);
    gl.bindVertexArray(vao);
    for (const { location, size, key } of ATTRIBUTES) {
      const data = batch[key];
      // Left disabled: a constant no vertex of the batch reads (lightmapChart without world charts).
      if (!data) continue;
      const buffer = gl.createBuffer();
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    const indexBuffer = gl.createBuffer();
    buffers.push(indexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const nodeMatrix = batch.node >= 0 ? world[batch.node] : undefined;
    const model = nodeMatrix ? new Float32Array(nodeMatrix) : IDENTITY;
    const item: DrawItem = {
      vao,
      model,
      normal: nodeMatrix ? new Float32Array(mat4NormalMatrix(nodeMatrix)) : IDENTITY_3,
      offset: 0,
      count: batch.indices.length,
      texture: batch.texture,
      textureSize: [doc.textures[batch.texture]?.width || 1, doc.textures[batch.texture]?.height || 1],
      alpha: batch.alpha,
      cull: !batch.doubleSided,
      renderOrder: batch.renderOrder,
      closedBounds: batch.closedOpaque && batch.doubleSided ? worldBounds(batch.positions, model) : null,
      batch,
    };
    opaque.push(item);
    const levels = batch.texture >= 0 ? alphaLevels[batch.texture] : null;
    if (levels && hasPartialCoverage(levels, batch.alpha.modeId, batch.alpha.cutoffByte)) partial.push(item);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  // Stable: within one render order the document order stays.
  const byOrder = (a: DrawItem, b: DrawItem) => b.renderOrder - a.renderOrder;
  const visibility = nodeVisibility(doc);
  const hasRenderOrder = doc.meshes.some(
    (mesh, index) => (mesh.renderOrder ?? 0) !== 0 && meshVisible(doc, index, visibility),
  );
  const scene: GpuScene = {
    vaos,
    buffers,
    opaque: opaque.sort(byOrder),
    partial: partial.sort(byOrder),
    hasRenderOrder,
    exact: null,
  };
  if (hasRenderOrder) scene.exact = uploadExactGeometry(gl, scene);
  return scene;
}

/**
 * Moves an uploaded scene to another pose of its document (`poseOnlyChange`): rewrites each draw's world and normal
 * matrix and the bounds of its closed batch in place. Batches, buffers and the exact geometry are in node space and
 * stay; draws at the model root (node −1) never move.
 */
export function poseGpuScene(scene: GpuScene, doc: SceneDocument): void {
  const world = worldMatrices(doc.nodes);
  for (const item of scene.opaque) {
    const matrix = item.batch.node >= 0 ? world[item.batch.node] : undefined;
    if (!matrix) continue;
    item.model.set(matrix);
    item.normal.set(mat4NormalMatrix(matrix));
    item.closedBounds?.set(worldBounds(item.batch.positions, item.model));
  }
}

/** Corner and edge-word attribute locations of the de-indexed geometry (`triangleCornersVertex.glsl`). */
const CORNER_LOCATIONS = [4, 5, 6] as const;
export const EDGE_WORD_LOCATION = 7;

/**
 * Uploads every batch again without indices, each vertex carrying its triangle's three corners and edge word
 * (`exactEdgeWords`), for the exact depth key and the silhouette test of raster MSAA frames; drawn with `drawArrays`.
 * Built once per scene: at upload for a scene with render order, else on the first frame that needs it (an MSAA frame,
 * or a camera inside the bounding sphere).
 */
export function uploadExactGeometry(gl: WebGL2RenderingContext, scene: GpuScene): ExactGeometry {
  const vaos = new Map<SceneBatch, WebGLVertexArrayObject>();
  const buffers: WebGLBuffer[] = [];
  for (const { batch } of scene.opaque) {
    if (vaos.has(batch)) continue;
    const n = batch.indices.length;
    const chart = batch.lightmapChart;
    const arrays: Record<(typeof ATTRIBUTES)[number]['key'], Float32Array | null> = {
      positions: new Float32Array(n * 3),
      normals: new Float32Array(n * 3),
      uvs: new Float32Array(n * 2),
      uvRects: new Float32Array(n * 4),
      lightmap: new Float32Array(n * 4),
      edgeDistances: new Float32Array(n * 4),
      edgeAngles: new Float32Array(n * 4),
      lightmapChart: chart ? new Float32Array(n * 4) : null,
    };
    // Every vertex attribute of the batch, de-indexed: `size` floats per vertex, read at the index's vertex.
    for (const { size, key } of ATTRIBUTES) {
      const from = batch[key];
      const to = arrays[key];
      if (!from || !to) continue;
      // Plain index loops: this runs once per scene on up to the loader's 200 000 triangles.
      for (let i = 0; i < n; i++) {
        const v = batch.indices[i] ?? 0;
        for (let k = 0; k < size; k++) to[i * size + k] = from[v * size + k] ?? 0;
      }
    }
    const corners = CORNER_LOCATIONS.map(() => new Float32Array(n * 3));
    const { indices, positions } = batch;
    for (let t = 0; t < n; t += 3) {
      for (let c = 0; c < 3; c++) {
        const corner = corners[c];
        const v = indices[t + c] ?? 0;
        if (!corner) continue;
        for (let i = t; i < t + 3; i++) {
          for (let k = 0; k < 3; k++) corner[i * 3 + k] = positions[v * 3 + k] ?? 0;
        }
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attribute = (location: number, size: number, data: Float32Array): void => {
      const buffer = gl.createBuffer();
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    for (const { location, size, key } of ATTRIBUTES) {
      const data = arrays[key];
      if (data) attribute(location, size, data);
    }
    CORNER_LOCATIONS.forEach((location, c) => attribute(location, 3, corners[c] ?? new Float32Array(0)));
    const triangleWords = exactEdgeWords(positions, indices);
    const vertexWords = new Uint32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = Math.floor(i / 3) * 4;
      for (let k = 0; k < 4; k++) vertexWords[i * 4 + k] = triangleWords[t + k] ?? 0;
    }
    const wordBuffer = gl.createBuffer();
    buffers.push(wordBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, wordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexWords, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(EDGE_WORD_LOCATION);
    gl.vertexAttribIPointer(EDGE_WORD_LOCATION, 4, gl.UNSIGNED_INT, 0, 0);
    gl.bindVertexArray(null);
    vaos.set(batch, vao);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { vaos, buffers };
}

export function disposeGpuScene(gl: WebGL2RenderingContext, scene: GpuScene): void {
  for (const vao of scene.vaos) gl.deleteVertexArray(vao);
  for (const buffer of scene.buffers) gl.deleteBuffer(buffer);
  for (const vao of scene.exact?.vaos.values() ?? []) gl.deleteVertexArray(vao);
  for (const buffer of scene.exact?.buffers ?? []) gl.deleteBuffer(buffer);
}
