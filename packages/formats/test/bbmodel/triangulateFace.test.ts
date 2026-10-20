import type { Vec3 } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { triangulateFace } from '../../src/bbmodel/triangulateFace';

type Point = readonly [number, number];

const flat = (points: readonly Point[]): Vec3[] => points.map(([x, y]) => [x, y, 0]);

/** Area of a simple polygon given counter-clockwise (shoelace). */
function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  points.forEach(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length] ?? [0, 0];
    sum += x * ny - nx * y;
  });
  return Math.abs(sum) / 2;
}

/** Signed area of every triangle about `normal`. */
function triangleAreas(points: readonly Vec3[], triangles: readonly number[], normal: Vec3): number[] {
  const areas: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]].map((i) => points[i ?? -1] ?? [NaN, NaN, NaN]);
    const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
    const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    areas.push((cross[0]! * normal[0] + cross[1]! * normal[1] + cross[2]! * normal[2]) / 2);
  }
  return areas;
}

function expectExactCover(points: readonly Vec3[], area: number): void {
  const { normal, triangles } = triangulateFace(points);
  expect(Math.hypot(...normal)).toBeCloseTo(1, 12);
  expect(triangles).toHaveLength((points.length - 2) * 3);
  const areas = triangleAreas(points, triangles, normal);
  for (const a of areas) expect(a).toBeGreaterThan(-1e-9);
  expect(areas.reduce((s, a) => s + a, 0)).toBeCloseTo(area, 9);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

const SQUARE: Point[] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
];
const L_HEXAGON: Point[] = [
  [0, 0],
  [6, 0],
  [6, 2],
  [2, 2],
  [2, 6],
  [0, 6],
];

describe('triangulateFace', () => {
  it('keeps a triangle and gives its counter-clockwise normal', () => {
    expect(
      triangulateFace(
        flat([
          [0, 0],
          [1, 0],
          [0, 1],
        ]),
      ),
    ).toEqual({ normal: [0, 0, 1], triangles: [0, 1, 2] });
    expect(
      triangulateFace(
        flat([
          [0, 0],
          [0, 1],
          [1, 0],
        ]),
      ).normal,
    ).toEqual([0, 0, -1]);
  });

  it('turns a quad in every stored order into a simple loop covering its area', () => {
    for (const order of permutations([0, 1, 2, 3])) {
      expectExactCover(
        order.map((i) => SQUARE[i]!).map(([x, y]) => [x, y, 0] as const),
        4,
      );
    }
  });

  it('splits a quad stored in loop order along the 0–2 diagonal, as Blockbench does', () => {
    expect(triangulateFace(flat(SQUARE)).triangles).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('splits a concave quad along the diagonal that stays inside', () => {
    // A loop with its reflex vertex at index 3: the 0–2 diagonal would leave the quad.
    const dart: Point[] = [
      [0, 3],
      [-2, -2],
      [3, 0],
      [1, 1],
    ];
    expect(triangulateFace(flat(dart)).triangles).toEqual([1, 2, 3, 1, 3, 0]);
    expectExactCover(flat(dart), polygonArea(dart));
  });

  it('draws a concave quad that Blockbench reorders into a bow-tie as Blockbench draws it', () => {
    const dart: Point[] = [
      [1, 1],
      [0, 3],
      [-2, -2],
      [3, 0],
    ];
    expect(triangulateFace(flat(dart)).triangles).toEqual([0, 2, 1, 0, 1, 3]);
  });

  it('covers convex and concave n-gons exactly', () => {
    const pentagon = [0, 1, 2, 3, 4].map((k): Point => {
      const angle = Math.PI / 2 + (2 * Math.PI * k) / 5;
      return [Math.cos(angle), Math.sin(angle)];
    });
    expectExactCover(flat(pentagon), polygonArea(pentagon));
    expectExactCover(flat(L_HEXAGON), polygonArea(L_HEXAGON));
    // A 16-vertex comb, concave at every inner notch.
    const comb: Point[] = [[0, 0]];
    for (let k = 0; k < 7; k++) comb.push([k * 2 + 1, 0], [k * 2 + 2, 3]);
    comb.push([0, 4]);
    expect(comb).toHaveLength(16);
    expectExactCover(flat(comb), polygonArea(comb));
  });

  it('works in any plane, with the normal of the loop', () => {
    // The L hexagon on the plane x = 5, loop counter-clockwise seen from −X.
    const points: Vec3[] = L_HEXAGON.map(([a, b]) => [5, b, a]);
    const { normal } = triangulateFace(points);
    expect(normal.map((x) => x || 0)).toEqual([-1, 0, 0]);
    expectExactCover(points, polygonArea(L_HEXAGON));
  });

  it('keeps collinear vertices on an edge without a sliver', () => {
    const notched: Point[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    const { normal, triangles } = triangulateFace(flat(notched));
    const areas = triangleAreas(flat(notched), triangles, normal);
    expect(areas.every((a) => a > 1e-9)).toBe(true);
    expect(areas.reduce((s, a) => s + a, 0)).toBeCloseTo(4, 12);
  });

  it('falls back to a fan for a self-intersecting polygon', () => {
    const star = [0, 2, 4, 1, 3].map((k): Point => {
      const angle = Math.PI / 2 + (2 * Math.PI * k) / 5;
      return [Math.cos(angle), Math.sin(angle)];
    });
    expect(triangulateFace(flat(star)).triangles).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4]);
  });

  it.each<[string, Vec3[]]>([
    ['no points', []],
    [
      'two points',
      flat([
        [0, 0],
        [1, 1],
      ]),
    ],
    [
      'three collinear points',
      flat([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ],
    [
      'a collinear pentagon',
      flat([
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
      ]),
    ],
    [
      'coincident points',
      flat([
        [1, 1],
        [1, 1],
        [1, 1],
        [1, 1],
      ]),
    ],
  ])('gives no triangles for %s', (_name, points) => {
    expect(triangulateFace(points)).toEqual({ normal: [0, 0, 0], triangles: [] });
  });
});

describe('triangulateFace with quadOrder loop (OBJ)', () => {
  it('keeps the given loop of a concave quad and covers exactly its area', () => {
    const dart: Point[] = [
      [0, 0],
      [2, 1],
      [4, 0],
      [2, 3],
    ];
    const points = flat(dart);
    const { normal, triangles } = triangulateFace(points, 'loop');
    expect(normal).toEqual([0, 0, 1]);
    const areas = triangleAreas(points, triangles, normal);
    expect(areas.every((area) => area > 0)).toBe(true);
    expect(areas.reduce((sum, area) => sum + area, 0)).toBeCloseTo(polygonArea(dart), 9);
  });
});
