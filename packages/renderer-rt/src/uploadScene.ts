import { worldMatrices, type SceneDocument } from '@modelshot/scene';
import { batchScene, type SceneBatch } from './batchScene';

/** One indexed draw: a batch with its node's world matrix and texture. */
export interface DrawItem {
  readonly vao: WebGLVertexArrayObject;
  readonly model: Float32Array;
  /** Byte offset into the Uint32 index buffer. */
  readonly offset: number;
  readonly count: number;
  /** Index into `SceneDocument.textures`, −1 for an untextured face. */
  readonly texture: number;
}

export interface GpuScene {
  readonly vaos: readonly WebGLVertexArrayObject[];
  readonly buffers: readonly WebGLBuffer[];
  /** Every batch: the opaque pass (and the whole no-float pass) draws them all. */
  readonly opaque: readonly DrawItem[];
  /** Batches whose texture has partial alpha, drawn again by the transparency pass. */
  readonly partial: readonly DrawItem[];
}

/** Attribute locations of `mesh.vert.glsl`. */
const ATTRIBUTES = [
  { location: 0, size: 3, key: 'positions' },
  { location: 1, size: 3, key: 'normals' },
  { location: 2, size: 2, key: 'uvs' },
  { location: 3, size: 4, key: 'uvRects' },
] as const satisfies readonly { location: number; size: number; key: keyof SceneBatch }[];

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * Uploads the visible geometry of a validated document, merged per (node, texture) by `batchScene`, one vertex array
 * per batch. `partialTextures[t]` tells whether texture `t` has partial alpha.
 */
export function uploadScene(
  gl: WebGL2RenderingContext,
  doc: SceneDocument,
  partialTextures: readonly boolean[],
): GpuScene {
  const world = worldMatrices(doc.nodes);
  const vaos: WebGLVertexArrayObject[] = [];
  const buffers: WebGLBuffer[] = [];
  const opaque: DrawItem[] = [];
  const partial: DrawItem[] = [];
  for (const batch of batchScene(doc)) {
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
    const item: DrawItem = { vao, model, offset: 0, count: batch.indices.length, texture: batch.texture };
    opaque.push(item);
    if (batch.texture >= 0 && partialTextures[batch.texture] === true) partial.push(item);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { vaos, buffers, opaque, partial };
}

export function disposeGpuScene(gl: WebGL2RenderingContext, scene: GpuScene): void {
  for (const vao of scene.vaos) gl.deleteVertexArray(vao);
  for (const buffer of scene.buffers) gl.deleteBuffer(buffer);
}
