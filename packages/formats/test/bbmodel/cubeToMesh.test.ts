import { mat4NodeLocal, mat4TransformPoint, sharpEdges } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { cubeToMesh } from '../../src/bbmodel/cubeToMesh';
import { cubeTriangleCount, readCube } from '../../src/bbmodel/CubeSpec';
import type { ConverterContext } from '../../src/bbmodel/ElementConverter';
import { BbmodelError, loadBbmodel } from '../../src/index';
import { BbmodelWarningList } from '../../src/bbmodel/BbmodelWarning';
import { cube, model } from './fixtures';

const context: ConverterContext = {
  textureUvSizes: [{ width: 16, height: 16 }],
  textureIds: new Map([['tex-uuid', 0]]),
  resolution: { width: 16, height: 16 },
  boxUv: false,
  boxUvFloatSize: false,
  textureDoubleSided: [true],
  untexturedDoubleSided: true,
  maxStringChars: 1024,
  maxVertices: 400_000,
  maxFaceVertices: 16,
  warnings: new BbmodelWarningList(),
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

type Vec = [number, number, number];

const vertexAt = (mesh: { positions: Float32Array }, i: number): Vec => [
  mesh.positions[i * 3] ?? NaN,
  mesh.positions[i * 3 + 1] ?? NaN,
  mesh.positions[i * 3 + 2] ?? NaN,
];

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, x, k) => sum + x * (b[k] ?? 0), 0);

/** Per triangle: its geometric front (cross product of its winding), stored normal and centroid. */
function triangles(mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array }) {
  const out: { geometric: Vec; stored: Vec; centroid: Vec }[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a = 0, b = 0, c = 0] = mesh.indices.slice(t, t + 3);
    const [pa, pb, pc] = [vertexAt(mesh, a), vertexAt(mesh, b), vertexAt(mesh, c)];
    const ab = pb.map((x, k) => x - (pa[k] ?? 0));
    const ac = pc.map((x, k) => x - (pa[k] ?? 0));
    const [x1 = 0, y1 = 0, z1 = 0] = ab;
    const [x2 = 0, y2 = 0, z2 = 0] = ac;
    out.push({
      geometric: [y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2],
      stored: [mesh.normals[a * 3] ?? NaN, mesh.normals[a * 3 + 1] ?? NaN, mesh.normals[a * 3 + 2] ?? NaN],
      centroid: [0, 1, 2].map((k) => ((pa[k] ?? 0) + (pb[k] ?? 0) + (pc[k] ?? 0)) / 3) as Vec,
    });
  }
  return out;
}

/** Every triangle's front points away from (outward) or to (inward) the box centre, its stored normal along it. */
function expectWinding(
  mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array },
  side: 'outward' | 'inward',
) {
  const count = mesh.positions.length / 3;
  const centre = [0, 1, 2].map((k) => {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += mesh.positions[i * 3 + k] ?? 0;
    return sum / count;
  });
  for (const { geometric, stored, centroid } of triangles(mesh)) {
    const away = dot(
      geometric,
      centroid.map((x, k) => x - (centre[k] ?? 0)),
    );
    expect(side === 'outward' ? away : -away).toBeGreaterThan(0);
    const length = Math.hypot(...geometric);
    stored.forEach((x, k) => expect(x).toBeCloseTo((geometric[k] ?? 0) / length, 6));
  }
}

const FACE_ORDER = ['north', 'east', 'south', 'west', 'up', 'down'] as const;

/** Distinct y of the face's four vertices; faces are stored in Blockbench order when they share a group. */
function faceYs(mesh: { positions: Float32Array }, face: (typeof FACE_ORDER)[number]): number[] {
  const f = FACE_ORDER.indexOf(face);
  return [...new Set([0, 1, 2, 3].map((c) => vertexAt(mesh, f * 4 + c)[1]))];
}

/** The four corners of a face (Blockbench order, one group) as [x, y, z, u, v]. */
function faceVertices(mesh: { positions: Float32Array; uvs: Float32Array }, face: (typeof FACE_ORDER)[number]) {
  const f = FACE_ORDER.indexOf(face);
  return [0, 1, 2, 3].map((c) => {
    const v = f * 4 + c;
    return [...vertexAt(mesh, v), (mesh.uvs[v * 2] ?? NaN) * 16, (mesh.uvs[v * 2 + 1] ?? NaN) * 16].map((x) => x || 0);
  });
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
    expect(mesh.groups).toEqual([{ material: 0, start: 0, count: 36, doubleSided: true }]);
    expect(mesh.renderOrder).toBe(0);
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

  it('negative inflate shrinks; below −half a side it inverts the axis, as Blockbench does', () => {
    const shrunk = meshOf(
      cube({ from: [0, 0, 0], to: [4, 4, 4], inflate: -0.25, faces: allFaces(textured([0, 0, 1, 1])) }),
    );
    expect(containsPoint(positions(shrunk), [0.25, 0.25, 0.25])).toBe(true);
    expect(containsPoint(positions(shrunk), [3.75, 3.75, 3.75])).toBe(true);
    // y: half 0.125, extent (0.125 − 0.5) = −0.375 about 0.125, so y runs −0.25..0.5, reversed.
    const element = cube({ from: [0, 0, 0], to: [4, 0.25, 4], inflate: -0.5, faces: allFaces(textured([0, 0, 1, 1])) });
    expect(readCube(element, '$', context).reversed).toEqual([false, true, false]);
    const inverted = meshOf(element);
    expect(inverted.indices).toHaveLength(6 * 6);
    expect(containsPoint(positions(inverted), [0.5, -0.25, 0.5])).toBe(true);
    expect(containsPoint(positions(inverted), [3.5, 0.5, 3.5])).toBe(true);
    expectWinding(inverted, 'inward');
    // The up face lies at the bottom.
    expect(faceYs(inverted, 'up')).toEqual([-0.25]);
  });

  it('a flat cube keeps only its two large faces', () => {
    const mesh = meshOf(cube({ from: [0, 0, 0], to: [8, 0, 8], faces: allFaces(textured([0, 0, 1, 1])) }));
    expect(mesh.indices).toHaveLength(2 * 6);
    expect([...mesh.normals.slice(0, 3)].map((x) => x || 0)).toEqual([0, 1, 0]);
    expect([...mesh.normals.slice(12, 15)].map((x) => x || 0)).toEqual([0, -1, 0]);
  });

  it('texture null removes a face; false or no texture key draws it blank (material −1)', () => {
    const faces = {
      ...allFaces(textured([0, 0, 1, 1])),
      north: { uv: [0, 0, 1, 1], texture: null },
      east: { uv: [0, 0, 1, 1], texture: false },
      up: { uv: [0, 0, 1, 1] },
    };
    const mesh = meshOf(cube({ faces }));
    expect(mesh.indices).toHaveLength(5 * 6);
    expect(mesh.groups).toEqual([
      { material: -1, start: 0, count: 12, doubleSided: true },
      { material: 0, start: 12, count: 18, doubleSided: true },
    ]);
  });

  it('a removed face is not validated further and adds no triangles to the pre-count', () => {
    const spec = readCube(cube({ faces: { up: { texture: null, uv: 'nonsense', rotation: 45 } } }), '$', context);
    expect(spec.faces).toEqual([]);
    expect(cubeTriangleCount(spec)).toBe(0);
  });

  it('a texture uuid string resolves to its texture index; an unknown uuid is INVALID_FIELD', () => {
    const mesh = meshOf(cube({ faces: { up: textured([0, 0, 1, 1], { texture: 'tex-uuid' }) } }));
    expect(mesh.groups).toEqual([{ material: 0, start: 0, count: 6, doubleSided: true }]);
    expect(() => meshOf(cube({ faces: { up: textured([0, 0, 1, 1], { texture: 'other' }) } }))).toThrow(
      expect.objectContaining({ code: 'INVALID_FIELD', path: '$.elements[0].faces.up.texture' }) as Error,
    );
  });

  it('stretch scales the inflated box about its centre, not the UVs', () => {
    // centre 1, half 1, inflate 0.5 → extent (1 + 0.5) · stretch.
    const element = cube({
      from: [0, 0, 0],
      to: [2, 2, 2],
      inflate: 0.5,
      stretch: [2, 1, 0.5],
      faces: allFaces(textured([0, 0, 1, 1])),
    });
    const mesh = meshOf(element);
    expect(containsPoint(positions(mesh), [-2, -0.5, 0.25])).toBe(true);
    expect(containsPoint(positions(mesh), [4, 2.5, 1.75])).toBe(true);
    expect(mesh.uvs).toEqual(
      meshOf(cube({ from: [0, 0, 0], to: [2, 2, 2], faces: allFaces(textured([0, 0, 1, 1])) })).uvs,
    );
  });

  it('stretch must be three finite numbers', () => {
    expect(() => meshOf(cube({ stretch: [1, 1] }))).toThrow(
      expect.objectContaining({ code: 'INVALID_FIELD', path: '$.elements[0].stretch' }) as Error,
    );
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

/** A different uv per face, two of them turned: a mirrored or moved texture shows in the corner UVs. */
const DISTINCT_FACES = {
  north: textured([0, 0, 4, 2]),
  east: textured([4, 0, 8, 3], { rotation: 90 }),
  south: textured([8, 0, 12, 2]),
  west: textured([12, 0, 16, 3]),
  up: textured([0, 4, 4, 7], { rotation: 180 }),
  down: textured([4, 4, 8, 7]),
};
const FROM = [0, 0, 0];
const TO = [4, 2, 3];

/** The cube FROM..TO with from and to swapped on `axes`. */
function swapped(axes: readonly number[], extra: Record<string, unknown> = {}) {
  const from = FROM.map((x, k) => (axes.includes(k) ? (TO[k] ?? 0) : x));
  const to = TO.map((x, k) => (axes.includes(k) ? (FROM[k] ?? 0) : x));
  return cube({ from, to, faces: DISTINCT_FACES, ...extra });
}

describe('cubeToMesh: reversed axes (Blockbench setShape)', () => {
  const plain = meshOf(swapped([]));
  const reversedSets = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]];

  it.each(reversedSets.map((axes) => [axes.join(' ')]))(
    'from > to on axes %s mirrors every face about the centre, keeping its UVs',
    (names) => {
      const axes = names.split(' ').map(Number);
      expect(readCube(swapped(axes), '$', context).reversed).toEqual([0, 1, 2].map((k) => axes.includes(k)));
      const mesh = meshOf(swapped(axes));
      expect(mesh.indices).toEqual(plain.indices);
      expect(mesh.uvs).toEqual(plain.uvs);
      expect(mesh.uvRects).toEqual(plain.uvRects);
      for (let v = 0; v < plain.positions.length / 3; v++) {
        const mirrored = vertexAt(plain, v).map((x, k) => (axes.includes(k) ? (TO[k] ?? 0) - x : x));
        expect(vertexAt(mesh, v)).toEqual(mirrored);
      }
      expectWinding(mesh, axes.length % 2 === 1 ? 'inward' : 'outward');
    },
  );

  it('from > to on all axes is an inverted hull over the same corners', () => {
    const mesh = meshOf(swapped([0, 1, 2]));
    const sorted = (points: number[][]) => points.map((p) => p.join(',')).sort();
    expect(sorted(positions(mesh))).toEqual(sorted(positions(plain)));
    expectWinding(mesh, 'inward');
    // Each face sits where its opposite does on the plain cube, its normal (the geometric front) pointing inside.
    expect(faceVertices(mesh, 'east').every(([x]) => x === 0)).toBe(true);
    expect([...mesh.normals.slice(4 * 3, 4 * 3 + 3)]).toEqual([1, 0, 0]);
  });

  it('one reversed axis: the east face lies at min x facing inward, the faces across x show their uv mirrored', () => {
    const mesh = meshOf(swapped([0]));
    const plainEast = faceVertices(plain, 'east');
    expect(faceVertices(mesh, 'east')).toEqual(plainEast.map(([, y, z, u, v]) => [0, y, z, u, v]));
    // North: the corner that carried (u1, v1) at x = 4 now carries it at x = 0.
    expect(faceVertices(plain, 'north')[0]).toEqual([4, 2, 0, 0, 0]);
    expect(faceVertices(mesh, 'north')[0]).toEqual([0, 2, 0, 0, 0]);
    expectWinding(mesh, 'inward');
  });

  it('two reversed axes stay outward: the east texture shows on the west side, turned 180 degrees', () => {
    const mesh = meshOf(swapped([0, 1]));
    const east = faceVertices(mesh, 'east');
    expect(east.every(([x]) => x === 0)).toBe(true);
    expect([...mesh.normals.slice(4 * 3, 4 * 3 + 3)].map((x) => x || 0)).toEqual([-1, 0, 0]);
    // Each corner moved to the opposite corner of the y-z rectangle: a half turn of the image.
    faceVertices(plain, 'east').forEach(([, y = 0, z = 0, u, v], c) => expect(east[c]).toEqual([0, 2 - y, z, u, v]));
    expectWinding(mesh, 'outward');
  });

  it('mirrors in cube space, before the rotation about the origin', () => {
    const extra = { origin: [1, 2, 3], rotation: [22.5, 45, -30] };
    const turned = meshOf(swapped([0, 2], extra));
    const flat = meshOf(swapped([0, 2]));
    const rotation = mat4NodeLocal([0, 0, 0], [1, 2, 3], [22.5, 45, -30]);
    for (let v = 0; v < flat.positions.length / 3; v++) {
      mat4TransformPoint(rotation, vertexAt(flat, v)).forEach((x, k) =>
        expect(vertexAt(turned, v)[k]).toBeCloseTo(x, 5),
      );
    }
    expectWinding(turned, 'outward');
  });

  it('positive inflate shrinks a reversed axis and turns it back past zero', () => {
    // x: half −2; inflate 1 leaves −1 (reversed, 1..3), inflate 3 leaves +1 (not reversed, 1..3).
    const at = (inflate: number) =>
      readCube(cube({ from: [4, 0, 0], to: [0, 4, 4], inflate, faces: {} }), '$', context);
    expect(at(1)).toMatchObject({ min: [1, -1, -1], max: [3, 5, 5], reversed: [true, false, false] });
    expect(at(3)).toMatchObject({ min: [1, -3, -3], max: [3, 7, 7], reversed: [false, false, false] });
    // Exactly cancelled: zero thickness, not reversed.
    expect(at(2)).toMatchObject({ min: [2, -2, -2], max: [2, 6, 6], reversed: [false, false, false] });
  });

  it('a negative stretch inverts its axis and scales its magnitude', () => {
    const spec = readCube(cube({ from: [0, 0, 0], to: [4, 4, 4], stretch: [-2, 1, 1], faces: {} }), '$', context);
    expect(spec).toMatchObject({ min: [-2, 0, 0], max: [6, 4, 4], reversed: [true, false, false] });
    const stretched = (stretch: number[]) =>
      meshOf(cube({ from: [0, 0, 0], to: [4, 4, 4], stretch, faces: DISTINCT_FACES }));
    expectWinding(stretched([1, -1, 1]), 'inward');
    expectWinding(stretched([-1, -1, 1]), 'outward');
  });

  it('render_sides keeps its sidedness on a reversed cube', () => {
    const single = { ...context, textureDoubleSided: [false] };
    const element = swapped([0, 1, 2]);
    expect(meshOf(element).groups).toEqual([{ material: 0, start: 0, count: 36, doubleSided: true }]);
    expect(cubeToMesh(readCube(element, '$', single), -1).groups).toEqual([
      { material: 0, start: 0, count: 36, doubleSided: false },
    ]);
  });

  it('the largest coordinates the reader accepts give finite positions', () => {
    const element = cube({
      from: [1e7, 1e7, 1e7],
      to: [-1e7, -1e7, -1e7],
      inflate: -1e7,
      stretch: [1e7, -1e7, 1e7],
      faces: allFaces(textured([0, 0, 1, 1])),
    });
    expect(readCube(element, '$', context).reversed).toEqual([true, false, true]);
    for (const value of meshOf(element).positions) expect(Number.isFinite(value)).toBe(true);
  });

  it('box_uv on a reversed cube lays faces out from the signed, floored size, as Blockbench updateUV does', () => {
    // Signed sizes (floor(−4.5), −6, −2) = (−5, −6, −2) at offset (16, 16), Blockbench's face_list with these values.
    const faces = Object.fromEntries(FACE_ORDER.map((direction) => [direction, { texture: 0 }]));
    const element = cube({ from: [4.5, 6, 2], to: [0, 0, 0], faces, box_uv: true, uv_offset: [16, 16] });
    const uvs = Object.fromEntries(readCube(element, '$', context).faces.map((face) => [face.direction, face.uv]));
    expect(uvs).toEqual({
      east: [16, 14, 14, 8],
      west: [9, 14, 7, 8],
      up: [9, 14, 14, 16],
      down: [4, 16, 9, 14],
      south: [7, 14, 2, 8],
      north: [14, 14, 9, 8],
    });
  });

  it('the edges of an inverted hull are creases, those of the plain cube convex', () => {
    const options = { sharpAngleDeg: 30, reach: 0.5 };
    const angles = (mesh: Parameters<typeof sharpEdges>[0]) => [
      ...new Set([...sharpEdges(mesh, options).angles].filter((a) => a !== 0).map((a) => Math.round(a * 1e4) / 1e4)),
    ];
    const quarter = Math.round((Math.PI / 2) * 1e4) / 1e4;
    expect(sharpEdges(meshOf(swapped([0, 1, 2])), options).edgeCount).toBe(12);
    expect(angles(meshOf(swapped([0, 1, 2])))).toEqual([-quarter]);
    expect(angles(meshOf(swapped([1])))).toEqual([-quarter]);
    expect(angles(meshOf(swapped([0, 2])))).toEqual([quarter]);
    expect(angles(plain)).toEqual([quarter]);
  });
});
