import { lightmapLayout } from '@modelshot/renderer-rt';
import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import {
  CHART_MODE_TEXEL,
  CHART_MODE_VERTEX,
  CHART_MODE_WORLD,
  CHART_TEXELS,
  CORNER_TEXELS,
  buildChartTable,
} from '../src/bake/chartTable';
import { flattenScene } from '../src/flattenScene';
import { pathTracerProgramSource } from '../src/pathTracerShaders';
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
    // Untextured and over the world chart gate (4096 triangles): the face's two triangles 2049 times over.
    const base = face([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    const mesh = base.meshes[0]!;
    const indices = Uint32Array.from({ length: 6 * 2049 }, (_, i) => mesh.indices[i % 6] ?? 0);
    const doc = {
      ...base,
      meshes: [{ ...mesh, indices, groups: [{ material: 0, start: 0, count: indices.length }] }],
      materials: [{ name: 'm', texture: -1 }],
    };
    const layout = lightmapLayout(doc);
    const table = buildChartTable(layout, flattenScene(doc), identityOrder(2 * 2049), 8192);
    expect(layout.charts.map((c) => c.mode)).toEqual(['vertex', 'vertex', 'vertex', 'vertex']);
    const third = Array.from(table.charts.data.subarray(2 * CHART_TEXELS * 4, 3 * CHART_TEXELS * 4));
    expect(third[11]).toBe(CHART_MODE_VERTEX);
    // Vertex 2 is corner 2 of the first triangle (indices 0 3 2).
    expect(third[12]).toBeCloseTo(1e-3, 6);
    expect(third[13]).toBeCloseTo(1 - 2e-3, 6);
    const hidden = buildChartTable(layout, flattenScene({ ...doc, meshes: [] }), new Uint32Array(0), 8192);
    expect(hidden.triangles.data[0]).toBe(-1);
  });

  it('records a world chart with its corners, back block and index, and maps a texel to its world point', () => {
    const doc = {
      ...face(
        [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        true,
      ),
      materials: [{ name: 'm', texture: -1 }],
    };
    const layout = lightmapLayout(doc);
    const flat = flattenScene(doc);
    const table = buildChartTable(layout, flat, Uint32Array.from([1, 0]), 8192);
    const chart = layout.charts[0]!;
    expect(layout.charts.map((c) => c.mode)).toEqual(['world']);
    // 6 units at the rest diagonal (6 sqrt 2) / 256 per texel.
    const size = Math.ceil(6 / ((6 * Math.SQRT2) / 256));
    expect([chart.width, chart.height]).toEqual([size, size]);
    const record = Array.from(table.charts.data.subarray(0, CHART_TEXELS * 4));
    expect(record.slice(0, 4)).toEqual([chart.x, chart.y, size, size]);
    expect(record[4]).toBe(0);
    expect(record.slice(8, 12)).toEqual([0, 2, size, CHART_MODE_WORLD]);
    expect(Array.from(table.triangles.data.subarray(0, 3))).toEqual([1, 0, -1]);
    expect(Array.from(table.corners.data.subarray(0, 2 * CORNER_TEXELS * 4))).toEqual(
      Array.from(chart.corners).flatMap((x, i) => (i % 6 === 5 ? [x, 0, 0] : [x])),
    );
    let covered = 0;
    for (const value of table.index) if (value === 1) covered++;
    expect(covered).toBe(size * size * 2);
    // The texel centre (0.5, 0.5) of the chart, found through the corners as bake.frag.glsl does, lies on the face
    // half a texel in from a corner.
    const texel = (6 * Math.SQRT2) / 256;
    const point = [0.5, 0.5];
    let found: number[] | null = null;
    for (let entry = 0; entry < 2; entry++) {
      const c = table.corners.data.subarray(entry * CORNER_TEXELS * 4, entry * CORNER_TEXELS * 4 + 6);
      const [ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0] = c;
      const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const w1 = ((point[0]! - ax) * (cy - ay) - (point[1]! - ay) * (cx - ax)) / det;
      const w2 = ((bx - ax) * (point[1]! - ay) - (by - ay) * (point[0]! - ax)) / det;
      if (Math.min(w1, w2, 1 - w1 - w2) < -1e-6) continue;
      const flatTriangle = entry === 0 ? 0 : 1;
      const p = (k: number, axis: number) => flat.positions[flatTriangle * 9 + k * 3 + axis] ?? 0;
      found = [0, 1, 2].map((axis) => p(0, axis) * (1 - w1 - w2) + p(1, axis) * w1 + p(2, axis) * w2);
      break;
    }
    expect(found).not.toBeNull();
    const fromEdge = (x: number) => Math.min(Math.abs(x), Math.abs(6 - x));
    expect(fromEdge(found![0]!)).toBeCloseTo(texel / 2, 5);
    expect(fromEdge(found![1]!)).toBeCloseTo(texel / 2, 5);
    expect(found![2]).toBe(0);
  });

  it('refuses a lightmap taller than the GPU allows before allocating', () => {
    const doc = {
      ...face([
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
      materials: [{ name: 'm', texture: -1 }],
    };
    const layout = lightmapLayout(doc);
    const flat = flattenScene(doc);
    expect(() => buildChartTable(layout, flat, identityOrder(2), 1)).toThrow(/lightmap rows/);
    expect(() => buildChartTable(layout, flat, identityOrder(2), layout.height)).not.toThrow();
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

  it('reads the chart table, world corners included, within the WebGL2 minimum of 16 samplers', () => {
    const { fragment } = pathTracerProgramSource('bake');
    const samplers = fragment.match(/^uniform (highp |mediump |lowp )?u?sampler\w+ u_\w+;/gm) ?? [];
    expect(samplers.length).toBeLessThanOrEqual(16);
    for (const name of ['u_chartIndex', 'u_charts', 'u_chartTriangles', 'u_chartCorners']) {
      expect(
        samplers.some((line) => line.includes(` ${name};`)),
        name,
      ).toBe(true);
    }
    expect(fragment).toContain('const int CHART_MODE_WORLD = ' + String(CHART_MODE_WORLD) + ';');
    expect(fragment).toContain('const int CORNER_TEXELS = ' + String(CORNER_TEXELS) + ';');
  });
});
