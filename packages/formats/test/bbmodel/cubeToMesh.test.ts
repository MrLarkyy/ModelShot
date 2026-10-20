import { describe, expect, it } from 'vitest';
import { cubeToMesh } from '../../src/bbmodel/cubeToMesh';
import { readCube } from '../../src/bbmodel/CubeSpec';
import type { ConverterContext } from '../../src/bbmodel/ElementConverter';
import { BbmodelError, loadBbmodel } from '../../src/index';
import { cube, model } from './fixtures';

const context: ConverterContext = {
  textureUvSizes: [{ width: 16, height: 16 }],
  resolution: { width: 16, height: 16 },
  boxUv: false,
  maxStringChars: 1024,
};

function meshOf(element: Record<string, unknown>) {
  return cubeToMesh(readCube(element, '$.elements[0]', context), -1);
}

function positions(mesh: { positions: Float32Array }): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) out.push([...mesh.positions.slice(i, i + 3)].map((x) => x || 0));
  return out;
}

function containsPoint(points: number[][], point: number[]): boolean {
  return points.some((p) => p.every((x, k) => Math.abs(x - (point[k] ?? NaN)) < 1e-6));
}

const textured = (uv: number[], extra: Record<string, unknown> = {}) => ({ uv, texture: 0, ...extra });
const allFaces = (face: Record<string, unknown>) => ({
  north: face,
  east: face,
  south: face,
  west: face,
  up: face,
  down: face,
});

describe('cubeToMesh', () => {
  it('builds 24 vertices and 12 triangles for a full cube', () => {
    const mesh = meshOf(cube({ faces: allFaces(textured([0, 0, 1, 1])) }));
    expect(mesh.positions).toHaveLength(24 * 3);
    expect(mesh.indices).toHaveLength(12 * 3);
    expect(mesh.groups).toEqual([{ material: 0, start: 0, count: 36 }]);
  });

  it('bakes 90° about Z around an off-centre origin into the vertices', () => {
    // Cube (2..4, 0..2, 0..1) turned 90° about Z around (4, 0, 0): (x, y) → (4 − y, x − 4).
    const mesh = meshOf(
      cube({
        from: [2, 0, 0],
        to: [4, 2, 1],
        origin: [4, 0, 0],
        rotation: [0, 0, 90],
        faces: allFaces(textured([0, 0, 1, 1])),
      }),
    );
    const points = positions(mesh);
    expect(containsPoint(points, [4, -2, 0])).toBe(true); // (2, 0, 0)
    expect(containsPoint(points, [2, 0, 1])).toBe(true); // (4, 2, 1)
    expect(containsPoint(points, [2, -2, 0])).toBe(true); // (2, 2, 0)
    expect(containsPoint(points, [2, 0, 0])).toBe(true); // (4, 2, 0)
  });

  it('inflate grows positions, not UVs', () => {
    const plain = meshOf(cube({ faces: allFaces(textured([0, 0, 1, 1])) }));
    const grown = meshOf(cube({ inflate: 0.5, faces: allFaces(textured([0, 0, 1, 1])) }));
    expect(containsPoint(positions(grown), [-0.5, -0.5, -0.5])).toBe(true);
    expect(containsPoint(positions(grown), [1.5, 1.5, 1.5])).toBe(true);
    expect(grown.uvs).toEqual(plain.uvs);
    expect(grown.uvRects).toEqual(plain.uvRects);
  });

  it('negative inflate shrinks, and collapses an axis to its centre instead of inverting it', () => {
    const shrunk = meshOf(
      cube({ from: [0, 0, 0], to: [4, 4, 4], inflate: -0.25, faces: allFaces(textured([0, 0, 1, 1])) }),
    );
    expect(containsPoint(positions(shrunk), [0.25, 0.25, 0.25])).toBe(true);
    expect(containsPoint(positions(shrunk), [3.75, 3.75, 3.75])).toBe(true);
    const collapsed = meshOf(
      cube({ from: [0, 0, 0], to: [4, 0.25, 4], inflate: -0.5, faces: allFaces(textured([0, 0, 1, 1])) }),
    );
    expect(collapsed.indices).toHaveLength(2 * 6);
    for (const value of collapsed.positions) expect(Number.isFinite(value)).toBe(true);
    expect(positions(collapsed).every(([, y]) => y === 0.125)).toBe(true);
  });

  it('a flat cube keeps only its two large faces', () => {
    const mesh = meshOf(cube({ from: [0, 0, 0], to: [8, 0, 8], faces: allFaces(textured([0, 0, 1, 1])) }));
    expect(mesh.indices).toHaveLength(2 * 6);
    expect([...mesh.normals.slice(0, 3)].map((x) => x || 0)).toEqual([0, 1, 0]);
    expect([...mesh.normals.slice(12, 15)].map((x) => x || 0)).toEqual([0, -1, 0]);
  });

  it('texture false drops a face, null keeps it with material −1', () => {
    const faces = {
      ...allFaces(textured([0, 0, 1, 1])),
      east: { uv: [0, 0, 1, 1], texture: false },
      up: { uv: [0, 0, 1, 1], texture: null },
    };
    const mesh = meshOf(cube({ faces }));
    expect(mesh.indices).toHaveLength(5 * 6);
    expect(mesh.groups).toEqual([
      { material: -1, start: 0, count: 6 },
      { material: 0, start: 6, count: 24 },
    ]);
  });

  it('a texture index outside the textures is INVALID_FIELD', () => {
    const json = JSON.stringify(
      model({ elements: [cube({ faces: { north: textured([0, 0, 1, 1], { texture: 99 }) } })] }),
    );
    expect(() => loadBbmodel(json)).toThrow(BbmodelError);
    try {
      loadBbmodel(json);
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_FIELD', path: '$.elements[0].faces.north.texture' });
    }
  });

  it('winds every triangle counter-clockwise from outside, with mirrored, rotated and turned UVs', () => {
    const faces = {
      north: textured([4, 0, 0, 4], { rotation: 90 }),
      east: textured([0, 4, 4, 0]),
      south: textured([4, 4, 0, 0], { rotation: 180 }),
      west: textured([0, 0, 4, 4], { rotation: 270 }),
      up: textured([4, 0, 0, 4]),
      down: textured([0, 4, 4, 0], { rotation: 90 }),
    };
    for (const rotation of [
      [0, 0, 0],
      [22.5, 45, -30],
      [0, 90, 0],
    ]) {
      const mesh = meshOf(cube({ from: [-1, -2, -3], to: [3, 2, 1], origin: [1, 1, 1], rotation, faces }));
      const p = (i: number) => [...mesh.positions.slice(i * 3, i * 3 + 3)];
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const [a = 0, b = 0, c = 0] = mesh.indices.slice(t, t + 3);
        const ab = p(b).map((x, k) => x - (p(a)[k] ?? 0));
        const ac = p(c).map((x, k) => x - (p(a)[k] ?? 0));
        const geometric = [
          (ab[1] ?? 0) * (ac[2] ?? 0) - (ab[2] ?? 0) * (ac[1] ?? 0),
          (ab[2] ?? 0) * (ac[0] ?? 0) - (ab[0] ?? 0) * (ac[2] ?? 0),
          (ab[0] ?? 0) * (ac[1] ?? 0) - (ab[1] ?? 0) * (ac[0] ?? 0),
        ];
        const stored = [...mesh.normals.slice(a * 3, a * 3 + 3)];
        expect(geometric.reduce((sum, x, k) => sum + x * (stored[k] ?? 0), 0)).toBeGreaterThan(0);
        // The stored normal points away from the cube centre (rotation is rigid about the origin).
        const centre = [...mesh.positions].reduce<number[]>((acc, x, i) => {
          acc[i % 3] = (acc[i % 3] ?? 0) + x / (mesh.positions.length / 3);
          return acc;
        }, []);
        const outward = p(a).map((x, k) => x - (centre[k] ?? 0));
        expect(outward.reduce((sum, x, k) => sum + x * (stored[k] ?? 0), 0)).toBeGreaterThan(0);
      }
    }
  });
});
