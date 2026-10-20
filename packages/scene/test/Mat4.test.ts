import { describe, expect, it } from 'vitest';
import {
  mat4Identity,
  mat4Multiply,
  mat4NodeLocal,
  mat4Rotation,
  mat4TransformDirection,
  mat4TransformPoint,
  worldMatrices,
  type SceneNode,
  type Vec3,
} from '../src/index';

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i] ?? NaN, 12));
}

function node(parent: number, pivot: Vec3, rotation: Vec3, translation: Vec3 = [0, 0, 0]): SceneNode {
  return { name: 'n', sourceId: '', parent, children: [], pivot, rotation, translation, visible: true, meshes: [] };
}

describe('Mat4', () => {
  it('identity leaves points alone and is neutral in multiply', () => {
    expect(mat4TransformPoint(mat4Identity(), [1, 2, 3])).toEqual([1, 2, 3]);
    const r = mat4Rotation([10, 20, 30]);
    expectClose([...mat4Multiply(mat4Identity(), r)], [...r]);
    expectClose([...mat4Multiply(r, mat4Identity())], [...r]);
  });

  it('rotates right-handed: +90 about Z takes +X to +Y, about Y takes +X to −Z, about X takes +Y to +Z', () => {
    expect(mat4TransformPoint(mat4Rotation([0, 0, 90]), [1, 0, 0])).toEqual([0, 1, 0]);
    expect(mat4TransformPoint(mat4Rotation([0, 90, 0]), [1, 0, 0])).toEqual([0, 0, -1]);
    expect(mat4TransformPoint(mat4Rotation([90, 0, 0]), [0, 1, 0])).toEqual([0, 0, 1]);
  });

  it('applies X first, then Y, then Z (Rz·Ry·Rx, three.js order ZYX)', () => {
    // X 90 takes (0,1,0) to (0,0,1); Y 90 then takes it to (1,0,0). The reverse order would give (0,0,1).
    expect(mat4TransformPoint(mat4Rotation([90, 90, 0]), [0, 1, 0])).toEqual([1, 0, 0]);
    const composed = mat4Multiply(
      mat4Rotation([0, 0, 30]),
      mat4Multiply(mat4Rotation([0, 20, 0]), mat4Rotation([10, 0, 0])),
    );
    expectClose([...mat4Rotation([10, 20, 30])], [...composed]);
  });

  it('keeps quarter turns exact', () => {
    for (const angle of [90, 180, 270, -90, 450]) {
      for (const value of mat4Rotation([angle, angle, angle])) expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('rotates about the pivot, which stays fixed, then translates', () => {
    const m = mat4NodeLocal([0, 0, 0], [4, 0, 0], [0, 0, 90]);
    expect(mat4TransformPoint(m, [4, 0, 0])).toEqual([4, 0, 0]);
    expect(mat4TransformPoint(m, [5, 0, 0])).toEqual([4, 1, 0]);
    const moved = mat4NodeLocal([1, 2, 3], [4, 0, 0], [0, 0, 90]);
    expect(mat4TransformPoint(moved, [5, 0, 0])).toEqual([5, 3, 3]);
  });

  it('maps directions without translation', () => {
    const m = mat4NodeLocal([7, 7, 7], [4, 0, 0], [0, 90, 0]);
    expect(mat4TransformDirection(m, [1, 0, 0])).toEqual([0, 0, -1]);
  });
});

describe('worldMatrices', () => {
  it('composes parent · child', () => {
    // Child turns 90 about Y around (0,0,0); parent turns 90 about Z around (0,8,0).
    const nodes = [node(-1, [0, 8, 0], [0, 0, 90]), node(0, [0, 0, 0], [0, 90, 0])];
    const world = worldMatrices(nodes);
    // Child: (1,0,0) → (0,0,−1); parent: (0,0,−1) − (0,8,0) = (0,−8,−1) → Z 90 → (8,0,−1) + (0,8,0).
    const point = mat4TransformPoint(world[1] ?? mat4Identity(), [1, 0, 0]);
    expectClose(point, [8, 8, -1]);
  });

  it('rejects a parent listed after its child', () => {
    expect(() => worldMatrices([node(1, [0, 0, 0], [0, 0, 0]), node(-1, [0, 0, 0], [0, 0, 0])])).toThrow(RangeError);
  });
});
