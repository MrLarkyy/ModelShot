import { describe, expect, it } from 'vitest';
import {
  BOX_EDGES,
  BOX_TRIANGLES,
  boxCorners,
  enclosingBox,
  localBox,
  placedBoxes,
  subtreeMeshes,
} from '../src/viewport/meshBoxes';
import { boxMesh, doc, node } from './editorDocs';

describe('meshBoxes', () => {
  it('finds the local box of a mesh and caches it', () => {
    const mesh = boxMesh(0, [1, 2, 3], 0.5);
    const box = localBox(mesh);
    expect(box?.min).toEqual([0.5, 1.5, 2.5]);
    expect(box?.max).toEqual([1.5, 2.5, 3.5]);
    expect(localBox(mesh)).toBe(box);
  });

  it('has no box for a mesh without a finite vertex', () => {
    const mesh = { ...boxMesh(0), positions: new Float32Array([NaN, NaN, NaN]) };
    expect(localBox(mesh)).toBeNull();
  });

  it('lists eight corners with twelve edges and triangles that index them', () => {
    const corners = boxCorners({ min: [0, 0, 0], max: [1, 2, 3] });
    expect(corners).toHaveLength(8);
    expect(corners[7]).toEqual([1, 2, 3]);
    expect(BOX_EDGES).toHaveLength(12);
    expect(BOX_TRIANGLES).toHaveLength(12);
    for (const index of [...BOX_EDGES.flat(), ...BOX_TRIANGLES.flat()]) expect(index).toBeLessThan(8);
  });

  it('places boxes with the node transform and skips hidden meshes', () => {
    const d = doc(
      [node(-1, { translation: [10, 0, 0], meshes: [0] }), node(-1, { visible: false, meshes: [1] })],
      [boxMesh(0), boxMesh(1)],
    );
    const placed = placedBoxes(d);
    expect(placed.map((b) => b.mesh)).toEqual([0]);
    expect(placed[0]?.corners[0]).toEqual([9, -1, -1]);
  });

  it('collects the meshes below a node and encloses boxes', () => {
    const d = doc(
      [node(-1, { children: [1], meshes: [0] }), node(0, { meshes: [1] }), node(-1, { meshes: [2] })],
      [boxMesh(0), boxMesh(1, [4, 0, 0]), boxMesh(2)],
    );
    expect([...subtreeMeshes(d, 0)].sort()).toEqual([0, 1]);
    const whole = enclosingBox(placedBoxes(d, subtreeMeshes(d, 0)));
    expect(whole?.[0]).toEqual([-1, -1, -1]);
    expect(whole?.[7]).toEqual([5, 1, 1]);
    expect(enclosingBox([])).toBeNull();
  });
});
