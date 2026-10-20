import {
  mat4NodeLocal,
  mat4TransformDirection,
  mat4TransformPoint,
  type SceneMesh,
  type SceneMeshGroup,
} from '@modelshot/scene';
import { compareGroupKey } from './GroupKey';
import type { MeshSpec } from './MeshSpec';
import { triangulateFace } from './triangulateFace';

const NO_TRANSLATION = [0, 0, 0] as const;

/**
 * Flat-shaded triangles of a Blockbench mesh: every face gets its own vertices with the face normal, its vertices are
 * `origin + v` rotated about `origin` (as a cube's), and faces are grouped by material and sidedness. Faces that
 * triangulate to nothing (zero area) are left out.
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

  let base = 0;
  let start = 0;
  for (const { face, triangulation } of faces) {
    const normal = mat4TransformDirection(transform, triangulation.normal);
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
      normals.set(normal, vertex * 3);
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
