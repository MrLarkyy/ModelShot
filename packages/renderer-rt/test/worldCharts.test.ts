import type { SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { worldChartTexels, worldCharts, type WorldChartTriangle } from '../src/worldCharts';
import { expectCpuBelow } from './expectCpuBelow';

function mesh(positions: number[], indices: number[]): SceneMesh {
  const vertices = positions.length / 3;
  return {
    name: 'm',
    sourceId: '',
    node: 0,
    visible: true,
    positions: new Float32Array(positions),
    normals: new Float32Array(vertices * 3),
    uvs: new Float32Array(vertices * 2),
    uvRects: new Float32Array(vertices * 4),
    indices: new Uint32Array(indices),
    groups: [{ material: -1, start: 0, count: indices.length }],
  };
}

function all(m: SceneMesh, group: (first: number) => number = () => 0, doubleSided = false): WorldChartTriangle[] {
  return Array.from({ length: m.indices.length / 3 }, (_, t) => ({ first: t * 3, group: group(t * 3), doubleSided }));
}

const QUAD = [0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0];

/** An axis-aligned box of 8 shared vertices, 12 triangles, as a smooth glTF box. */
function box(): SceneMesh {
  const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [3, 7, 6, 2],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
  ];
  return mesh(
    p,
    faces.flatMap(([a = 0, b = 0, c = 0, d = 0]) => [a, b, c, a, c, d]),
  );
}

describe('worldCharts', () => {
  it('puts a coplanar quad in one chart along its sides, not its diagonal', () => {
    const quad = mesh(QUAD, [0, 1, 2, 0, 2, 3]);
    const charts = worldCharts(quad, all(quad), 32);
    expect(charts).toHaveLength(1);
    const [chart] = charts;
    expect(chart?.triangles).toEqual([0, 3]);
    expect(chart?.back).toBe(false);
    expect(chart?.span.map((x) => +x.toFixed(6))).toEqual([2, 1]);
    // Corner 0 of the first triangle is the origin of the chart; every corner lies inside the span.
    const corners = Array.from(chart?.corners ?? []);
    expect(corners).toHaveLength(12);
    for (let i = 0; i < corners.length; i += 2) {
      expect(corners[i]).toBeGreaterThanOrEqual(-1e-9);
      expect(corners[i]).toBeLessThanOrEqual(2 + 1e-9);
      expect(corners[i + 1]).toBeGreaterThanOrEqual(-1e-9);
      expect(corners[i + 1]).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('gives a smooth box of shared vertices one chart per side', () => {
    const b = box();
    const charts = worldCharts(b, all(b), 32);
    expect(charts.map((c) => c.triangles)).toEqual([
      [0, 3],
      [6, 9],
      [12, 15],
      [18, 21],
      [24, 27],
      [30, 33],
    ]);
    for (const chart of charts) expect(chart.span.map((x) => +x.toFixed(6))).toEqual([1, 1]);
  });

  it('splits at a crease, between groups and at the triangle cap, and keeps the back flag', () => {
    // A quad folded by about one degree along its diagonal.
    const folded = mesh([0, 0, 0, 1, 0, 0, 1, 1, 0.02, 0, 1, 0], [0, 1, 3, 1, 2, 3]);
    expect(worldCharts(folded, all(folded), 32)).toHaveLength(2);
    const quad = mesh(QUAD, [0, 1, 2, 0, 2, 3]);
    expect(
      worldCharts(
        quad,
        all(quad, (first) => (first === 0 ? 0 : 1)),
        32,
      ),
    ).toHaveLength(2);
    // A flat strip of 40 triangles: 32, then 8.
    const positions: number[] = [];
    for (let i = 0; i <= 20; i++) positions.push(i, 0, 0, i, 1, 0);
    const indices: number[] = [];
    for (let i = 0; i < 20; i++) indices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    const strip = mesh(positions, indices);
    const charts = worldCharts(
      strip,
      all(strip, () => 0, true),
      32,
    );
    expect(charts.map((c) => c.triangles.length)).toEqual([32, 8]);
    expect(charts.every((c) => c.back)).toBe(true);
  });

  it('gives each face of a curved low-poly mesh its own chart', () => {
    // An octahedron: no two faces coplanar.
    const p = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
    const indices = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];
    const octahedron = mesh(p, indices);
    const charts = worldCharts(octahedron, all(octahedron), 32);
    expect(charts).toHaveLength(8);
    expect(charts.map((c) => c.triangles.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('joins triangles by position when every triangle has its own vertices', () => {
    const split = mesh([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 0, 0, 2, 1, 0, 0, 1, 0], [0, 1, 2, 3, 4, 5]);
    expect(worldCharts(split, all(split), 32).map((c) => c.triangles)).toEqual([[0, 3]]);
  });

  it('sizes a chart at a texel size to whole texels, at least one, with corners in texels', () => {
    const quad = mesh(QUAD, [0, 1, 2, 0, 2, 3]);
    const [chart] = worldCharts(quad, all(quad), 32);
    const at = worldChartTexels(chart!, 0.3);
    expect(at.texels).toEqual([7, 4]);
    expect(Math.max(...at.corners)).toBeCloseTo(2 / 0.3, 4);
    expect(worldChartTexels(chart!, 10).texels).toEqual([1, 1]);
  });

  it('joins only across an edge of exactly two triangles, so an edge fan stays linear', () => {
    // Three coplanar triangles on the edge (0,0,0)-(1,0,0): none joins; without the third, the two do.
    const three = mesh([0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0.5, -1, 0, 0.5, 2, 0], [0, 1, 2, 1, 0, 3, 0, 1, 4]);
    expect(worldCharts(three, all(three), 32)).toHaveLength(3);
    const two = mesh([0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0.5, -1, 0], [0, 1, 2, 1, 0, 3]);
    expect(worldCharts(two, all(two), 32)).toHaveLength(1);
    // 4096 triangles on one edge, as many as the gate lets through: was 230 ms a mesh, quadratic in the fan.
    const positions = [0, 0, 0, 1, 0, 0];
    const indices: number[] = [];
    for (let i = 0; i < 4096; i++) {
      positions.push(0.5, 1 + i * 1e-3, 0);
      indices.push(0, 1, i + 2);
    }
    const fan = mesh(positions, indices);
    const triangles = all(fan);
    expect(worldCharts(fan, triangles, 32)).toHaveLength(4096);
    // The 49 meshes of the load scene took 11.3 s before; the load budget is 3.5 s for everything.
    expectCpuBelow(3000, () => {
      for (let m = 0; m < 49; m++) worldCharts(fan, triangles, 32);
    });
  });
});
