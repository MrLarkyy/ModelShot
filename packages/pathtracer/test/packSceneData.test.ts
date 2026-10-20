import { ALPHA_MODE_ID, alphaCutoffByte } from '@modelshot/looks';
import { describe, expect, it } from 'vitest';
import { buildBvh, NODE_FLOATS } from '../src/buildBvh';
import { flattenScene } from '../src/flattenScene';
import {
  DATA_TEXTURE_WIDTH,
  MATERIAL_TEXELS,
  TRIANGLE_ATTRIBUTE_TEXELS,
  TRIANGLE_POSITION_TEXELS,
  packGeometry,
  packMaterials,
  type MaterialTextures,
} from '../src/packSceneData';
import { PathTracerError } from '../src/PathTracerError';
import { randomTriangles, sceneOf, triangleMesh } from './testScenes';

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
    }
  });

  it('throws SCENE_TOO_LARGE when a data texture would need more rows than the GPU allows', () => {
    const flat = flattenScene(sceneOf([triangleMesh(randomTriangles(1400, 2))]));
    const bvh = buildBvh(flat.positions, flat.count);
    // 1400 triangles x 5 attribute texels = 7000 texels = 4 rows of 2048.
    expect(() => packGeometry(flat, bvh, 3)).toThrow(PathTracerError);
    expect(() => packGeometry(flat, bvh, 3)).toThrow(/triangle attributes need 4 rows/);
    expect(packGeometry(flat, bvh, 4).triAttributes.rows).toBe(4);
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
});
