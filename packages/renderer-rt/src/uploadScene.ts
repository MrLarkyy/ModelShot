import { meshVisible, nodeVisibility, worldMatrices, type SceneDocument } from '@modelshot/scene';
import { batchScene, type BatchAlpha, type SceneBatch } from './batchScene';
import { worldBounds } from './closedOpaque';
import { hasPartialCoverage, type AlphaLevels } from './textureUpload';

/** One indexed draw: a batch with its node's world matrix, texture, alpha rule, sidedness and render order. */
export interface DrawItem {
  readonly vao: WebGLVertexArrayObject;
  readonly model: Float32Array;
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

/** De-indexed geometry with per-vertex triangle corners, built only when a frame needs the exact depth key. */
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
] as const satisfies readonly { location: number; size: number; key: keyof SceneBatch }[];

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * Uploads the visible geometry of a validated document, merged by `batchScene`, one vertex array per batch.
 * `alphaLevels[t]` holds the alpha bytes present in texture `t` (`readTextureAlpha`); a batch whose texture has a byte
 * that its alpha rule makes partial is also drawn by the transparency pass. `closedOpaque[m]` marks mesh `m` closed and
 * opaque on every face (`closedOpaqueMeshes`); `lightmap[m]` its per-vertex lightmap data (`LightmapLayout.vertexData`).
 */
export function uploadScene(
  gl: WebGL2RenderingContext,
  doc: SceneDocument,
  alphaLevels: readonly (AlphaLevels | null)[],
  closedOpaque: readonly boolean[] = [],
  lightmap: readonly (Float32Array | null)[] = [],
): GpuScene {
  const world = worldMatrices(doc.nodes);
  const vaos: WebGLVertexArrayObject[] = [];
  const buffers: WebGLBuffer[] = [];
  const opaque: DrawItem[] = [];
  const partial: DrawItem[] = [];
  for (const batch of batchScene(doc, closedOpaque, lightmap)) {
    const vao = gl.createVertexArray();
    vaos.push(vao);
    gl.bindVertexArray(vao);
    for (const { location, size, key } of ATTRIBUTES) {
      const buffer = gl.createBuffer();
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, batch[key], gl.STATIC_DRAW);
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

/** Corner and shared-edge attribute locations of the exact depth key (`depthKeyVertexExact.glsl`). */
const CORNER_LOCATIONS = [4, 5, 6] as const;
const SHARED_EDGES_LOCATION = 7;

/** Positions closer than this (model units) are the same corner when matching shared edges. */
const SHARED_EDGE_EPSILON = 1e-5;

/**
 * Per triangle, bit i set when its edge i (corner i to corner i + 1) is shared, by position, with another triangle of
 * the batch that lies in the same plane (normals within 1e-4 radians of each other, same side): the inner edges of a
 * quad or polygon face. A pixel whose centre ray leaves the triangle only across such edges still meets the same
 * plane, so the exact key keeps the centre ray there.
 */
export function sharedEdgeFlags(positions: Float32Array, indices: Uint32Array): Uint8Array {
  const triangles = Math.floor(indices.length / 3);
  // One id per distinct position (within SHARED_EDGE_EPSILON), so faces with their own vertices still match.
  const vertexCount = Math.floor(positions.length / 3);
  const ids = new Uint32Array(vertexCount);
  const byPosition = new Map<string, number>();
  for (let v = 0; v < vertexCount; v++) {
    const q = (k: number) => Math.round((positions[v * 3 + k] ?? 0) / SHARED_EDGE_EPSILON);
    const key = `${q(0)},${q(1)},${q(2)}`;
    let id = byPosition.get(key);
    if (id === undefined) {
      id = byPosition.size;
      byPosition.set(key, id);
    }
    ids[v] = id;
  }
  const normals = new Float64Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const p = (c: number, k: number) => positions[(indices[t * 3 + c] ?? 0) * 3 + k] ?? 0;
    const u = [p(1, 0) - p(0, 0), p(1, 1) - p(0, 1), p(1, 2) - p(0, 2)] as const;
    const w = [p(2, 0) - p(0, 0), p(2, 1) - p(0, 1), p(2, 2) - p(0, 2)] as const;
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    for (let k = 0; k < 3; k++) normals[t * 3 + k] = (n[k] ?? 0) / length;
  }
  const coplanar = (s: number, t: number) =>
    (normals[s * 3] ?? 0) * (normals[t * 3] ?? 0) +
      (normals[s * 3 + 1] ?? 0) * (normals[t * 3 + 1] ?? 0) +
      (normals[s * 3 + 2] ?? 0) * (normals[t * 3 + 2] ?? 0) >
    1 - 5e-9;
  const distinct = byPosition.size;
  const firstOwner = new Map<number, number>();
  const flags = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    for (let i = 0; i < 3; i++) {
      const a = ids[indices[t * 3 + i] ?? 0] ?? 0;
      const b = ids[indices[t * 3 + ((i + 1) % 3)] ?? 0] ?? 0;
      const key = Math.min(a, b) * distinct + Math.max(a, b);
      const owner = firstOwner.get(key);
      if (owner === undefined) {
        firstOwner.set(key, t * 3 + i);
        continue;
      }
      const other = Math.floor(owner / 3);
      if (other !== t && coplanar(t, other)) {
        flags[t] = (flags[t] ?? 0) | (1 << i);
        flags[other] = (flags[other] ?? 0) | (1 << (owner % 3));
      }
    }
  }
  return flags;
}

/**
 * Uploads every batch again without indices, each vertex carrying its triangle's three corners, for the exact depth
 * key; drawn with `drawArrays`. Built once per scene: at upload for a scene with render order, else on the first frame
 * that needs it (a camera inside the bounding sphere).
 */
export function uploadExactGeometry(gl: WebGL2RenderingContext, scene: GpuScene): ExactGeometry {
  const vaos = new Map<SceneBatch, WebGLVertexArrayObject>();
  const buffers: WebGLBuffer[] = [];
  for (const { batch } of scene.opaque) {
    if (vaos.has(batch)) continue;
    const n = batch.indices.length;
    const arrays: Record<(typeof ATTRIBUTES)[number]['key'], Float32Array> = {
      positions: new Float32Array(n * 3),
      normals: new Float32Array(n * 3),
      uvs: new Float32Array(n * 2),
      uvRects: new Float32Array(n * 4),
      lightmap: new Float32Array(n * 4),
    };
    const corners = CORNER_LOCATIONS.map(() => new Float32Array(n * 3));
    const { indices, positions, normals, uvs, uvRects, lightmap } = batch;
    // Plain index loops: this runs once per scene on up to the loader's 200 000 triangles.
    for (let i = 0; i < n; i++) {
      const v = indices[i] ?? 0;
      for (let k = 0; k < 3; k++) {
        arrays.positions[i * 3 + k] = positions[v * 3 + k] ?? 0;
        arrays.normals[i * 3 + k] = normals[v * 3 + k] ?? 0;
      }
      arrays.uvs[i * 2] = uvs[v * 2] ?? 0;
      arrays.uvs[i * 2 + 1] = uvs[v * 2 + 1] ?? 0;
      for (let k = 0; k < 4; k++) arrays.uvRects[i * 4 + k] = uvRects[v * 4 + k] ?? 0;
      for (let k = 0; k < 4; k++) arrays.lightmap[i * 4 + k] = lightmap[v * 4 + k] ?? 0;
    }
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
    for (const { location, size, key } of ATTRIBUTES) attribute(location, size, arrays[key]);
    CORNER_LOCATIONS.forEach((location, c) => attribute(location, 3, corners[c] ?? new Float32Array(0)));
    const triangleFlags = sharedEdgeFlags(positions, indices);
    const vertexFlags = new Float32Array(n);
    for (let i = 0; i < n; i++) vertexFlags[i] = triangleFlags[Math.floor(i / 3)] ?? 0;
    attribute(SHARED_EDGES_LOCATION, 1, vertexFlags);
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
