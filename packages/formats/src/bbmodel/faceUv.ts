import type { Vec3 } from '@modelshot/scene';
import type { FaceDirection } from './CubeFace';

/** A Blockbench face `uv`: `[u1, v1, u2, v2]` in texture UV units; u1 > u2 or v1 > v2 mirrors the face. */
export type FaceUv = readonly [number, number, number, number];

export type FaceRotation = 0 | 90 | 180 | 270;

/**
 * UVs for the face corners top-left, top-right, bottom-right, bottom-left (see `faceCornerPositions`). Unrotated,
 * the top-left corner gets (u1, v1) and the bottom-right (u2, v2), so a mirrored uv mirrors the image without touching
 * geometry. `rotation` turns the image clockwise on the face, as Blockbench does.
 */
export function faceCornerUvs(uv: FaceUv, rotation: FaceRotation): [number, number][] {
  const [u1, v1, u2, v2] = uv;
  const corners: [number, number][] = [
    [u1, v1],
    [u2, v1],
    [u2, v2],
    [u1, v2],
  ];
  const steps = rotation / 90;
  return corners.map((_, i) => corners[(i - steps + 4) % 4] ?? [u1, v1]);
}

/** `[uMin, vMin, uMax, vMax]` of a face uv, whatever its mirroring. */
export function faceUvRect(uv: FaceUv): [number, number, number, number] {
  const [u1, v1, u2, v2] = uv;
  return [Math.min(u1, u2), Math.min(v1, v2), Math.max(u1, u2), Math.max(v1, v2)];
}

/**
 * Face rotation in degrees from the file, normalised to a quarter turn; `undefined` when it is not one (Blockbench
 * only offers quarter turns).
 */
export function toFaceRotation(degrees: number): FaceRotation | undefined {
  const turn = ((degrees % 360) + 360) % 360;
  return turn === 0 || turn === 90 || turn === 180 || turn === 270 ? turn : undefined;
}

/**
 * Box-UV layout (Minecraft entity style) for a cube of `size` (floored to whole units) at `offset`, reproducing
 * Blockbench's per-face uv. `mirror` flips every face horizontally and swaps east and west.
 */
export function boxUvLayout(
  size: Vec3,
  offset: readonly [number, number],
  mirror: boolean,
): Record<FaceDirection, FaceUv> {
  const [x, y, z] = size;
  const faces: { direction: FaceDirection; from: [number, number]; size: [number, number] }[] = [
    { direction: 'east', from: [0, z], size: [z, y] },
    { direction: 'west', from: [z + x, z], size: [z, y] },
    { direction: 'up', from: [z + x, z], size: [-x, -z] },
    { direction: 'down', from: [z + 2 * x, 0], size: [-x, z] },
    { direction: 'south', from: [2 * z + x, z], size: [x, y] },
    { direction: 'north', from: [z, z], size: [x, y] },
  ];
  if (mirror) {
    for (const face of faces) {
      face.from[0] += face.size[0];
      face.size[0] = -face.size[0];
    }
    const [east, west] = faces;
    if (east && west) [east.direction, west.direction] = [west.direction, east.direction];
  }
  const layout = {} as Record<FaceDirection, FaceUv>;
  for (const face of faces) {
    const u = face.from[0] + offset[0];
    const v = face.from[1] + offset[1];
    layout[face.direction] = [u, v, u + face.size[0], v + face.size[1]];
  }
  return layout;
}
