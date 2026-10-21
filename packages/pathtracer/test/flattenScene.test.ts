import { NO_EDGE, sharpEdges, type SceneDocument } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { flatEdges, flattenScene } from '../src/flattenScene';
import { PathTracerError } from '../src/PathTracerError';
import { boxMesh, node, sceneOf, triangleMesh } from './testScenes';

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];

describe('flattenScene', () => {
  it('places triangles by their node and keeps material, sides and render order', () => {
    const doc = sceneOf(
      [
        triangleMesh(TRI, {
          node: 0,
          renderOrder: -1,
          groups: [{ material: 0, start: 0, count: 3, doubleSided: true }],
        }),
        triangleMesh(TRI, { node: -1, groups: [{ material: -1, start: 0, count: 3 }] }),
      ],
      [node({ translation: [10, 0, 0], rotation: [0, 0, 90], meshes: [0] })],
    );
    const flat = flattenScene(doc);
    expect(flat.count).toBe(2);
    // Rz(90) maps (1, 0, 0) to (0, 1, 0), then +10 in x.
    expect(Array.from(flat.positions.subarray(0, 9))).toEqual([10, 0, 0, 10, 1, 0, 9, 0, 0]);
    expect(Array.from(flat.normals.subarray(0, 3))).toEqual([0, 0, 1]);
    expect(Array.from(flat.materials)).toEqual([0, -1]);
    expect(Array.from(flat.doubleSided)).toEqual([1, 0]);
    expect(Array.from(flat.renderOrders)).toEqual([-1, 0]);
    expect(Array.from(flat.uvs.subarray(0, 6))).toEqual([0, 0, 1, 0, 0, 1]);
    expect(Array.from(flat.sources)).toEqual([0, 0, 1, 0]);
    expect(flat.skipped).toBe(0);
  });

  it('names the mesh and first index of every kept triangle, skipped ones left out', () => {
    const doc = sceneOf([
      triangleMesh([...TRI, 5, 5, 5, 5, 5, 5, 5, 5, 5, ...TRI]),
      triangleMesh(TRI, { visible: false }),
      triangleMesh([...TRI, ...TRI]),
    ]);
    const flat = flattenScene(doc);
    expect(flat.count).toBe(4);
    expect(Array.from(flat.sources)).toEqual([0, 0, 0, 6, 2, 0, 2, 3]);
  });

  it('leaves out hidden meshes and meshes under a hidden node', () => {
    const doc = sceneOf(
      [triangleMesh(TRI, { node: 1 }), triangleMesh(TRI, { visible: false }), triangleMesh(TRI)],
      [node({ visible: false, children: [1] }), node({ parent: 0, meshes: [0] })],
    );
    expect(flattenScene(doc).count).toBe(1);
  });

  it('skips non-finite and zero-area triangles and counts them', () => {
    const bad = [
      ...[Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0],
      ...[0, 0, 0, Infinity, 0, 0, 0, 1, 0],
      ...[0, 0, 0, 1, 0, 0, 2, 0, 0],
      ...[5, 5, 5, 5, 5, 5, 5, 5, 5],
      ...[0, 0, 0, 1e39, 0, 0, 0, 1, 0],
      ...TRI,
    ];
    const mesh = triangleMesh(bad);
    const flat = flattenScene(sceneOf([mesh]));
    expect(flat.count).toBe(1);
    expect(flat.skipped).toBe(5);
    expect(Array.from(flat.positions)).toEqual(TRI);
    const badUv = triangleMesh(TRI);
    badUv.uvs[1] = Number.NaN;
    expect(flattenScene(sceneOf([badUv])).skipped).toBe(1);
    const badNormal = triangleMesh(TRI);
    badNormal.normals[2] = -Infinity;
    expect(flattenScene(sceneOf([badNormal])).skipped).toBe(1);
  });

  it('throws SCENE_TOO_LARGE before reading any vertex when visible triangles exceed the limit', () => {
    const mesh = triangleMesh([...TRI, ...TRI, ...TRI]);
    const doc: SceneDocument = sceneOf([
      Object.defineProperty({ ...mesh }, 'positions', {
        get: () => {
          throw new Error('positions read');
        },
      }),
    ]);
    let error: unknown;
    try {
      flattenScene(doc, 2);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PathTracerError);
    expect((error as PathTracerError).code).toBe('SCENE_TOO_LARGE');
    expect((error as PathTracerError).message).toContain('3 visible triangles; the limit is 2');
    expect(flattenScene(sceneOf([mesh]), 3).count).toBe(3);
  });

  it('carries the sharp-edge distances of every corner and the angles of its slots', () => {
    const box = boxMesh([0, 0, 0], [2, 2, 2], { node: 0 });
    const doc = sceneOf([triangleMesh(TRI), box], [node({ translation: [5, 0, 0], meshes: [1] })]);
    const options = { sharpAngleDeg: 30, reach: 4 };
    const flat = flattenScene(doc, undefined, options);
    expect(flat.count).toBe(13);
    // The lone triangle has no sharp edge.
    expect(Array.from(flat.edgeDistances.subarray(0, 12))).toEqual(new Array(12).fill(NO_EDGE));
    expect(Array.from(flat.edgeAngles.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    const attributes = sharpEdges(box, options);
    for (let t = 1; t < 13; t++) {
      const first = flat.sources[t * 2 + 1] ?? 0;
      for (let c = 0; c < 3; c++) {
        const v = attributes.indices[first + c] ?? 0;
        expect(Array.from(flat.edgeDistances.subarray((t * 3 + c) * 4, (t * 3 + c) * 4 + 4))).toEqual(
          Array.from(attributes.distances.subarray(v * 4, v * 4 + 4)),
        );
      }
      for (let k = 0; k < 4; k++) expect(flat.edgeAngles[t * 4 + k]).toBeCloseTo(Math.PI / 2, 6);
    }
    // Without options (the light bake) every slot is empty; flatEdges rebuilds the same data from the sources.
    const plain = flattenScene(doc);
    expect(plain.edgeDistances.every((d) => d === NO_EDGE)).toBe(true);
    expect(plain.edgeAngles.every((a) => a === 0)).toBe(true);
    const again = flatEdges(doc, plain.sources, options);
    expect(Array.from(again.edgeDistances)).toEqual(Array.from(flat.edgeDistances));
    expect(Array.from(again.edgeAngles)).toEqual(Array.from(flat.edgeAngles));
  });
});
