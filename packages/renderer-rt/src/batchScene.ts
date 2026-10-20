import { ALPHA_MODE_ID, alphaCutoffByte, type AlphaModeId } from '@modelshot/looks';
import {
  meshVisible,
  nodeVisibility,
  resolveMaterialAlpha,
  type SceneDocument,
  type SceneMesh,
  type SceneMeshGroup,
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
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly uvRects: Float32Array;
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
}

function alphaOf(doc: SceneDocument, group: SceneMeshGroup, texture: number): BatchAlpha {
  if (texture < 0) return { modeId: ALPHA_MODE_ID.opaque, cutoffByte: 0 };
  const rule = resolveMaterialAlpha(doc.materials[group.material]);
  return { modeId: ALPHA_MODE_ID[rule.mode], cutoffByte: alphaCutoffByte(rule.cutoff) };
}

function merge(key: BatchKey, parts: readonly Part[]): SceneBatch {
  const bases = new Map<SceneMesh, number>();
  let vertices = 0;
  let indexCount = 0;
  for (const { mesh, group } of parts) {
    if (!bases.has(mesh)) {
      bases.set(mesh, vertices);
      vertices += mesh.positions.length / 3;
    }
    indexCount += group.count;
  }
  const batch = {
    ...key,
    positions: new Float32Array(vertices * 3),
    normals: new Float32Array(vertices * 3),
    uvs: new Float32Array(vertices * 2),
    uvRects: new Float32Array(vertices * 4),
    indices: new Uint32Array(indexCount),
  };
  for (const [mesh, base] of bases) {
    batch.positions.set(mesh.positions, base * 3);
    batch.normals.set(mesh.normals, base * 3);
    batch.uvs.set(mesh.uvs, base * 2);
    batch.uvRects.set(mesh.uvRects, base * 4);
  }
  let at = 0;
  for (const { mesh, group } of parts) {
    const base = bases.get(mesh) ?? 0;
    const source = mesh.indices.subarray(group.start, group.start + group.count);
    for (let i = 0; i < source.length; i++) batch.indices[at + i] = (source[i] ?? 0) + base;
    at += source.length;
  }
  return batch;
}

/**
 * Groups the visible triangles of a validated document by (node, texture, alpha mode, cutoff byte, sidedness, render
 * order), in order of first appearance; within a batch triangles keep the document's mesh and group order.
 */
export function batchScene(doc: SceneDocument): SceneBatch[] {
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
      };
      const id = [key.node, key.texture, key.alpha.modeId, key.alpha.cutoffByte, key.doubleSided, key.renderOrder].join(
        ':',
      );
      let entry = parts.get(id);
      if (!entry) {
        entry = { key, parts: [] };
        parts.set(id, entry);
      }
      entry.parts.push({ mesh, group });
    }
  });
  return [...parts.values()].map((entry) => merge(entry.key, entry.parts));
}
