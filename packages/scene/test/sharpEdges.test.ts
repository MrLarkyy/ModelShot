import { describe, expect, it } from 'vitest';
import {
  EDGE_SLOTS,
  MAX_EDGE_WORK,
  NO_EDGE,
  sceneSharpEdges,
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

  it('is identical across runs and cached per document for the latest options', () => {
    const mesh = box([0, 0, 0], [1, 2, 3]);
    const a = sharpEdges(mesh, OPTIONS);
    const b = sharpEdges(mesh, OPTIONS);
    expect([...a.distances]).toEqual([...b.distances]);
    expect([...a.angles]).toEqual([...b.angles]);
    const meshes = [mesh, box([4, 0, 0], [5, 1, 1])];
    const cached = sceneSharpEdges(meshes, OPTIONS);
    expect([...(cached[0]?.distances ?? [])]).toEqual([...a.distances]);
    expect(sceneSharpEdges(meshes, { ...OPTIONS })).toBe(cached);
    const steeper = sceneSharpEdges(meshes, { ...OPTIONS, sharpAngleDeg: 40 });
    expect(steeper).not.toBe(cached);
    // Only the latest options are kept: going back detects again.
    expect(sceneSharpEdges(meshes, OPTIONS)).not.toBe(cached);
    expect(sceneSharpEdges([...meshes], OPTIONS)).not.toBe(cached);
  });

  it('bounds the slot search of a whole document: past MAX_EDGE_WORK later triangles and meshes round nothing', () => {
    // Fine walled plates (cells of 0.01 within a reach of 4): every plate triangle visits all 404 sharp edges.
    const plates = Array.from({ length: 6 }, (_, i) => walledPlate(100, 0.01, i * 2));
    const work = { used: 0 };
    const first = sharpEdges(plates[0]!, OPTIONS, work);
    const perPlate = work.used;
    expect(first.edgeCount).toBe(404);
    expect(roundedVertices(first)).toBeGreaterThan(0);
    expect(perPlate * plates.length).toBeGreaterThan(MAX_EDGE_WORK);
    const all = sceneSharpEdges(plates, OPTIONS);
    expect([...(all[0]?.distances ?? [])]).toEqual([...first.distances]);
    const last = all[plates.length - 1]!;
    // The last plate still finds its edges but rounds none of them: the document's budget is spent.
    expect(last.edgeCount).toBe(404);
    expect(roundedVertices(last)).toBe(0);
    // The work stops within one triangle's candidates of the budget.
    const shared = { used: 0 };
    for (const plate of plates) sharpEdges(plate, OPTIONS, shared);
    expect(shared.used).toBeLessThan(MAX_EDGE_WORK + 404 * 16);
  });

  it('keeps exact matching beside a far vertex: a unit cube with a triangle at x = -1e17 keeps its 12 edges', () => {
    const cube = box([0, 0, 0], [1, 1, 1]);
    const base = cube.positions.length / 3;
    const far = quads([
      [
        [-1e17, 0, 0],
        [-1e17, 1, 0],
        [-1e17, 1, 1],
        [-1e17, 0, 1],
      ],
    ]);
    const mesh = testMesh(-1, [], {
      positions: Float32Array.from([...cube.positions, ...far.positions]),
      normals: Float32Array.from([...cube.normals, ...far.normals]),
      indices: Uint32Array.from([...cube.indices, ...[...far.indices].map((i) => i + base)]),
    });
    expect(sharpEdges(mesh, OPTIONS).edgeCount).toBe(12);
    // -0 and 0 still weld: a cube whose corners at the origin are written -0 keeps its edges.
    const signed = box([0, 0, 0], [1, 1, 1]);
    const positions = signed.positions.map((x) => (x === 0 ? -0 : x));
    positions.forEach((x, i) => {
      if (i % 7 === 0 && x === 0) positions[i] = 0;
    });
    expect(sharpEdges({ ...signed, positions }, OPTIONS).edgeCount).toBe(12);
  });

  it('matches positions and edges by sorting: a coarse grid that crowds any hash stays fast', () => {
    // Every quantised coordinate a multiple of 2^20 (65 536 units): a multiplicative hash with linear probing put all
    // of them into one probe chain (120 000 vertices took 10 s). Quads with their own vertices share every edge.
    const side = 317;
    const step = 65536;
    const faces: Vec3[][] = [];
    for (let z = 0; z < side; z++) {
      for (let x = 0; x < side; x++) {
        faces.push([
          [x * step, 0, (z + 1) * step],
          [(x + 1) * step, 0, (z + 1) * step],
          [(x + 1) * step, 0, z * step],
          [x * step, 0, z * step],
        ]);
      }
    }
    // A low wall along the first row makes sharp edges, so the slot search and the vertex split run too.
    for (let x = 0; x < side; x++) {
      faces.push([
        [(x + 1) * step, 0, 0],
        [x * step, 0, 0],
        [x * step, step, 0],
        [(x + 1) * step, step, 0],
      ]);
    }
    const mesh = quads(faces);
    expect(mesh.positions.length / 3).toBeGreaterThan(400_000);
    const start = performance.now();
    const result = sharpEdges(mesh, OPTIONS);
    const elapsed = performance.now() - start;
    expect(result.edgeCount).toBe(side);
    // About 0.3 s here; the bound only catches a quadratic return, never a slow machine.
    expect(elapsed).toBeLessThan(5000);
  });

  it('takes one of nearly parallel rim edges: a smooth cylinder wall rounds its own top and bottom edge only', () => {
    const cylinder = smoothCylinder(16);
    const result = sharpEdges(cylinder, OPTIONS);
    expect(result.edgeCount).toBe(32);
    // Wall triangles come after the two caps' 16 triangles each.
    for (let t = 32; t < 64; t++) {
      for (let c = 0; c < 3; c++) {
        const v = result.indices[t * 3 + c] ?? 0;
        expect(
          slotsOf(result, v).filter((d) => d < NO_EDGE),
          `triangle ${t}`,
        ).toHaveLength(2);
      }
    }
    // Both triangles of a wall quad share their vertices: no seam along the diagonal.
    for (let q = 0; q < 16; q++) {
      const t = 32 + q * 2;
      expect(result.indices[t * 3]).toBe(result.indices[(t + 1) * 3]);
      expect(result.indices[t * 3 + 2]).toBe(result.indices[(t + 1) * 3 + 1]);
    }
  });

  it('applies an edge only beside its segment: the corner square of an L rounds its own two edges', () => {
    const result = sharpEdges(lPrism(), { sharpAngleDeg: 30, reach: 0.9 });
    // The top's first quad is the cell at the outer corner, diagonal to the inner (concave) corner at (1, 1).
    for (let t = 0; t < 2; t++) {
      for (let c = 0; c < 3; c++) {
        const v = result.indices[t * 3 + c] ?? 0;
        expect(
          slotsOf(result, v).filter((d) => d < NO_EDGE),
          `triangle ${t}`,
        ).toHaveLength(2);
      }
    }
    // The cell beside an inner edge does round it.
    const besideInner = 2 * 2; // cell (1, 0)'s first triangle
    const v = result.indices[besideInner * 3] ?? 0;
    expect(slotsOf(result, v).filter((d) => d < NO_EDGE).length).toBeGreaterThanOrEqual(2);
  });
});

/** A plate of side x side square cells of size `cell` at x offset `x0`, walled on all four sides one cell high. */
function walledPlate(side: number, cell: number, x0: number): SceneMesh {
  const faces: Vec3[][] = [];
  const at = (i: number) => i * cell;
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      faces.push([
        [x0 + at(x), 0, at(z + 1)],
        [x0 + at(x + 1), 0, at(z + 1)],
        [x0 + at(x + 1), 0, at(z)],
        [x0 + at(x), 0, at(z)],
      ]);
    }
  }
  const h = cell;
  const end = at(side);
  for (let i = 0; i < side; i++) {
    faces.push([
      [x0 + at(i + 1), 0, 0],
      [x0 + at(i), 0, 0],
      [x0 + at(i), h, 0],
      [x0 + at(i + 1), h, 0],
    ]);
    faces.push([
      [x0 + at(i), 0, end],
      [x0 + at(i + 1), 0, end],
      [x0 + at(i + 1), h, end],
      [x0 + at(i), h, end],
    ]);
    faces.push([
      [x0, 0, at(i)],
      [x0, 0, at(i + 1)],
      [x0, h, at(i + 1)],
      [x0, h, at(i)],
    ]);
    faces.push([
      [x0 + end, 0, at(i + 1)],
      [x0 + end, 0, at(i)],
      [x0 + end, h, at(i)],
      [x0 + end, h, at(i + 1)],
    ]);
  }
  return quads(faces);
}

/** A cylinder of radius 1 and height 2: two flat caps (fans, own vertices), a smooth wall of shared vertices. */
function smoothCylinder(segments: number): SceneMesh {
  const points: Vec3[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const ring = (y: number): Vec3[] =>
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * 2 * Math.PI;
      return [Math.cos(a), y, -Math.sin(a)] as Vec3;
    });
  const cap = (y: number, up: boolean) => {
    const base = points.length;
    points.push([0, y, 0], ...ring(y));
    for (let i = 0; i <= segments; i++) normals.push(0, up ? 1 : -1, 0);
    for (let i = 0; i < segments; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % segments);
      indices.push(...(up ? [base, a, b] : [base, b, a]));
    }
  };
  cap(2, true);
  cap(0, false);
  const bottom = points.length;
  points.push(...ring(0));
  const top = points.length;
  points.push(...ring(2));
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * 2 * Math.PI;
      normals.push(Math.cos(a), 0, -Math.sin(a));
    }
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    indices.push(bottom + i, bottom + j, top + j, bottom + i, top + j, top + i);
  }
  return testMesh(-1, points, {
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    groups: [{ material: -1, start: 0, count: indices.length }],
  });
}

/**
 * An L-shaped prism one unit high: top cells (0, 0), (1, 0) and (0, 1) of unit size (first), then walls around the L,
 * one quad per unit of its outline. The concave corner is at (1, 1).
 */
function lPrism(): SceneMesh {
  const faces: Vec3[][] = [];
  for (const [x, z] of [
    [0, 0],
    [1, 0],
    [0, 1],
  ] as const) {
    faces.push([
      [x, 1, z],
      [x, 1, z + 1],
      [x + 1, 1, z + 1],
      [x + 1, 1, z],
    ]);
  }
  const outline: [number, number][] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 2],
    [0, 2],
    [0, 1],
  ];
  outline.forEach(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length]!;
    faces.push([
      [bx, 0, bz],
      [ax, 0, az],
      [ax, 1, az],
      [bx, 1, bz],
    ]);
  });
  return quads(faces);
}

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
