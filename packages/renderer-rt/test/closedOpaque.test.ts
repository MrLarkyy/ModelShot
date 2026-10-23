import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { batchScene } from '../src/batchScene';
import {
  backSidesVisible,
  closedOpaqueMeshes,
  closedSolid,
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

describe('closedSolid', () => {
  it('a cube with its own vertices per face is closed (edges matched by position)', () => {
    const { positions, indices } = cube();
    expect(closedSolid(positions, indices)).toBe(true);
  });

  it('a cube sharing its eight corners is closed', () => {
    const indices = FACES.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
    expect(closedSolid(new Float32Array(CORNERS.flat()), indices)).toBe(true);
  });

  it('an open sheet is not closed', () => {
    const { positions, indices } = cube([FACES[0]]);
    expect(closedSolid(positions, indices)).toBe(false);
  });

  it('a cube with a missing face is not closed', () => {
    const { positions, indices } = cube(FACES.slice(0, 5));
    expect(closedSolid(positions, indices)).toBe(false);
  });

  it('a cube with one face wound the other way is not closed', () => {
    const faces = FACES.map((face, f) => (f === 2 ? [...face].reverse() : face));
    const { positions, indices } = cube(faces);
    expect(closedSolid(positions, indices)).toBe(false);
  });

  it('duplicated faces are not closed: a repeated face, a coincident opposite face, the whole cube twice', () => {
    const repeated = cube([...FACES, FACES[0]]);
    expect(closedSolid(repeated.positions, repeated.indices)).toBe(false);
    const opposite = cube([...FACES, [...FACES[0]].reverse()]);
    expect(closedSolid(opposite.positions, opposite.indices)).toBe(false);
    const twice = cube([...FACES, ...FACES]);
    expect(closedSolid(twice.positions, twice.indices)).toBe(false);
  });

  it('two disjoint outward cubes in one mesh are a solid; no triangle at all is not', () => {
    const one = cube();
    const positions = new Float32Array([...one.positions, ...one.positions.map((v, i) => (i % 3 === 0 ? v + 3 : v))]);
    const indices = [...one.indices, ...one.indices.map((i) => i + 24)];
    expect(closedSolid(positions, indices)).toBe(true);
    expect(closedSolid(positions, [])).toBe(false);
  });

  it('an inside-out cube (every face reversed, as Blockbench Invert Faces) is not a solid wound outward', () => {
    const { positions, indices } = cube(FACES.map((face) => [...face].reverse()));
    expect(closedSolid(positions, indices)).toBe(false);
  });

  it('a coincident opposite pair of quads with different diagonals encloses no volume', () => {
    // The same unit square twice: once facing +z split along 0-2, once facing −z split along 1-3.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const indices = [0, 1, 2, 0, 2, 3, 1, 0, 3, 1, 3, 2];
    expect(closedSolid(positions, indices)).toBe(false);
  });

  /** The unit cube scaled by `scale` about its centre, wound inward when `inward`. */
  function shell(scale: number, inward: boolean, offset = 0): { positions: number[]; indices: number[] } {
    const { positions, indices } = cube(inward ? FACES.map((face) => [...face].reverse()) : FACES);
    return {
      positions: [...positions].map((v) => (v - 0.5) * scale + 0.5),
      indices: [...indices].map((i) => i + offset),
    };
  }

  it('a cube with a cavity (an inner shell wound towards it) or an inner shell wound outward is not accepted', () => {
    const outer = shell(1, false);
    const cavity = shell(0.5, true, 24);
    expect(
      closedSolid(new Float32Array([...outer.positions, ...cavity.positions]), [...outer.indices, ...cavity.indices]),
    ).toBe(false);
    const nested = shell(0.5, false, 24);
    expect(
      closedSolid(new Float32Array([...outer.positions, ...nested.positions]), [...outer.indices, ...nested.indices]),
    ).toBe(false);
  });

  it('ignores collapsed triangles (two corners at one position)', () => {
    const { positions, indices } = cube();
    expect(closedSolid(positions, [...indices, 0, 0, 1])).toBe(true);
    expect(closedSolid(positions, [0, 0, 1])).toBe(false);
  });
});

/** A 4 x 4 RGBA image, every alpha 255 except the texels listed as [x, y, alpha]. */
function image(holes: readonly (readonly [number, number, number])[]): Uint8Array {
  const rgba = new Uint8Array(4 * 4 * 4).fill(255);
  for (const [x, y, alpha] of holes) rgba[(y * 4 + x) * 4 + 3] = alpha;
  return rgba;
}

const CLAMP = { wrap: 'clamp', frames: 1 } as const;
const REPEAT = { wrap: 'repeat', frames: 1 } as const;

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

  it('a rectangle past the image reads the edge texels when clamped', () => {
    const table = textureOpacityOf(image([[0, 1, 0]]), 4, 4);
    if (typeof table === 'string') throw new Error('expected a table');
    // u 1..1.5 clamps to column 3: no hole; u -0.5..0 clamps to column 0, row 1 holds the hole.
    expect(translucentTexelsIn(table, [1, 0, 1.5, 1])).toBe(0);
    expect(translucentTexelsIn(table, [-0.5, 0.25, 0, 0.5])).toBe(1);
  });

  it('with repeat counts the texels a range wraps onto, each once', () => {
    const table = textureOpacityOf(image([[0, 1, 0]]), 4, 4);
    if (typeof table === 'string') throw new Error('expected a table');
    // u 1..1.25 is column 4, which repeats as column 0.
    expect(translucentTexelsIn(table, [1, 0.25, 1.25, 0.5], CLAMP)).toBe(0);
    expect(translucentTexelsIn(table, [1, 0.25, 1.25, 0.5], REPEAT)).toBe(1);
    // A negative start: u -0.25..0 is column -1, i.e. column 3; -0.25..0.25 crosses the edge into column 0.
    expect(translucentTexelsIn(table, [-0.25, 0, 0, 1], REPEAT)).toBe(0);
    expect(translucentTexelsIn(table, [-0.25, 0, 0.25, 1], REPEAT)).toBe(1);
    // Wider than the image: every column, the hole counted once.
    expect(translucentTexelsIn(table, [-1, 0, 2, 1], REPEAT)).toBe(1);
    // Wrapped in v too: v 1.25..1.5 is row 1 again.
    expect(translucentTexelsIn(table, [0, 1.25, 0.25, 1.5], REPEAT)).toBe(1);
    expect(translucentTexelsIn(table, [0, 1.25, 0.25, 1.5], CLAMP)).toBe(0);
  });

  it('on a strip reads only frame 0, the frame the UVs map into, clamped or repeated there', () => {
    // A 4 x 4 strip of 2 frames: rows 0-1 frame 0, rows 2-3 frame 1; the hole is in frame 1 (row 2).
    const table = textureOpacityOf(image([[0, 2, 0]]), 4, 4);
    if (typeof table === 'string') throw new Error('expected a table');
    const strip = (wrap: 'clamp' | 'repeat') => ({ wrap, frames: 2 });
    // v 0.5..0.75 is row 2: in frame 1 for a still image, clamped to row 1 or repeated to row 0 on the strip.
    expect(translucentTexelsIn(table, [0, 0.5, 0.25, 0.75], CLAMP)).toBe(1);
    expect(translucentTexelsIn(table, [0, 0.5, 0.25, 0.75], strip('clamp'))).toBe(0);
    expect(translucentTexelsIn(table, [0, 0.5, 0.25, 0.75], strip('repeat'))).toBe(0);
    // A hole in frame 0 (row 1) that a face past the frame reaches by repeat (v 0.75..1 is row 3, i.e. row 1).
    const frame0 = textureOpacityOf(image([[0, 1, 0]]), 4, 4);
    if (typeof frame0 === 'string') throw new Error('expected a table');
    expect(translucentTexelsIn(frame0, [0, 0.75, 0.25, 1], strip('clamp'))).toBe(1);
    expect(translucentTexelsIn(frame0, [0, 0.5, 0.25, 0.75], strip('repeat'))).toBe(0);
    expect(translucentTexelsIn(frame0, [0, 0.75, 0.25, 1], strip('repeat'))).toBe(1);
  });

  it('a hole only a repeated face reaches makes the closed cube not opaque', () => {
    const table = textureOpacityOf(image([[0, 1, 0]]), 4, 4);
    const doc = cubeDoc([1, 0.25, 1.25, 0.5]);
    expect(closedOpaqueMeshes(doc, [table])).toEqual([true]);
    const repeated = { ...doc, textures: doc.textures.map((t) => ({ ...t, wrap: 'repeat' as const })) };
    expect(closedOpaqueMeshes(repeated, [table])).toEqual([false]);
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
