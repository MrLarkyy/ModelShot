import {
  mat4NodeLocal,
  mat4TransformDirection,
  mat4TransformPoint,
  type SceneMesh,
  type SceneMeshGroup,
  type Vec3,
} from '@modelshot/scene';
import { compareGroupKey } from './GroupKey';
import type { MeshSpec } from './MeshSpec';
import { blockbenchFaceNormal, triangulateFace } from '../geometry/triangulateFace';

const NO_TRANSLATION = [0, 0, 0] as const;

/**
 * Triangles of a Blockbench mesh: every face gets its own vertices, placed at `origin + v` rotated about `origin` (as
 * a cube's), and faces are grouped by material and sidedness. Flat shading gives each vertex its face's normal; smooth
 * shading the vertex key's normal (see `smoothNormals`). Faces that triangulate to nothing (zero area) are left out.
 */
export function meshElementToMesh(mesh: MeshSpec, node: number): SceneMesh {
  const transform = mat4NodeLocal(NO_TRANSLATION, mesh.origin, mesh.rotation);
  const faces = mesh.faces
    .map((face) => ({ face, triangulation: triangulateFace(face.positions) }))
    .filter(({ triangulation }) => triangulation.triangles.length > 0)
    .sort((a, b) => compareGroupKey(a.face, b.face));
  const vertexCount = faces.reduce((sum, { face }) => sum + face.positions.length, 0);
  const indexCount = faces.reduce((sum, { triangulation }) => sum + triangulation.triangles.length, 0);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const uvRects = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(indexCount);
  const groups: SceneMeshGroup[] = [];
  const smooth = mesh.shading === 'smooth' ? smoothNormals(mesh) : undefined;

  let base = 0;
  let start = 0;
  for (const { face, triangulation } of faces) {
    const faceNormal = mat4TransformDirection(transform, triangulation.normal);
    const us = face.uvs.map(([u]) => u);
    const vs = face.uvs.map(([, v]) => v);
    const rect = [
      Math.min(...us) / face.uvWidth,
      Math.min(...vs) / face.uvHeight,
      Math.max(...us) / face.uvWidth,
      Math.max(...vs) / face.uvHeight,
    ];
    face.positions.forEach((p, k) => {
      const vertex = base + k;
      const absolute = [mesh.origin[0] + p[0], mesh.origin[1] + p[1], mesh.origin[2] + p[2]] as const;
      positions.set(mat4TransformPoint(transform, absolute), vertex * 3);
      const keyNormal = smooth?.get(face.keys[k] ?? '');
      normals.set(keyNormal ? mat4TransformDirection(transform, keyNormal) : faceNormal, vertex * 3);
      const [u = 0, v = 0] = face.uvs[k] ?? [];
      uvs.set([u / face.uvWidth, v / face.uvHeight], vertex * 2);
      uvRects.set(rect, vertex * 4);
    });
    indices.set(
      triangulation.triangles.map((k) => base + k),
      start,
    );
    const count = triangulation.triangles.length;
    const last = groups[groups.length - 1];
    if (last && last.material === face.material && last.doubleSided === face.doubleSided) {
      groups[groups.length - 1] = { ...last, count: last.count + count };
    } else groups.push({ material: face.material, start, count, doubleSided: face.doubleSided });
    base += face.positions.length;
    start += count;
  }

  return {
    name: mesh.name,
    sourceId: mesh.sourceId,
    node,
    visible: mesh.visible,
    renderOrder: mesh.renderOrder,
    positions,
    normals,
    uvs,
    uvRects,
    indices,
    groups,
  };
}

/**
 * Blockbench's `calculateNormals` for `shading: "smooth"`: per vertex key, the plain average of the unit normals
 * (`blockbenchFaceNormal`) of every face of 3 or more vertices that lists the key, unweighted by area or angle (a
 * zero-area face adds a zero normal), then normalised. A key whose average is zero keeps its faces' own normals.
 */
function smoothNormals(mesh: MeshSpec): Map<string, Vec3> {
  const sums = new Map<string, [number, number, number]>();
  for (const face of mesh.faces) {
    const n = blockbenchFaceNormal(face.positions);
    for (const key of face.keys) {
      const sum = sums.get(key) ?? [0, 0, 0];
      sums.set(key, [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]]);
    }
  }
  const normals = new Map<string, Vec3>();
  for (const [key, [x, y, z]] of sums) {
    const length = Math.hypot(x, y, z);
    if (length > 1e-9) normals.set(key, [x / length, y / length, z / length]);
  }
  return normals;
}
