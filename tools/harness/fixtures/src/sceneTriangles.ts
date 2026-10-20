import {
  mat4Identity,
  mat4TransformDirection,
  mat4TransformPoint,
  worldMatrices,
  type SceneDocument,
} from '@modelshot/scene';

/**
 * Every visible triangle of a scene in world space, unindexed, ordered by render order, then single- before
 * double-sided, so each run draws with one cull mode and later runs win depth ties.
 */
export interface SceneTriangles {
  readonly count: number;
  /** 9 floats per triangle. */
  readonly positions: Float32Array;
  /** 9 floats per triangle (one normal per corner). */
  readonly normals: Float32Array;
  /** 6 floats per triangle. */
  readonly uvs: Float32Array;
  /** 4 floats per triangle: the face's UV rectangle. */
  readonly rects: Float32Array;
  /** Draw-material slot per triangle: 0 untextured, `m + 1` for scene material `m`. */
  readonly materials: Int32Array;
  readonly doubleSided: Uint8Array;
  readonly renderOrders: Int32Array;
  /** Index into `scene.meshes` per triangle. */
  readonly meshes: Int32Array;
  /** Consecutive triangles sharing render order and sidedness. */
  readonly runs: readonly TriangleRun[];
}

export interface TriangleRun {
  readonly first: number;
  readonly count: number;
  readonly doubleSided: boolean;
  readonly renderOrder: number;
}

interface Source {
  mesh: number;
  triangle: number;
  material: number;
  doubleSided: boolean;
  renderOrder: number;
}

export function sceneTriangles(scene: SceneDocument): SceneTriangles {
  const world = worldMatrices(scene.nodes);
  const nodeVisible = scene.nodes.map((node) => node.visible);
  scene.nodes.forEach((node, i) => {
    if (node.parent >= 0 && !nodeVisible[node.parent]) nodeVisible[i] = false;
  });
  const sources: Source[] = [];
  scene.meshes.forEach((mesh, m) => {
    if (!mesh.visible || (mesh.node >= 0 && !nodeVisible[mesh.node])) return;
    for (const group of mesh.groups) {
      for (let t = group.start / 3; t < (group.start + group.count) / 3; t++) {
        sources.push({
          mesh: m,
          triangle: t,
          material: group.material + 1,
          doubleSided: group.doubleSided ?? false,
          renderOrder: mesh.renderOrder ?? 0,
        });
      }
    }
  });
  sources.sort((a, b) => a.renderOrder - b.renderOrder || Number(a.doubleSided) - Number(b.doubleSided));

  const count = sources.length;
  const out = {
    count,
    positions: new Float32Array(count * 9),
    normals: new Float32Array(count * 9),
    uvs: new Float32Array(count * 6),
    rects: new Float32Array(count * 4),
    materials: new Int32Array(count),
    doubleSided: new Uint8Array(count),
    renderOrders: new Int32Array(count),
    meshes: new Int32Array(count),
  };
  const runs: TriangleRun[] = [];
  sources.forEach((source, i) => {
    const mesh = scene.meshes[source.mesh];
    if (!mesh) return;
    const matrix = mesh.node >= 0 ? (world[mesh.node] ?? mat4Identity()) : mat4Identity();
    for (let c = 0; c < 3; c++) {
      const v = mesh.indices[source.triangle * 3 + c] ?? 0;
      const at = (array: Float32Array, size: number, k: number): number => array[v * size + k] ?? 0;
      const p = mat4TransformPoint(matrix, [
        at(mesh.positions, 3, 0),
        at(mesh.positions, 3, 1),
        at(mesh.positions, 3, 2),
      ]);
      const n = mat4TransformDirection(matrix, [
        at(mesh.normals, 3, 0),
        at(mesh.normals, 3, 1),
        at(mesh.normals, 3, 2),
      ]);
      out.positions.set(p, i * 9 + c * 3);
      out.normals.set(n, i * 9 + c * 3);
      out.uvs.set([at(mesh.uvs, 2, 0), at(mesh.uvs, 2, 1)], i * 6 + c * 2);
      if (c === 0)
        out.rects.set(
          [0, 1, 2, 3].map((k) => at(mesh.uvRects, 4, k)),
          i * 4,
        );
    }
    out.materials[i] = source.material;
    out.doubleSided[i] = source.doubleSided ? 1 : 0;
    out.renderOrders[i] = source.renderOrder;
    out.meshes[i] = source.mesh;
    const last = runs[runs.length - 1];
    if (last && last.doubleSided === source.doubleSided && last.renderOrder === source.renderOrder) {
      runs[runs.length - 1] = { ...last, count: last.count + 1 };
    } else runs.push({ first: i, count: 1, doubleSided: source.doubleSided, renderOrder: source.renderOrder });
  });
  return { ...out, runs };
}
