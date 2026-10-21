import { describe, expect, it } from 'vitest';
import {
  EDGE_SLOTS,
  MAX_EDGE_CHECKS,
  NO_EDGE,
  cachedSharpEdges,
  sharpEdges,
  type SceneMesh,
  type SharpEdgeAttributes,
  type Vec3,
} from '../src/index';
import { testMesh } from './sceneDocs';

const OPTIONS = { sharpAngleDeg: 30, reach: 4 };

/** Quads (4 corners each, counter-clockwise from outside), every quad with its own vertices and flat normals. */
function quads(faces: readonly (readonly Vec3[])[]): SceneMesh {
  const points: Vec3[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const face of faces) {
    const base = points.length;
    const [a, b, c] = face as [Vec3, Vec3, Vec3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const length = Math.hypot(...n);
    for (const p of face) {
      points.push(p);
      normals.push(...n.map((x) => x / length));
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return testMesh(-1, points, {
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    groups: [{ material: -1, start: 0, count: indices.length }],
  });
}

/** A Blockbench cube from `min` to `max`: six faces with their own vertices. */
function box(min: Vec3, max: Vec3): SceneMesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return quads([
    [
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
    ], // east
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ], // west
    [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x0, y1, z0],
    ], // up
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ], // down
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ], // south
    [
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
    ], // north
  ]);
}

/** Two unit quads hinged along the z axis, the second turned up by `deg` from the first's plane. */
function hinge(deg: number): SceneMesh {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return quads([
    [
      [-1, 0, 0],
      [0, 0, 0],
      [0, 0, -1],
      [-1, 0, -1],
    ],
    [
      [0, 0, 0],
      [c, s, 0],
      [c, s, -1],
      [0, 0, -1],
    ],
  ]);
}

function slotsOf(result: SharpEdgeAttributes, vertex: number): number[] {
  return [...result.distances.subarray(vertex * EDGE_SLOTS, vertex * EDGE_SLOTS + EDGE_SLOTS)];
}

function roundedVertices(result: SharpEdgeAttributes): number {
  let count = 0;
  for (let v = 0; v < result.vertexOf.length; v++) if (slotsOf(result, v).some((d) => d < NO_EDGE)) count++;
  return count;
}

describe('sharpEdges', () => {
  it('finds the 12 edges of a cube, measures 0 or the face size and splits no vertex', () => {
    const mesh = box([0, 0, 0], [2, 2, 2]);
    const result = sharpEdges(mesh, OPTIONS);
    expect(result.edgeCount).toBe(12);
    expect([...result.vertexOf]).toEqual([...Array(24).keys()]);
    expect([...result.indices]).toEqual([...mesh.indices]);
    for (let v = 0; v < 24; v++) {
      const distances = slotsOf(result, v);
      expect(distances.filter((d) => d === 0)).toHaveLength(2);
      expect(distances.filter((d) => Math.abs(d - 2) < 1e-6)).toHaveLength(2);
      for (let k = 0; k < EDGE_SLOTS; k++) expect(result.angles[v * EDGE_SLOTS + k]).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('rounds nothing on a single quad, a back-to-back card or a welded sphere', () => {
    const quad = quads([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
    ]);
    const card = quads([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
      [
        [1, 0, 0],
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
    ]);
    for (const mesh of [quad, card, sphere(8, 12)]) {
      const result = sharpEdges(mesh, OPTIONS);
      expect(result.edgeCount).toBe(0);
      expect(roundedVertices(result)).toBe(0);
      expect(result.vertexOf.length).toBe(mesh.positions.length / 3);
    }
  });

  it('takes an edge at the threshold and below 170 degrees only', () => {
    expect(sharpEdges(hinge(29), OPTIONS).edgeCount).toBe(0);
    expect(sharpEdges(hinge(31), OPTIONS).edgeCount).toBe(1);
    expect(sharpEdges(hinge(169), OPTIONS).edgeCount).toBe(1);
    expect(sharpEdges(hinge(171), OPTIONS).edgeCount).toBe(0);
    expect(sharpEdges(hinge(29), { ...OPTIONS, sharpAngleDeg: 20 }).edgeCount).toBe(1);
  });

  it('signs the angle: positive on a convex edge, negative on a crease', () => {
    const up = sharpEdges(hinge(90), OPTIONS);
    const down = sharpEdges(hinge(-90), OPTIONS);
    const angle = (r: SharpEdgeAttributes) => [...r.angles].find((a) => a !== 0) ?? 0;
    // Hinged up, the faces' normals turn toward each other: a crease.
    expect(angle(up)).toBeCloseTo(-Math.PI / 2, 6);
    expect(angle(down)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('skips degenerate, non-finite and non-manifold triangles', () => {
    const cube = box([0, 0, 0], [1, 1, 1]);
    const positions = new Float32Array(cube.positions);
    positions[0] = Number.NaN;
    const broken = sharpEdges({ ...cube, positions }, OPTIONS);
    expect(broken.edgeCount).toBeLessThan(12);
    expect(broken.edgeCount).toBeGreaterThan(0);
    const flat = quads([
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ],
    ]);
    expect(sharpEdges(flat, OPTIONS).edgeCount).toBe(0);
    // Three quads on one edge: not manifold, so not rounded.
    const fan = quads([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, -1],
        [0, 0, -1],
      ],
      [
        [0, 0, 0],
        [0, 0, -1],
        [0, 1, -1],
        [0, 1, 0],
      ],
      [
        [0, 0, 0],
        [0, 0, -1],
        [-1, 0.5, -1],
        [-1, 0.5, 0],
      ],
    ]);
    expect(sharpEdges(fan, OPTIONS).edgeCount).toBe(0);
  });

  it('throws on an index out of range', () => {
    const quad = quads([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
    ]);
    expect(() => sharpEdges({ ...quad, indices: new Uint32Array([0, 1, 9]) }, OPTIONS)).toThrow(RangeError);
  });

  it('gives a patch with more edges than slots its nearest four per triangle and splits shared vertices', () => {
    const prism = hexagonalPrism();
    const result = sharpEdges(prism, { sharpAngleDeg: 30, reach: 4 });
    expect(result.edgeCount).toBe(18);
    // The cap's centre vertex is shared by six triangles with different nearest edges, so it is split.
    expect(result.vertexOf.length).toBeGreaterThan(prism.positions.length / 3);
    // Every cap triangle keeps its own rim edge (distance 0 at its two rim corners).
    for (let t = 0; t < 6; t++) {
      const corners = [0, 1, 2].map((c) => result.indices[t * 3 + c] ?? 0);
      const zeroBoth = [0, 1, 2, 3].some(
        (k) => corners.filter((v) => (result.distances[v * EDGE_SLOTS + k] ?? NO_EDGE) < 1e-6).length >= 2,
      );
      expect(zeroBoth).toBe(true);
    }
    const again = sharpEdges(prism, { sharpAngleDeg: 30, reach: 4 });
    expect([...again.vertexOf]).toEqual([...result.vertexOf]);
    expect([...again.distances]).toEqual([...result.distances]);
  });

  it('measures distances in the face plane toward the interior and never negative', () => {
    const result = sharpEdges(box([0, 0, 0], [4, 1, 1]), OPTIONS);
    expect(Math.min(...result.distances)).toBeGreaterThanOrEqual(0);
    // A plate of two coplanar quads (one patch) with a wall at x = 0: the far quad is 3 units from the edge.
    const plate = quads([
      [
        [-6, 0, 0],
        [-3, 0, 0],
        [-3, 0, -1],
        [-6, 0, -1],
      ],
      [
        [-3, 0, 0],
        [0, 0, 0],
        [0, 0, -1],
        [-3, 0, -1],
      ],
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 1, -1],
        [0, 0, -1],
      ],
    ]);
    const near = sharpEdges(plate, { ...OPTIONS, reach: 1 });
    expect(near.edgeCount).toBe(1);
    expect(slotsOf(near, 0)[0]).toBe(NO_EDGE);
    expect(slotsOf(near, 4)[0]).toBeCloseTo(3, 6);
    expect(slotsOf(near, 5)[0]).toBe(0);
    const far = sharpEdges(plate, { ...OPTIONS, reach: 4 });
    expect(slotsOf(far, 0)[0]).toBeCloseTo(6, 6);
    // The wall stands toward the plate: a crease.
    expect(far.angles[5 * EDGE_SLOTS]).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('is identical across runs and cached per mesh and options', () => {
    const mesh = box([0, 0, 0], [1, 2, 3]);
    const a = sharpEdges(mesh, OPTIONS);
    const b = sharpEdges(mesh, OPTIONS);
    expect([...a.distances]).toEqual([...b.distances]);
    expect([...a.angles]).toEqual([...b.angles]);
    const cached = cachedSharpEdges(mesh, OPTIONS);
    expect(cachedSharpEdges(mesh, { ...OPTIONS })).toBe(cached);
    expect(cachedSharpEdges(mesh, { ...OPTIONS, sharpAngleDeg: 40 })).not.toBe(cached);
    expect(cachedSharpEdges({ ...mesh }, OPTIONS)).not.toBe(cached);
  });

  it('bounds a hostile patch: past MAX_EDGE_CHECKS the remaining triangles round nothing', () => {
    // One patch of 200 x 200 quads walled on all four sides: 80 000 triangles x 800 sharp edges is 6.4 x 10^7 checks.
    const side = 200;
    const faces: Vec3[][] = [];
    for (let z = 0; z < side; z++) {
      for (let x = 0; x < side; x++)
        faces.push([
          [x, 0, z + 1],
          [x + 1, 0, z + 1],
          [x + 1, 0, z],
          [x, 0, z],
        ]);
    }
    for (let i = 0; i < side; i++) {
      faces.push([
        [i + 1, 0, 0],
        [i, 0, 0],
        [i, 1, 0],
        [i + 1, 1, 0],
      ]);
      faces.push([
        [i, 0, side],
        [i + 1, 0, side],
        [i + 1, 1, side],
        [i, 1, side],
      ]);
      faces.push([
        [0, 0, i],
        [0, 0, i + 1],
        [0, 1, i + 1],
        [0, 1, i],
      ]);
      faces.push([
        [side, 0, i + 1],
        [side, 0, i],
        [side, 1, i],
        [side, 1, i + 1],
      ]);
    }
    expect(2 * side * side * 4 * side).toBeGreaterThan(MAX_EDGE_CHECKS);
    const result = sharpEdges(quads(faces), OPTIONS);
    // The rim under every wall quad, and the four corners where two walls meet.
    expect(result.edgeCount).toBe(4 * side + 4);
    // The first plate quad (beside two walls) rounds; the last one, beside two walls too, is past the cap.
    expect(slotsOf(result, result.indices[0] ?? 0).some((d) => d < NO_EDGE)).toBe(true);
    const last = side * side - 1;
    expect(slotsOf(result, result.indices[last * 6] ?? 0).every((d) => d === NO_EDGE)).toBe(true);
  });
});

/** A UV sphere with shared vertices and smooth normals. */
function sphere(rings: number, segments: number): SceneMesh {
  const points: Vec3[] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * 2 * Math.PI;
      points.push([Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]);
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return testMesh(-1, points, {
    normals: new Float32Array(points.flat()),
    indices: new Uint32Array(indices),
    groups: [{ material: -1, start: 0, count: indices.length }],
  });
}

/** A hexagonal prism of radius 1 and height 1: a cap fan of six triangles around a shared centre, six side quads. */
function hexagonalPrism(): SceneMesh {
  const rim = (y: number): Vec3[] =>
    Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3), y, -Math.sin((i * Math.PI) / 3)] as Vec3);
  const top = rim(1);
  const bottom = rim(0);
  const points: Vec3[] = [[0, 1, 0], ...top];
  const normals: number[] = Array.from({ length: 7 }, () => [0, 1, 0]).flat();
  const indices: number[] = [];
  for (let i = 0; i < 6; i++) indices.push(0, 1 + i, 1 + ((i + 1) % 6));
  // Bottom cap, its own vertices, facing down.
  const bottomBase = points.length;
  points.push([0, 0, 0], ...bottom);
  normals.push(...Array.from({ length: 7 }, () => [0, -1, 0]).flat());
  for (let i = 0; i < 6; i++) indices.push(bottomBase, bottomBase + 1 + ((i + 1) % 6), bottomBase + 1 + i);
  const sides = quads(
    Array.from({ length: 6 }, (_, i) => {
      const j = (i + 1) % 6;
      return [bottom[i]!, bottom[j]!, top[j]!, top[i]!];
    }),
  );
  const base = points.length;
  points.push(
    ...(Array.from({ length: sides.positions.length / 3 }, (_, v) => [
      sides.positions[v * 3]!,
      sides.positions[v * 3 + 1]!,
      sides.positions[v * 3 + 2]!,
    ]) as Vec3[]),
  );
  normals.push(...sides.normals);
  indices.push(...[...sides.indices].map((i) => i + base));
  return testMesh(-1, points, {
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    groups: [{ material: -1, start: 0, count: indices.length }],
  });
}
