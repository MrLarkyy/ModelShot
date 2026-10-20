import { describe, expect, it } from 'vitest';
import { sceneBounds } from '../src/index';
import { testDoc, testMesh, testNode } from './sceneDocs';

describe('sceneBounds', () => {
  it('bounds root meshes and their circumscribed sphere', () => {
    const doc = testDoc(
      [],
      [
        testMesh(-1, [
          [0, 0, 0],
          [4, 2, 0],
        ]),
        testMesh(-1, [[-2, 6, 4]]),
      ],
    );
    const bounds = sceneBounds(doc);
    expect(bounds).toEqual({ min: [-2, 0, 0], max: [4, 6, 4], center: [1, 3, 2], radius: Math.hypot(6, 6, 4) / 2 });
  });

  it('excludes a hidden node subtree and hidden meshes', () => {
    const doc = testDoc(
      [testNode(-1, { visible: false }), testNode(0), testNode(-1)],
      [
        testMesh(1, [[100, 100, 100]]),
        testMesh(2, [[1, 1, 1]]),
        testMesh(2, [[-50, 0, 0]], { visible: false }),
        testMesh(2, [[0, 0, 0]]),
      ],
    );
    expect(sceneBounds(doc)).toMatchObject({ min: [0, 0, 0], max: [1, 1, 1] });
  });

  it('places vertices by a rotated pivot node', () => {
    const doc = testDoc(
      [testNode(-1, { pivot: [8, 0, 0], rotation: [0, 0, 90], translation: [0, 0, 5] })],
      [testMesh(0, [[10, 0, 0]])],
    );
    const bounds = sceneBounds(doc);
    expect(bounds?.min).toEqual([8, 2, 5]);
    expect(bounds?.max).toEqual([8, 2, 5]);
    expect(bounds?.radius).toBe(0);
  });

  it('skips non-finite vertices', () => {
    const doc = testDoc(
      [],
      [
        testMesh(-1, [
          [NaN, 0, 0],
          [1, Infinity, 1],
          [2, 2, 2],
          [3, 3, 3],
        ]),
      ],
    );
    expect(sceneBounds(doc)).toMatchObject({ min: [2, 2, 2], max: [3, 3, 3] });
  });

  it('is null for an empty or hidden-only scene', () => {
    expect(sceneBounds(testDoc([], []))).toBeNull();
    expect(sceneBounds(testDoc([testNode(-1, { visible: false })], [testMesh(0, [[1, 2, 3]])]))).toBeNull();
    expect(sceneBounds(testDoc([], [testMesh(-1, [[NaN, NaN, NaN]])]))).toBeNull();
  });
});
