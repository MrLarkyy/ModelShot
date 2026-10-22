import {
  mat4NodeLocal,
  mat4TransformDirection,
  mat4TransformPoint,
  type SceneMesh,
  type SceneMeshGroup,
  type Vec3,
} from '@modelshot/scene';
import { faceCornerPositions, faceNormal, type FaceDirection } from './CubeFace';
import type { CubeSpec } from './CubeSpec';
import { faceCornerUvs, faceUvRect } from './faceUv';
import { compareGroupKey } from './GroupKey';

const NO_TRANSLATION = [0, 0, 0] as const;

/**
 * Four vertices and two triangles per face, the cube's rotation about its origin baked in. Faces are ordered by
 * material, then single- before double-sided, so each such pair is one group. Corners are top-left, top-right,
 * bottom-right, bottom-left seen from outside; the triangles (TL, BL, BR) and (TL, BR, TR) are therefore
 * counter-clockwise from outside whatever the UVs.
 * On a reversed axis (`CubeSpec.reversed`) the corners are mirrored about the box centre before the rotation, as
 * Blockbench's `setShape` does, keeping their UVs and the triangle order: an odd number of reversed axes turns every
 * face inward (an inverted hull, seen only from inside or as a rim), an even number leaves an outward box with each
 * face's texture on the opposite side. The normal is the face's geometric front either way; Blockbench keeps the
 * fixed per-face normal, which disagrees with its winding where exactly one other axis is reversed.
 * A face on a texture of `textureFrameCounts[frameTexture ?? material]` frames (absent: 1) maps into frame 0: v is
 * divided by the count after normalising, Blockbench's `updateUV` order.
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
  const { min, max, reversed } = cube;
  const low: Vec3 = [reversed[0] ? max[0] : min[0], reversed[1] ? max[1] : min[1], reversed[2] ? max[2] : min[2]];
  const high: Vec3 = [reversed[0] ? min[0] : max[0], reversed[1] ? min[1] : max[1], reversed[2] ? min[2] : max[2]];
  const odd = reversed.filter(Boolean).length % 2 === 1;

  faces.forEach((face, f) => {
    const normal = mat4TransformDirection(rotation, geometricFront(face.direction, reversed, odd));
    const corners = faceCornerPositions(face.direction, low, high);
    const cornerUvs = faceCornerUvs(face.uv, face.rotation);
    const [uMin, vMin, uMax, vMax] = faceUvRect(face.uv);
    const frames = textureFrameCounts[face.frameTexture ?? face.material] ?? 1;
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
    const cameraOnly = face.cameraOnly === true;
    if (
      last &&
      last.material === face.material &&
      last.doubleSided === face.doubleSided &&
      (last.cameraOnly === true) === cameraOnly
    ) {
      groups[groups.length - 1] = { ...last, count: last.count + 6 };
    } else {
      const group = { material: face.material, start: f * 6, count: 6, doubleSided: face.doubleSided };
      groups.push(cameraOnly ? { ...group, cameraOnly } : group);
    }
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

/**
 * The outward normal of the face's key, flipped where the mirroring turned its winding: once per reversed axis in the
 * face's plane, which is the reversed count with the face's own axis left out.
 */
function geometricFront(direction: FaceDirection, reversed: readonly boolean[], odd: boolean): Vec3 {
  const normal = faceNormal(direction);
  const ownAxis = normal.findIndex((x) => x !== 0);
  const flip = odd !== (reversed[ownAxis] ?? false);
  return flip ? [-normal[0] || 0, -normal[1] || 0, -normal[2] || 0] : normal;
}
