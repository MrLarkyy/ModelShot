import { describe, expect, it } from 'vitest';
import { FACE_DIRECTIONS, faceCornerPositions, faceNormal } from '../../src/bbmodel/CubeFace';
import { boxUvLayout, faceCornerUvs, faceUvRect, toFaceRotation } from '../../src/bbmodel/faceUv';
import { BbmodelError, loadBbmodel } from '../../src/index';
import { cube, model } from './fixtures';

const UNIT_MIN = [0, 0, 0] as const;
const UNIT_MAX = [1, 1, 1] as const;

function sub(a: readonly number[], b: readonly number[]): number[] {
  return a.map((x, i) => x - (b[i] ?? 0));
}

function cross(a: readonly number[], b: readonly number[]): number[] {
  const [ax = 0, ay = 0, az = 0] = a;
  const [bx = 0, by = 0, bz = 0] = b;
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

describe('face corner table (Minecraft / Blockbench convention)', () => {
  it.each([
    // [direction, top-left, top-right, bottom-right, bottom-left] of a unit cube seen from outside
    ['north', [1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]],
    ['east', [1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]],
    ['south', [0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]],
    ['west', [0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]],
    ['up', [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
    ['down', [0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]],
  ] as const)('%s', (direction, ...corners) => {
    expect(faceCornerPositions(direction, UNIT_MIN, UNIT_MAX)).toEqual(corners);
  });

  it('orders corners clockwise seen from outside, so (TL, BL, BR) faces outwards', () => {
    for (const direction of FACE_DIRECTIONS) {
      const [tl = [], , br = [], bl = []] = faceCornerPositions(direction, UNIT_MIN, UNIT_MAX);
      expect(cross(sub(bl, tl), sub(br, tl)).map((x) => x || 0)).toEqual([...faceNormal(direction)].map((x) => x || 0));
    }
  });
});

describe('faceCornerUvs', () => {
  const uv = [0, 0, 8, 4] as const;

  it('maps u1,v1 to the top-left and u2,v2 to the bottom-right corner', () => {
    expect(faceCornerUvs(uv, 0)).toEqual([
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ]);
  });

  it('turns the image clockwise: at 90 the top-left corner shows what was bottom-left', () => {
    expect(faceCornerUvs(uv, 90)).toEqual([
      [0, 4],
      [0, 0],
      [8, 0],
      [8, 4],
    ]);
    expect(faceCornerUvs(uv, 180)).toEqual([
      [8, 4],
      [0, 4],
      [0, 0],
      [8, 0],
    ]);
    expect(faceCornerUvs(uv, 270)).toEqual([
      [8, 0],
      [8, 4],
      [0, 4],
      [0, 0],
    ]);
  });

  it('mirrors through swapped coordinates', () => {
    expect(faceCornerUvs([8, 0, 0, 4], 0)).toEqual([
      [8, 0],
      [0, 0],
      [0, 4],
      [8, 4],
    ]);
    expect(faceCornerUvs([0, 4, 8, 0], 0)).toEqual([
      [0, 4],
      [8, 4],
      [8, 0],
      [0, 0],
    ]);
  });

  it('gives the same rect whatever the mirroring', () => {
    expect(faceUvRect([8, 4, 0, 0])).toEqual([0, 0, 8, 4]);
    expect(faceUvRect([0, 4, 8, 0])).toEqual([0, 0, 8, 4]);
  });
});

describe('toFaceRotation', () => {
  it('accepts quarter turns modulo 360 only', () => {
    expect(toFaceRotation(0)).toBe(0);
    expect(toFaceRotation(450)).toBe(90);
    expect(toFaceRotation(-90)).toBe(270);
    expect(toFaceRotation(45)).toBeUndefined();
  });

  it('a 45° face rotation in a file is INVALID_FIELD at the face', () => {
    const faces = { north: { uv: [0, 0, 1, 1], rotation: 45 } };
    const error = catchError(() => loadBbmodel(JSON.stringify(model({ elements: [cube({ faces })] }))));
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.path).toBe('$.elements[0].faces.north.rotation');
  });
});

describe('boxUvLayout', () => {
  it('lays a 4×6×2 cube out like Blockbench (Minecraft entity layout)', () => {
    expect(boxUvLayout([4, 6, 2], [0, 0], false)).toEqual({
      east: [0, 2, 2, 8],
      north: [2, 2, 6, 8],
      west: [6, 2, 8, 8],
      south: [8, 2, 12, 8],
      up: [6, 2, 2, 0],
      down: [10, 0, 6, 2],
    });
  });

  it('shifts by the offset and, mirrored, flips every face and swaps east and west', () => {
    expect(boxUvLayout([2, 6, 2], [12, 0], true)).toEqual({
      west: [14, 2, 12, 8],
      north: [16, 2, 14, 8],
      east: [18, 2, 16, 8],
      south: [20, 2, 18, 8],
      up: [14, 2, 16, 0],
      down: [16, 0, 18, 2],
    });
  });

  it('is used for box-UV faces without uv; size is floored and ignores inflate', () => {
    const faces = { north: {}, up: {} };
    const element = cube({ from: [0, 0, 0], to: [4.5, 6, 2], inflate: 1, faces, box_uv: true, uv_offset: [1, 1] });
    const { scene } = loadBbmodel(
      JSON.stringify(model({ elements: [element], resolution: { width: 32, height: 16 } })),
    );
    const rects = scene.meshes[0]?.uvRects;
    // north of the floored 4×6×2 box at offset (1, 1): [3, 3, 7, 9] in 32×16 uv units.
    expect([...(rects ?? []).slice(0, 4)]).toEqual([3 / 32, 3 / 16, 7 / 32, 9 / 16]);
  });
});

function catchError(run: () => unknown): BbmodelError {
  try {
    run();
  } catch (error) {
    if (error instanceof BbmodelError) return error;
    throw error;
  }
  throw new Error('expected a BbmodelError');
}
