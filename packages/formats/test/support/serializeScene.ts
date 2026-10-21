import {
  mat4Identity,
  mat4NormalMatrix,
  mat4TransformPoint,
  normalMatrixTransform,
  worldMatrices,
  type SceneDocument,
} from '@modelshot/scene';

/** What every loader returns; warnings print as they are. */
export interface LoadResult {
  readonly scene: SceneDocument;
  readonly warnings: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

/** Rounds to a fixed grid and turns −0 into 0, so float noise never changes a golden. */
export function round(value: number, step: number): number {
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(Math.max(0, Math.ceil(-Math.log10(step))))) || 0;
}

/**
 * World-space vertices of mesh `index`: position, unit normal (through the normal matrix, so a scaled node keeps it
 * perpendicular), uv × uv size, face rect × uv size.
 */
export function worldVertices(scene: SceneDocument, index: number): number[][] {
  const mesh = scene.meshes[index];
  if (!mesh) throw new Error(`no mesh ${index}`);
  const world = worldMatrices(scene.nodes)[mesh.node] ?? mat4Identity();
  const normalMatrix = mat4NormalMatrix(world);
  const uvSize = meshUvSize(scene, index);
  const vertices: number[][] = [];
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const at = (array: Float32Array, size: number, k: number): number => array[v * size + k] ?? NaN;
    const position = mat4TransformPoint(world, [
      at(mesh.positions, 3, 0),
      at(mesh.positions, 3, 1),
      at(mesh.positions, 3, 2),
    ]);
    const mapped = normalMatrixTransform(normalMatrix, [
      at(mesh.normals, 3, 0),
      at(mesh.normals, 3, 1),
      at(mesh.normals, 3, 2),
    ]);
    const length = Math.hypot(...mapped) || 1;
    const normal = mapped.map((x) => x / length);
    vertices.push([
      ...position.map((x) => round(x, 1e-5)),
      ...normal.map((x) => round(x, 1e-5)),
      round(at(mesh.uvs, 2, 0) * uvSize.width, 1e-5),
      round(at(mesh.uvs, 2, 1) * uvSize.height, 1e-5),
      ...[0, 1, 2, 3].map((k) => round(at(mesh.uvRects, 4, k) * (k % 2 ? uvSize.height : uvSize.width), 1e-5)),
    ]);
  }
  return vertices;
}

/** UV size of the mesh's first textured group, else the uv size used for untextured faces of the fixtures. */
function meshUvSize(scene: SceneDocument, index: number): { width: number; height: number } {
  const mesh = scene.meshes[index];
  const material = mesh?.groups.find((group) => group.material >= 0)?.material;
  const texture = material === undefined ? undefined : scene.textures[scene.materials[material]?.texture ?? -1];
  return texture ? { width: texture.uvWidth, height: texture.uvHeight } : { width: 1, height: 1 };
}

/**
 * Golden form of a load result: node transforms (world matrix rounded to 1e-6), meshes in world space (1e-5) with
 * render order and group sidedness, materials with their alpha rule, textures without their bytes (with their frames
 * when they are strips), animations when
 * the file has any, warnings. Number arrays print on one line.
 */
export function serializeResult(result: LoadResult): string {
  const { scene } = result;
  const world = worldMatrices(scene.nodes);
  const data = {
    formatVersion: scene.formatVersion,
    source: scene.source,
    rootNodes: scene.rootNodes,
    nodes: scene.nodes.map((node, i) => ({
      name: node.name,
      sourceId: node.sourceId,
      parent: node.parent,
      children: node.children,
      pivot: node.pivot,
      rotation: node.rotation,
      translation: node.translation,
      ...(node.scale ? { scale: node.scale } : {}),
      visible: node.visible,
      meshes: node.meshes,
      world: [...(world[i] ?? [])].map((x) => round(x, 1e-6)),
    })),
    meshes: scene.meshes.map((mesh, i) => ({
      name: mesh.name,
      sourceId: mesh.sourceId,
      node: mesh.node,
      visible: mesh.visible,
      renderOrder: mesh.renderOrder,
      groups: mesh.groups,
      indices: [...mesh.indices],
      vertexColumns: 'x y z nx ny nz u v uMin vMin uMax vMax (uv in texture uv units; untextured: normalised)',
      vertices: worldVertices(scene, i),
    })),
    materials: scene.materials,
    textures: scene.textures.map((texture) => ({
      name: texture.name,
      mimeType: texture.mimeType,
      width: texture.width,
      height: texture.height,
      uvWidth: texture.uvWidth,
      uvHeight: texture.uvHeight,
      missing: texture.missing,
      byteLength: texture.bytes?.byteLength ?? null,
      ...(texture.frames ? { frames: texture.frames } : {}),
    })),
    ...(scene.animations ? { animations: scene.animations } : {}),
    warnings: result.warnings,
  };
  return printJson(data);
}

/** Number arrays print on one line. */
export function printJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, items: string) => `[${items.replace(/\s*\n\s*/g, ' ')}]`)}\n`;
}
