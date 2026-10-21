import {
  EDGE_SLOTS,
  NO_EDGE,
  sceneSharpEdges,
  normalMatrixTransform,
  mat4NormalMatrix,
  mat4TransformPoint,
  meshVisible,
  nodeVisibility,
  worldMatrices,
  type Mat4,
  type SceneDocument,
  type SharpEdgeOptions,
} from '@modelshot/scene';
import { PathTracerError } from './PathTracerError';

/** Every visible triangle of a scene in world space, in mesh and group order: what the BVH is built over. */
export interface FlatScene {
  readonly count: number;
  /** 9 per triangle: three world-space corners. */
  readonly positions: Float32Array;
  /** 9 per triangle: unit world-space vertex normals. */
  readonly normals: Float32Array;
  /** 6 per triangle. */
  readonly uvs: Float32Array;
  /** 4 per triangle: the face's UV rectangle. */
  readonly uvRects: Float32Array;
  /** Per triangle: index into `SceneDocument.materials`, −1 for none. */
  readonly materials: Int32Array;
  /** Per triangle: 1 for a double-sided face. */
  readonly doubleSided: Uint8Array;
  /** Per triangle: the mesh's `renderOrder` (absent: 0). */
  readonly renderOrders: Float32Array;
  /** 2 per triangle: the index of its mesh in `SceneDocument.meshes` and of its first index in that mesh's `indices`. */
  readonly sources: Uint32Array;
  /**
   * 12 per triangle: per corner the distances to its four sharp-edge slots (`SharpEdgeAttributes.distances`), `NO_EDGE`
   * without edge detection.
   */
  readonly edgeDistances: Float32Array;
  /** 4 per triangle: the slots' signed angles (`SharpEdgeAttributes.angles`), 0 without edge detection. */
  readonly edgeAngles: Float32Array;
  /** Triangles left out: a non-finite position, normal, UV or UV rectangle, or no area. */
  readonly skipped: number;
}

export const DEFAULT_MAX_TRIANGLES = 200_000;

const finite = (values: ArrayLike<number>, start: number, count: number): boolean => {
  for (let i = start; i < start + count; i++) if (!Number.isFinite(values[i])) return false;
  return true;
};

/**
 * Sharp-edge distances and angles (`sceneSharpEdges` of the document, looked up once) of the triangles listed in `sources`
 * (`FlatScene.sources`); `null` options fill empty slots. Distances are in the mesh's rest space, as the preview's
 * vertex attributes are, so an animated node scale widens or narrows the edge band alike in both renderers.
 */
export function flatEdges(
  doc: SceneDocument,
  sources: Uint32Array,
  edges: SharpEdgeOptions | null,
): Pick<FlatScene, 'edgeDistances' | 'edgeAngles'> {
  const count = Math.floor(sources.length / 2);
  const edgeDistances = new Float32Array(count * 3 * EDGE_SLOTS).fill(NO_EDGE);
  const edgeAngles = new Float32Array(count * EDGE_SLOTS);
  if (!edges) return { edgeDistances, edgeAngles };
  const byMesh = sceneSharpEdges(doc.meshes, edges);
  for (let t = 0; t < count; t++) {
    const attributes = byMesh[sources[t * 2] ?? 0];
    if (!attributes) continue;
    const first = sources[t * 2 + 1] ?? 0;
    for (let c = 0; c < 3; c++) {
      const v = attributes.indices[first + c] ?? 0;
      edgeDistances.set(attributes.distances.subarray(v * EDGE_SLOTS, v * EDGE_SLOTS + EDGE_SLOTS), (t * 3 + c) * 4);
    }
    const v0 = attributes.indices[first] ?? 0;
    edgeAngles.set(attributes.angles.subarray(v0 * EDGE_SLOTS, v0 * EDGE_SLOTS + EDGE_SLOTS), t * 4);
  }
  return { edgeDistances, edgeAngles };
}

/**
 * The visible triangles of `doc` (a mesh's own flag and its node's effective visibility, groups only) placed by their
 * node's world matrix, with sharp-edge data under `edges` (`null`: none, as the light bake needs). Over `maxTriangles`
 * throws `PathTracerError` `SCENE_TOO_LARGE` before allocating anything. `doc` must have passed `validateScene`
 * (indices and lengths are trusted, numbers are not).
 */
export function flattenScene(
  doc: SceneDocument,
  maxTriangles = DEFAULT_MAX_TRIANGLES,
  edges: SharpEdgeOptions | null = null,
): FlatScene {
  const visibility = nodeVisibility(doc);
  const visibleMeshes = doc.meshes.map((_, m) => meshVisible(doc, m, visibility));
  let total = 0;
  doc.meshes.forEach((mesh, m) => {
    if (visibleMeshes[m]) for (const group of mesh.groups) total += group.count / 3;
  });
  if (total > maxTriangles) {
    throw new PathTracerError('SCENE_TOO_LARGE', `scene has ${total} visible triangles; the limit is ${maxTriangles}`);
  }

  const world = worldMatrices(doc.nodes);
  const positions = new Float32Array(total * 9);
  const normals = new Float32Array(total * 9);
  const uvs = new Float32Array(total * 6);
  const uvRects = new Float32Array(total * 4);
  const materials = new Int32Array(total);
  const doubleSided = new Uint8Array(total);
  const renderOrders = new Float32Array(total);
  const sources = new Uint32Array(total * 2);
  let count = 0;
  let skipped = 0;
  const corner: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  doc.meshes.forEach((mesh, m) => {
    if (!visibleMeshes[m]) return;
    const matrix: Mat4 | undefined = mesh.node >= 0 ? world[mesh.node] : undefined;
    const normalMatrix = matrix ? mat4NormalMatrix(matrix) : undefined;
    const order = mesh.renderOrder ?? 0;
    for (const group of mesh.groups) {
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const v = [mesh.indices[i] ?? 0, mesh.indices[i + 1] ?? 0, mesh.indices[i + 2] ?? 0];
        // Every vertex of a face carries the face's rectangle; the last one is what the preview's flat varying reads.
        const rectVertex = v[2] ?? 0;
        let ok = finite(mesh.uvRects, rectVertex * 4, 4);
        for (const k of v) {
          ok &&= finite(mesh.positions, k * 3, 3) && finite(mesh.normals, k * 3, 3) && finite(mesh.uvs, k * 2, 2);
        }
        if (!ok) {
          skipped++;
          continue;
        }
        v.forEach((k, c) => {
          const p: [number, number, number] = [
            mesh.positions[k * 3] ?? 0,
            mesh.positions[k * 3 + 1] ?? 0,
            mesh.positions[k * 3 + 2] ?? 0,
          ];
          corner[c] = matrix ? mat4TransformPoint(matrix, p) : p;
        });
        const [a, b, c] = corner as [[number, number, number], [number, number, number], [number, number, number]];
        // Finite in double precision but beyond float range would become Infinity in the GPU data.
        if (![...a, ...b, ...c].every((x) => Number.isFinite(Math.fround(x)))) {
          skipped++;
          continue;
        }
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const area = Math.hypot(
          (e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0),
          (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0),
          (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0),
        );
        if (!(area > 0) || !Number.isFinite(area)) {
          skipped++;
          continue;
        }
        v.forEach((k, j) => {
          positions.set(corner[j] ?? [0, 0, 0], count * 9 + j * 3);
          const n: [number, number, number] = [
            mesh.normals[k * 3] ?? 0,
            mesh.normals[k * 3 + 1] ?? 0,
            mesh.normals[k * 3 + 2] ?? 0,
          ];
          // The same normal matrix as the preview's u_normalMatrix, so both renderers shade a scaled node alike.
          const w = normalMatrix ? normalMatrixTransform(normalMatrix, n) : n;
          const length = Math.hypot(w[0], w[1], w[2]);
          normals.set(length > 0 ? [w[0] / length, w[1] / length, w[2] / length] : [0, 0, 0], count * 9 + j * 3);
          uvs[count * 6 + j * 2] = mesh.uvs[k * 2] ?? 0;
          uvs[count * 6 + j * 2 + 1] = mesh.uvs[k * 2 + 1] ?? 0;
        });
        for (let r = 0; r < 4; r++) uvRects[count * 4 + r] = mesh.uvRects[rectVertex * 4 + r] ?? 0;
        materials[count] = group.material;
        doubleSided[count] = group.doubleSided === true ? 1 : 0;
        renderOrders[count] = order;
        sources[count * 2] = m;
        sources[count * 2 + 1] = i;
        count++;
      }
    }
  });

  const flatSources = sources.subarray(0, count * 2);
  return {
    count,
    positions: positions.subarray(0, count * 9),
    normals: normals.subarray(0, count * 9),
    uvs: uvs.subarray(0, count * 6),
    uvRects: uvRects.subarray(0, count * 4),
    materials: materials.subarray(0, count),
    doubleSided: doubleSided.subarray(0, count),
    renderOrders: renderOrders.subarray(0, count),
    sources: flatSources,
    ...flatEdges(doc, flatSources, edges),
    skipped,
  };
}
