import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { batchScene } from '../src/batchScene';
import {
  backSidesVisible,
  closedOpaqueMeshes,
  closedSurface,
  meshFacesOpaque,
  textureOpacityOf,
  translucentTexelsIn,
  worldBounds,
} from '../src/closedOpaque';
import { quadScene } from './testScene';

/** Faces of the unit cube, each wound counter-clockwise seen from outside, as four corner indices into CORNERS. */
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
] as const;
const FACES = [
  [4, 5, 6, 7], // +z
  [1, 0, 3, 2], // −z
  [5, 1, 2, 6], // +x
  [0, 4, 7, 3], // −x
  [7, 6, 2, 3], // +y
  [0, 1, 5, 4], // −y
] as const;

/** A cube as the loader writes it: every face its own four vertices, two triangles per face. */
function cube(faces: readonly (readonly number[])[] = FACES): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, f) => {
    for (const corner of face) positions.push(...CORNERS[corner as 0]);
    indices.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe('closedSurface', () => {
  it('a cube with its own vertices per face is closed (edges matched by position)', () => {
    const { positions, indices } = cube();
    expect(closedSurface(positions, indices)).toBe(true);
  });

  it('a cube sharing its eight corners is closed', () => {
    const indices = FACES.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
    expect(closedSurface(new Float32Array(CORNERS.flat()), indices)).toBe(true);
  });

  it('an open sheet is not closed', () => {
    const { positions, indices } = cube([FACES[0]]);
    expect(closedSurface(positions, indices)).toBe(false);
  });

  it('a cube with a missing face is not closed', () => {
    const { positions, indices } = cube(FACES.slice(0, 5));
    expect(closedSurface(positions, indices)).toBe(false);
  });

  it('a cube with one face wound the other way is not closed', () => {
    const faces = FACES.map((face, f) => (f === 2 ? [...face].reverse() : face));
    const { positions, indices } = cube(faces);
    expect(closedSurface(positions, indices)).toBe(false);
  });

  it('duplicated faces are not closed: a repeated face, a coincident opposite face, the whole cube twice', () => {
    const repeated = cube([...FACES, FACES[0]]);
    expect(closedSurface(repeated.positions, repeated.indices)).toBe(false);
    const opposite = cube([...FACES, [...FACES[0]].reverse()]);
    expect(closedSurface(opposite.positions, opposite.indices)).toBe(false);
    const twice = cube([...FACES, ...FACES]);
    expect(closedSurface(twice.positions, twice.indices)).toBe(false);
  });

  it('two separate closed cubes in one mesh are closed; no triangle at all is not', () => {
    const one = cube();
    const positions = new Float32Array([...one.positions, ...one.positions.map((v, i) => (i % 3 === 0 ? v + 3 : v))]);
    const indices = [...one.indices, ...one.indices.map((i) => i + 24)];
    expect(closedSurface(positions, indices)).toBe(true);
    expect(closedSurface(positions, [])).toBe(false);
  });

  it('ignores collapsed triangles (two corners at one position)', () => {
    const { positions, indices } = cube();
    expect(closedSurface(positions, [...indices, 0, 0, 1])).toBe(true);
    expect(closedSurface(positions, [0, 0, 1])).toBe(false);
  });
});

/** A 4 x 4 RGBA image, every alpha 255 except the texels listed as [x, y, alpha]. */
function image(holes: readonly (readonly [number, number, number])[]): Uint8Array {
  const rgba = new Uint8Array(4 * 4 * 4).fill(255);
  for (const [x, y, alpha] of holes) rgba[(y * 4 + x) * 4 + 3] = alpha;
  return rgba;
}

describe('texture opacity', () => {
  it('every alpha byte 255 is opaque, with no table', () => {
    expect(textureOpacityOf(image([]), 4, 4)).toBe('opaque');
  });

  it('counts translucent texels inside a UV rectangle, by the shader texel range', () => {
    const table = textureOpacityOf(image([[2, 1, 0]]), 4, 4);
    if (typeof table === 'string') throw new Error('expected a table');
    // Texel (2, 1) spans u 0.5..0.75, v 0.25..0.5.
    expect(translucentTexelsIn(table, [0.5, 0.25, 0.75, 0.5])).toBe(1);
    expect(translucentTexelsIn(table, [0, 0, 1, 1])).toBe(1);
    // The left half and the top row miss it, also with a rectangle given max-first (mirrored UVs).
    expect(translucentTexelsIn(table, [0, 0, 0.5, 1])).toBe(0);
    expect(translucentTexelsIn(table, [1, 0.25, 0, 0])).toBe(0);
    // A byte of 254 counts as translucent too.
    const nearly = textureOpacityOf(image([[0, 0, 254]]), 4, 4);
    if (typeof nearly === 'string') throw new Error('expected a table');
    expect(translucentTexelsIn(nearly, [0, 0, 0.25, 0.25])).toBe(1);
  });
});

/** The test quad's scene with its mesh replaced by a unit cube whose faces use `rect`, double-sided by default. */
function cubeDoc(rect: readonly number[], overrides: Partial<SceneMesh> = {}): SceneDocument {
  const base = quadScene();
  const { positions, indices } = cube();
  const mesh: SceneMesh = {
    ...base.meshes[0]!,
    positions,
    normals: new Float32Array(positions.length),
    uvs: new Float32Array((positions.length / 3) * 2),
    uvRects: new Float32Array(Array.from({ length: positions.length / 3 }, () => rect).flat()),
    indices,
    groups: [{ material: 0, start: 0, count: indices.length, doubleSided: true }],
    ...overrides,
  };
  return { ...base, meshes: [mesh] };
}

describe('closedOpaqueMeshes', () => {
  const holeAt21 = textureOpacityOf(image([[2, 1, 0]]), 4, 4);

  it('a cut-out texel inside a face rectangle makes the cube not opaque', () => {
    expect(closedOpaqueMeshes(cubeDoc([0.5, 0, 1, 0.5]), [holeAt21])).toEqual([false]);
  });

  it('a cut-out outside every face rectangle leaves the cube opaque', () => {
    expect(closedOpaqueMeshes(cubeDoc([0, 0, 0.5, 0.5]), [holeAt21])).toEqual([true]);
  });

  it('a failed readback counts as not opaque; an opaque texture, the opaque mode and no texture count as opaque', () => {
    const doc = cubeDoc([0, 0, 1, 1]);
    expect(closedOpaqueMeshes(doc, ['unknown'])).toEqual([false]);
    expect(closedOpaqueMeshes(doc, ['opaque'])).toEqual([true]);
    const opaqueMode = { ...doc, materials: [{ name: 'm', texture: 0, alphaMode: 'opaque' as const }] };
    expect(closedOpaqueMeshes(opaqueMode, [holeAt21])).toEqual([true]);
    const untextured = { ...doc, materials: [{ name: 'm', texture: -1 }] };
    expect(closedOpaqueMeshes(untextured, ['unknown'])).toEqual([true]);
  });

  it('only double-sided meshes are checked; an open double-sided sheet is not closed', () => {
    const single = cubeDoc([0, 0, 1, 1]);
    const groups = [{ material: 0, start: 0, count: 36 }];
    expect(closedOpaqueMeshes({ ...single, meshes: [{ ...single.meshes[0]!, groups }] }, ['opaque'])).toEqual([false]);
    const sheet = cubeDoc([0, 0, 1, 1], {
      groups: [{ material: 0, start: 0, count: 30, doubleSided: true }],
    });
    expect(closedOpaqueMeshes(sheet, ['opaque'])).toEqual([false]);
  });

  it('closedness spans the mesh groups: two textures on one cube still close it', () => {
    const doc = cubeDoc([0, 0, 1, 1], {
      groups: [
        { material: 0, start: 0, count: 18, doubleSided: true },
        { material: 1, start: 18, count: 18, doubleSided: true },
      ],
    });
    const twoTextures = { ...doc, materials: [...doc.materials, { name: 'n', texture: 0 }] };
    expect(closedOpaqueMeshes(twoTextures, ['opaque'])).toEqual([true]);
    expect(meshFacesOpaque(twoTextures, twoTextures.meshes[0]!, ['unknown'])).toBe(false);
  });

  it('batchScene keeps closed opaque meshes apart from the others', () => {
    const doc = cubeDoc([0, 0, 1, 1]);
    const two = { ...doc, meshes: [doc.meshes[0]!, doc.meshes[0]!] };
    const batches = batchScene(two, [true, false]);
    expect(batches.map((batch) => batch.closedOpaque)).toEqual([true, false]);
    expect(batchScene(two).map((batch) => batch.closedOpaque)).toEqual([false]);
  });
});

describe('backSidesVisible', () => {
  // Looking down −z from z = 10: the view matrix translates by −10 along z.
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1];
  const bounds = [-1, -1, -1, 1, 1, 1];

  it('outside the bounds and beyond the near plane: hidden', () => {
    expect(backSidesVisible(bounds, [0, 0, 10], view, 1)).toBe(false);
  });

  it('the camera inside the bounds: visible', () => {
    expect(backSidesVisible(bounds, [0, 0, 0.5], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -0.5, 1], 0.1)).toBe(true);
  });

  it('the near plane reaching the bounds (a clipped front face opens the surface): visible', () => {
    expect(backSidesVisible(bounds, [0, 0, 10], view, 9.5)).toBe(true);
  });
});

describe('worldBounds', () => {
  it('bounds the positions under the model matrix', () => {
    const model = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 5, 0, 0, 1]; // 90 degrees about y, then x + 5
    expect([...worldBounds(new Float32Array([0, 0, 0, 1, 2, 3]), model)]).toEqual([5, 0, -1, 8, 2, 0]);
  });
});
