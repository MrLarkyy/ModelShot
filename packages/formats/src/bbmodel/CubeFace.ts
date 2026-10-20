import type { Vec3 } from '@modelshot/scene';

export type FaceDirection = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';

/** Blockbench's face order; north is −Z, east +X, south +Z, west −X, up +Y, down −Y. */
export const FACE_DIRECTIONS: readonly FaceDirection[] = ['north', 'east', 'south', 'west', 'up', 'down'];

const NORMALS: Readonly<Record<FaceDirection, Vec3>> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

// Corners top-left, top-right, bottom-right, bottom-left of the face seen from outside, as [x, y, z] picks between
// min (0) and max (1). Side faces have +Y up; up has north at the top, down has south at the top (Minecraft and
// Blockbench convention), so a face's uv [u1, v1, u2, v2] maps u1,v1 to the top-left corner.
const CORNERS: Readonly<Record<FaceDirection, readonly (readonly [0 | 1, 0 | 1, 0 | 1])[]>> = {
  north: [
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 0],
    [1, 0, 0],
  ],
  east: [
    [1, 1, 1],
    [1, 1, 0],
    [1, 0, 0],
    [1, 0, 1],
  ],
  south: [
    [0, 1, 1],
    [1, 1, 1],
    [1, 0, 1],
    [0, 0, 1],
  ],
  west: [
    [0, 1, 0],
    [0, 1, 1],
    [0, 0, 1],
    [0, 0, 0],
  ],
  up: [
    [0, 1, 0],
    [1, 1, 0],
    [1, 1, 1],
    [0, 1, 1],
  ],
  down: [
    [0, 0, 1],
    [1, 0, 1],
    [1, 0, 0],
    [0, 0, 0],
  ],
};

export function faceNormal(direction: FaceDirection): Vec3 {
  return NORMALS[direction];
}

/** The four corners in order top-left, top-right, bottom-right, bottom-left; that order is clockwise from outside. */
export function faceCornerPositions(direction: FaceDirection, min: Vec3, max: Vec3): Vec3[] {
  return CORNERS[direction].map(
    ([x, y, z]) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]] as const,
  );
}

/** Area of the face of an axis-aligned box from `min` to `max`. */
export function faceArea(direction: FaceDirection, min: Vec3, max: Vec3): number {
  const [dx, dy, dz] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (direction === 'north' || direction === 'south') return dx * dy;
  if (direction === 'east' || direction === 'west') return dz * dy;
  return dx * dz;
}
