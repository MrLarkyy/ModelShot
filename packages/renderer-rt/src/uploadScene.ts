import { meshVisible, nodeVisibility, worldMatrices, type SceneDocument, type SceneMesh } from '@modelshot/scene';

/** One indexed draw: a mesh group with its node's world matrix and texture. */
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
  /** Every group: the opaque pass (and the whole no-float pass) draws them all. */
  readonly opaque: readonly DrawItem[];
  /** Groups whose texture has partial alpha, drawn again by the transparency pass. */
  readonly partial: readonly DrawItem[];
}

/** Attribute locations of `mesh.vert.glsl`. */
const ATTRIBUTES = [
  { location: 0, size: 3, key: 'positions' },
  { location: 1, size: 3, key: 'normals' },
  { location: 2, size: 2, key: 'uvs' },
  { location: 3, size: 4, key: 'uvRects' },
] as const satisfies readonly { location: number; size: number; key: keyof SceneMesh }[];

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * Uploads every visible mesh of a validated document into its own vertex array and splits its groups into draw
 * lists. `partialTextures[t]` tells whether texture `t` has partial alpha.
 */
export function uploadScene(
  gl: WebGL2RenderingContext,
  doc: SceneDocument,
  partialTextures: readonly boolean[],
): GpuScene {
  const world = worldMatrices(doc.nodes);
  const visibility = nodeVisibility(doc);
  const vaos: WebGLVertexArrayObject[] = [];
  const buffers: WebGLBuffer[] = [];
  const opaque: DrawItem[] = [];
  const partial: DrawItem[] = [];
  doc.meshes.forEach((mesh, index) => {
    if (!meshVisible(doc, index, visibility) || mesh.indices.length === 0) return;
    const vao = gl.createVertexArray();
    vaos.push(vao);
    gl.bindVertexArray(vao);
    for (const { location, size, key } of ATTRIBUTES) {
      const buffer = gl.createBuffer();
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh[key], gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    const indexBuffer = gl.createBuffer();
    buffers.push(indexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const nodeMatrix = mesh.node >= 0 ? world[mesh.node] : undefined;
    const model = nodeMatrix ? new Float32Array(nodeMatrix) : IDENTITY;
    const groups = mesh.groups.length > 0 ? mesh.groups : [{ material: -1, start: 0, count: mesh.indices.length }];
    for (const group of groups) {
      if (group.count === 0) continue;
      const texture = group.material >= 0 ? (doc.materials[group.material]?.texture ?? -1) : -1;
      const item: DrawItem = { vao, model, offset: group.start * 4, count: group.count, texture };
      opaque.push(item);
      if (texture >= 0 && partialTextures[texture] === true) partial.push(item);
    }
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { vaos, buffers, opaque, partial };
}

export function disposeGpuScene(gl: WebGL2RenderingContext, scene: GpuScene): void {
  for (const vao of scene.vaos) gl.deleteVertexArray(vao);
  for (const buffer of scene.buffers) gl.deleteBuffer(buffer);
}
