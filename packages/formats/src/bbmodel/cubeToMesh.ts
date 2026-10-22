import {
  mat4NodeLocal,
  mat4TransformDirection,
  mat4TransformPoint,
  type SceneMesh,
  type SceneMeshGroup,
} from '@modelshot/scene';
import { faceCornerPositions, faceNormal } from './CubeFace';
import type { CubeSpec } from './CubeSpec';
import { faceCornerUvs, faceUvRect } from './faceUv';
import { compareGroupKey } from './GroupKey';

const NO_TRANSLATION = [0, 0, 0] as const;

/**
 * Four vertices and two triangles per face, the cube's rotation about its origin baked in. Faces are ordered by
 * material, then single- before double-sided, so each such pair is one group. Corners are top-left, top-right, bottom-right, bottom-left seen from
 * outside; the triangles (TL, BL, BR) and (TL, BR, TR) are therefore counter-clockwise from outside whatever the UVs.
 * A face on a texture of `textureFrameCounts[material]` frames (absent: 1) maps into frame 0: v is divided by the count
 * after normalising, Blockbench's `updateUV` order.
 */
export function cubeToMesh(cube: CubeSpec, node: number, textureFrameCounts: readonly number[] = []): SceneMesh {
  const faces = [...cube.faces].sort(compareGroupKey);
  const vertexCount = faces.length * 4;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const uvRects = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(faces.length * 6);
  const groups: SceneMeshGroup[] = [];
  const rotation = mat4NodeLocal(NO_TRANSLATION, cube.origin, cube.rotation);

  faces.forEach((face, f) => {
    const normal = mat4TransformDirection(rotation, faceNormal(face.direction));
    const corners = faceCornerPositions(face.direction, cube.min, cube.max);
    const cornerUvs = faceCornerUvs(face.uv, face.rotation);
    const [uMin, vMin, uMax, vMax] = faceUvRect(face.uv);
    const frames = textureFrameCounts[face.material] ?? 1;
    const rect = [
      uMin / face.uvWidth,
      vMin / face.uvHeight / frames,
      uMax / face.uvWidth,
      vMax / face.uvHeight / frames,
    ];
    corners.forEach((corner, c) => {
      const vertex = f * 4 + c;
      positions.set(mat4TransformPoint(rotation, corner), vertex * 3);
      normals.set(normal, vertex * 3);
      const [u = 0, v = 0] = cornerUvs[c] ?? [];
      uvs.set([u / face.uvWidth, v / face.uvHeight / frames], vertex * 2);
      uvRects.set(rect, vertex * 4);
    });
    const base = f * 4;
    indices.set([base, base + 3, base + 2, base, base + 2, base + 1], f * 6);
    const last = groups[groups.length - 1];
    if (last && last.material === face.material && last.doubleSided === face.doubleSided) {
      groups[groups.length - 1] = { ...last, count: last.count + 6 };
    } else groups.push({ material: face.material, start: f * 6, count: 6, doubleSided: face.doubleSided });
  });

  return {
    name: cube.name,
    sourceId: cube.sourceId,
    node,
    visible: cube.visible,
    renderOrder: cube.renderOrder,
    positions,
    normals,
    uvs,
    uvRects,
    indices,
    groups,
  };
}
