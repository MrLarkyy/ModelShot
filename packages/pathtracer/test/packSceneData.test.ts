import { ALPHA_MODE_ID, TEXTURE_FLAG_REPEAT, alphaCutoffByte } from '@modelshot/looks';
import { describe, expect, it } from 'vitest';
import { buildBvh, NODE_FLOATS } from '../src/buildBvh';
import { flattenScene } from '../src/flattenScene';
import {
  DATA_TEXTURE_WIDTH,
  checkMaterialCount,
  MATERIAL_TEXELS,
  TRIANGLE_ATTRIBUTE_TEXELS,
  TRIANGLE_POSITION_TEXELS,
  packGeometry,
  packMaterials,
  packTriangleEdges,
  type MaterialTextures,
} from '../src/packSceneData';
import { PathTracerError } from '../src/PathTracerError';
import { NO_EDGE } from '@modelshot/scene';
import { boxMesh, randomTriangles, sceneOf, triangleMesh } from './testScenes';

const place = (layer: number, x: number) => ({ layer, x, y: 2, width: 16, height: 8 });

describe('packGeometry', () => {
  it('stores every triangle in BVH order with its material slot, sides, order, normals, UVs and rectangle', () => {
    const mesh = triangleMesh(randomTriangles(50, 5), {
      renderOrder: 3,
      groups: [{ material: 0, start: 0, count: 150, doubleSided: true }],
    });
    mesh.uvRects.set([0.25, 0.5, 0.75, 1], 2 * 4);
    const flat = flattenScene(sceneOf([mesh]));
    const bvh = buildBvh(flat.positions, flat.count);
    const packed = packGeometry(flat, bvh, 4096);
    expect(packed.triangleCount).toBe(50);
    expect(packed.maxRenderOrder).toBe(3);
    expect(packed.nodes.data.subarray(0, bvh.nodeCount * NODE_FLOATS)).toEqual(bvh.nodes);
    expect(packed.triPositions.data.length).toBe(packed.triPositions.rows * DATA_TEXTURE_WIDTH * 4);
    for (let i = 0; i < 50; i++) {
      const t = bvh.order[i] ?? 0;
      const p = packed.triPositions.data.subarray(
        i * TRIANGLE_POSITION_TEXELS * 4,
        (i + 1) * TRIANGLE_POSITION_TEXELS * 4,
      );
      expect([p[0], p[1], p[2], p[4], p[5], p[6], p[8], p[9], p[10]]).toEqual(
        Array.from(flat.positions.subarray(t * 9, t * 9 + 9)),
      );
      expect([p[3], p[7], p[11]]).toEqual([1, 1, 3]);
      const a = packed.triAttributes.data.subarray(
        i * TRIANGLE_ATTRIBUTE_TEXELS * 4,
        (i + 1) * TRIANGLE_ATTRIBUTE_TEXELS * 4,
      );
      expect([a[0], a[1], a[2]]).toEqual([0, 0, 1]);
      expect([a[3], a[7], a[11], a[12], a[13], a[14]]).toEqual([0, 0, 1, 0, 0, 1]);
      expect(Array.from(a.subarray(16, 20))).toEqual(Array.from(flat.uvRects.subarray(t * 4, t * 4 + 4)));
      // No edge detection: every slot empty.
      expect(Array.from(a.subarray(20, 32))).toEqual(new Array(12).fill(NO_EDGE));
      expect(Array.from(a.subarray(32, 36))).toEqual([0, 0, 0, 0]);
    }
  });

  it('packs corner edge distances in texels 5-7 and angles in texel 8, and rewrites only them', () => {
    const doc = sceneOf([boxMesh([0, 0, 0], [2, 2, 2])]);
    const flat = flattenScene(doc, undefined, { sharpAngleDeg: 30, reach: 4 });
    const bvh = buildBvh(flat.positions, flat.count);
    const packed = packGeometry(flat, bvh, 4096);
    const texels = TRIANGLE_ATTRIBUTE_TEXELS * 4;
    for (let i = 0; i < flat.count; i++) {
      const t = bvh.order[i] ?? 0;
      const a = packed.triAttributes.data.subarray(i * texels, (i + 1) * texels);
      expect(Array.from(a.subarray(20, 32))).toEqual(Array.from(flat.edgeDistances.subarray(t * 12, t * 12 + 12)));
      expect(Array.from(a.subarray(32, 36))).toEqual(Array.from(flat.edgeAngles.subarray(t * 4, t * 4 + 4)));
    }
    const before = Array.from(packed.triAttributes.data.subarray(0, flat.count * texels));
    packTriangleEdges(packed.triAttributes, flattenScene(doc), bvh.order, flat.count);
    const after = packed.triAttributes.data;
    before.forEach((value, i) => {
      const texel = Math.floor(i / 4) % TRIANGLE_ATTRIBUTE_TEXELS;
      expect(after[i]).toBe(texel < 5 ? value : texel < 8 ? NO_EDGE : 0);
    });
  });

  it('throws SCENE_TOO_LARGE when a data texture would need more rows than the GPU allows', () => {
    const flat = flattenScene(sceneOf([triangleMesh(randomTriangles(1400, 2))]));
    const bvh = buildBvh(flat.positions, flat.count);
    // 1400 triangles x 9 attribute texels = 12 600 texels = 7 rows of 2048.
    expect(() => packGeometry(flat, bvh, 6)).toThrow(PathTracerError);
    expect(() => packGeometry(flat, bvh, 6)).toThrow(/triangle attributes need 7 rows/);
    expect(packGeometry(flat, bvh, 7).triAttributes.rows).toBe(7);
  });
});

describe('checkMaterialCount', () => {
  it('admits what the 2048-row material table holds and rejects one more', () => {
    const fits = Math.floor((2048 * DATA_TEXTURE_WIDTH) / MATERIAL_TEXELS) - 1;
    expect(() => checkMaterialCount(fits)).not.toThrow();
    expect(() => checkMaterialCount(fits + 1)).toThrow(PathTracerError);
    expect(() => checkMaterialCount(fits + 1)).toThrow(/materials need 2049 rows/);
  });
});

describe('packMaterials', () => {
  const textures: MaterialTextures = {
    untextured: place(0, 0),
    placeholder: place(0, 16),
    textures: [place(1, 32), null],
  };

  it('writes slot 0 for no material, then each material with its placement, alpha rule and emission', () => {
    const doc = {
      ...sceneOf([]),
      materials: [
        { name: 'a', texture: 0, alphaMode: 'blend' as const, alphaCutoff: 0.01 },
        { name: 'b', texture: 1, alphaMode: 'mask' as const },
        { name: 'c', texture: -1, alphaMode: 'blend' as const },
      ],
    };
    const table = packMaterials(doc, textures, [[1, Number.NaN, -2], undefined, [0, 3, Infinity]]).data;
    const slot = (s: number) => Array.from(table.subarray(s * MATERIAL_TEXELS * 4, (s + 1) * MATERIAL_TEXELS * 4));
    expect(slot(0)).toEqual([0, 0, 2, 16, 8, ALPHA_MODE_ID.opaque, 0, 0, 0, 0, 0, 0]);
    expect(slot(1)).toEqual([1, 32, 2, 16, 8, ALPHA_MODE_ID.blend, alphaCutoffByte(0.01), 0, 1, 0, 0, 0]);
    // A texture without an image draws the placeholder, under its material's rule.
    expect(slot(2)).toEqual([0, 16, 2, 16, 8, ALPHA_MODE_ID.mask, alphaCutoffByte(0.5), 0, 0, 0, 0, 0]);
    // Untextured faces are opaque, as in the preview.
    expect(slot(3)).toEqual([0, 0, 2, 16, 8, ALPHA_MODE_ID.opaque, 0, 0, 0, 3, 0, 0]);
  });

  it('writes the texture sampling flags into texel 1 w: repeat 1, clamp and untextured 0', () => {
    const texture = (wrap?: 'clamp' | 'repeat') => ({
      name: 't',
      mimeType: 'image/png' as const,
      bytes: null,
      width: 16,
      height: 8,
      uvWidth: 16,
      uvHeight: 8,
      missing: false,
      ...(wrap ? { wrap } : {}),
    });
    const doc = {
      ...sceneOf([]),
      textures: [texture('repeat'), texture('clamp'), texture()],
      materials: [
        { name: 'repeat', texture: 0 },
        { name: 'clamp', texture: 1 },
        { name: 'default', texture: 2 },
        { name: 'none', texture: -1 },
      ],
    };
    const placed: MaterialTextures = { ...textures, textures: [place(1, 32), place(1, 48), place(1, 64)] };
    const table = packMaterials(doc, placed).data;
    const flags = (s: number) => table[s * MATERIAL_TEXELS * 4 + 7];
    expect([0, 1, 2, 3, 4].map(flags)).toEqual([0, TEXTURE_FLAG_REPEAT, 0, 0, 0]);
    // A repeat texture drawn as the placeholder keeps its flags, as the preview's batch does.
    expect(flags(1)).toBe(
      packMaterials(doc, { ...placed, textures: [null, null, null] }).data[MATERIAL_TEXELS * 4 + 7],
    );
  });
});
