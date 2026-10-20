import { lightmapLayout } from '@modelshot/renderer-rt';
import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { CHART_MODE_TEXEL, CHART_MODE_VERTEX, CHART_TEXELS, buildChartTable } from '../src/bake/chartTable';
import { flattenScene } from '../src/flattenScene';
import { sceneOf } from './testScenes';

/**
 * A 6 x 6 unit quad at z = 0 facing +z (corners (0,6) (6,6) (6,0) (0,0) top-left first) on texels [2, 8) x [4, 10) of a
 * 16 x 16 texture, its UV corners given top-left, top-right, bottom-right, bottom-left (rotations and mirrors).
 */
function face(uvCorners: readonly (readonly [number, number])[], doubleSided = false): SceneDocument {
  const mesh: SceneMesh = {
    name: 'face',
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array([0, 6, 0, 6, 6, 0, 6, 0, 0, 0, 0, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array(uvCorners.flatMap(([u, v]) => [u / 16, v / 16])),
    uvRects: new Float32Array(Array.from({ length: 4 }, () => [2 / 16, 4 / 16, 8 / 16, 10 / 16]).flat()),
    indices: new Uint32Array([0, 3, 2, 0, 2, 1]),
    groups: [{ material: 0, start: 0, count: 6, doubleSided }],
  };
  return {
    ...sceneOf([mesh]),
    materials: [{ name: 'm', texture: 0 }],
    textures: [
      {
        name: 't',
        mimeType: 'image/png',
        bytes: null,
        width: 16,
        height: 16,
        uvWidth: 16,
        uvHeight: 16,
        missing: false,
      },
    ],
  };
}

const identityOrder = (count: number) => Uint32Array.from({ length: count }, (_, i) => i);

/** The world point the bake samples at chart-local point (s, t), found as bake.frag.glsl does. */
function bakePoint(doc: SceneDocument, s: number, t: number): number[] {
  const layout = lightmapLayout(doc);
  const flat = flattenScene(doc);
  const table = buildChartTable(layout, flat, identityOrder(flat.count), 8192);
  const record = table.charts.data.subarray(0, CHART_TEXELS * 4);
  const u = (record[4] ?? 0) + s * (record[6] ?? 0);
  const v = (record[5] ?? 0) + t * (record[7] ?? 0);
  for (let entry = 0; entry < (record[9] ?? 0); entry++) {
    const triangle = table.triangles.data[(record[8] ?? 0) + entry] ?? -1;
    const uv = (c: number) => [flat.uvs[triangle * 6 + c * 2] ?? 0, flat.uvs[triangle * 6 + c * 2 + 1] ?? 0];
    const [a, b, c] = [uv(0), uv(1), uv(2)] as [number[], number[], number[]];
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!];
    const e2 = [c[0]! - a[0]!, c[1]! - a[1]!];
    const d = [u - a[0]!, v - a[1]!];
    const det = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const w1 = (d[0]! * e2[1]! - d[1]! * e2[0]!) / det;
    const w2 = (e1[0]! * d[1]! - e1[1]! * d[0]!) / det;
    if (Math.min(w1, w2, 1 - w1 - w2) < -1e-6) continue;
    const p = (k: number, axis: number) => flat.positions[triangle * 9 + k * 3 + axis] ?? 0;
    return [0, 1, 2].map((axis) => p(0, axis) * (1 - w1 - w2) + p(1, axis) * w1 + p(2, axis) * w2);
  }
  throw new Error('no triangle holds the point');
}

describe('buildChartTable', () => {
  // Texel (i, j) of the face's texture lies where its UV is: e.g. texture texel (2, 4) is the face's top-left texel
  // for the plain mapping and its top-right one when the U axis is mirrored.
  it('maps a texel centre to the world point of that texel, for plain, mirrored and rotated UVs', () => {
    const plain = face([
      [2, 4],
      [8, 4],
      [8, 10],
      [2, 10],
    ]);
    expect(bakePoint(plain, 0.5, 0.5).map((x) => +x.toFixed(6))).toEqual([0.5, 5.5, 0]);
    expect(bakePoint(plain, 5.5, 0.5).map((x) => +x.toFixed(6))).toEqual([5.5, 5.5, 0]);
    const mirrored = face([
      [8, 4],
      [2, 4],
      [2, 10],
      [8, 10],
    ]);
    expect(bakePoint(mirrored, 0.5, 0.5).map((x) => +x.toFixed(6))).toEqual([5.5, 5.5, 0]);
    // Rotated 90 degrees: the texture's top row runs down the face's right edge.
    const rotated = face([
      [2, 10],
      [2, 4],
      [8, 4],
      [8, 10],
    ]);
    expect(bakePoint(rotated, 0.5, 0.5).map((x) => +x.toFixed(6))).toEqual([5.5, 5.5, 0]);
    expect(bakePoint(rotated, 0.5, 5.5).map((x) => +x.toFixed(6))).toEqual([0.5, 5.5, 0]);
  });

  it('records the chart, its back block and the index of every texel', () => {
    const doc = face(
      [
        [2, 4],
        [8, 4],
        [8, 10],
        [2, 10],
      ],
      true,
    );
    const layout = lightmapLayout(doc);
    const flat = flattenScene(doc);
    const table = buildChartTable(layout, flat, Uint32Array.from([1, 0]), 8192);
    const chart = layout.charts[0]!;
    const record = Array.from(table.charts.data.subarray(0, CHART_TEXELS * 4));
    expect(record.slice(0, 4)).toEqual([chart.x, chart.y, 6, 6]);
    expect(record.slice(4, 8)).toEqual([2 / 16, 4 / 16, 1 / 16, 1 / 16]);
    expect(record.slice(8, 12)).toEqual([0, 2, 6, CHART_MODE_TEXEL]);
    // Flat triangles 0 and 1 sit at BVH positions 1 and 0.
    expect(Array.from(table.triangles.data.subarray(0, 3))).toEqual([1, 0, -1]);
    let covered = 0;
    for (const value of table.index) if (value === 1) covered++;
    expect(covered).toBe(6 * 6 * 2);
    expect(table.index[chart.y * table.width + chart.x + 11]).toBe(1);
  });

  it('samples a vertex just inside its corner and leaves untraced triangles at -1', () => {
    const doc = { ...face([[0, 0], [0, 0], [0, 0], [0, 0]]), materials: [{ name: 'm', texture: -1 }] };
    const layout = lightmapLayout(doc);
    const table = buildChartTable(layout, flattenScene(doc), identityOrder(2), 8192);
    expect(layout.charts.map((c) => c.mode)).toEqual(['vertex', 'vertex', 'vertex', 'vertex']);
    const third = Array.from(table.charts.data.subarray(2 * CHART_TEXELS * 4, 3 * CHART_TEXELS * 4));
    expect(third[11]).toBe(CHART_MODE_VERTEX);
    // Vertex 2 is corner 2 of the first triangle (indices 0 3 2).
    expect(third[12]).toBeCloseTo(1e-3, 6);
    expect(third[13]).toBeCloseTo(1 - 2e-3, 6);
    const hidden = buildChartTable(layout, flattenScene({ ...doc, meshes: [] }), new Uint32Array(0), 8192);
    expect(hidden.triangles.data[0]).toBe(-1);
  });

  it('refuses chart rows over the GPU limit before allocating', () => {
    const doc = face([
      [2, 4],
      [8, 4],
      [8, 10],
      [2, 10],
    ]);
    const flat = flattenScene(doc);
    expect(() => buildChartTable(lightmapLayout(doc), flat, identityOrder(2), 0)).toThrow(/SCENE_TOO_LARGE|rows/);
  });
});
