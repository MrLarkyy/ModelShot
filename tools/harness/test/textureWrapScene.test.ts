import { PLACEHOLDER_IMAGE, UNTEXTURED_IMAGE, validateScene } from '@modelshot/renderer-rt';
import { describe, expect, it } from 'vitest';
import { planTextureLayers } from '../../../packages/pathtracer/src/textureLayers';
import { rtScene } from '../fixtures/src/rtScenes';
import { WRAP_CUBES, WRAP_TEXELS, wrapFacePoint } from '../fixtures/src/textureWrapLayout';

describe('texture-wrap fixture scene', () => {
  const doc = rtScene('texture-wrap');

  it('is a valid document whose boxes clamp, clamp and repeat as the loader read them', () => {
    expect(() => validateScene(doc)).not.toThrow();
    const textureOf = (name: string) => {
      const mesh = doc.meshes.find((m) => m.name === name);
      const material = mesh ? doc.materials[mesh.groups[0]?.material ?? -1] : undefined;
      const texture = material ? doc.textures[material.texture] : undefined;
      return [texture?.name, texture?.wrap ?? 'clamp'];
    };
    expect(WRAP_CUBES.map((cube) => textureOf(cube.name))).toEqual([
      ['hytale', 'clamp'],
      ['clamp', 'clamp'],
      ['repeat', 'repeat'],
      ['strip-clamp', 'clamp'],
      ['strip-repeat', 'repeat'],
    ]);
    expect(WRAP_CUBES.map((cube) => cube.wrap)).toEqual(['clamp', 'clamp', 'repeat', 'clamp', 'repeat']);
    // The strips are two-frame strips, so their faces map into frame 0.
    expect(doc.textures.filter((t) => t.frames).map((t) => [t.name, t.frames?.count])).toEqual([
      ['strip-clamp', 2],
      ['strip-repeat', 2],
    ]);
    expect(doc.textures.map((t) => [t.name, t.wrap ?? 'clamp'])).toEqual([
      ['hytale', 'clamp'],
      ['hytale-sentinel', 'clamp'],
      ['clamp', 'clamp'],
      ['clamp-sentinel', 'clamp'],
      ['repeat', 'repeat'],
      ['repeat-sentinel', 'clamp'],
      ['strip-clamp', 'clamp'],
      ['strip-repeat', 'repeat'],
    ]);
  });

  it('maps each south face past its image (still) or frame 0 (strip, rows 0-7), where wrapFacePoint says', () => {
    for (const cube of WRAP_CUBES) {
      const mesh = doc.meshes.find((m) => m.name === cube.name);
      if (!mesh) throw new Error(`no mesh ${cube.name}`);
      const south: [number, number, number, number][] = [];
      for (let k = 0; k < mesh.positions.length / 3; k++) {
        if (mesh.normals[k * 3 + 2] !== 1) continue;
        // Texel units of the whole 16 x 16 image.
        const [u, v] = [(mesh.uvs[k * 2] ?? 0) * WRAP_TEXELS, (mesh.uvs[k * 2 + 1] ?? 0) * WRAP_TEXELS];
        south.push([mesh.positions[k * 3] ?? 0, mesh.positions[k * 3 + 1] ?? 0, u, v]);
        const rect = [...mesh.uvRects.subarray(k * 4, k * 4 + 4)].map((x) => x * WRAP_TEXELS);
        expect(rect, cube.name).toEqual(cube.name.startsWith('strip') ? [0, -3, 16, 11] : [-4, 0, 20, 16]);
      }
      expect(south).toHaveLength(4);
      // A strip's UV space is one frame, 8 rows of the 16-row image: the face's v is in those rows.
      for (const [x, y, u, v] of south) {
        const [px, py] = wrapFacePoint(cube, u, v);
        expect(px).toBeCloseTo(x, 5);
        expect(py).toBeCloseTo(y, 5);
      }
    }
  });

  it('puts a sentinel image right of every wrap texture in the path tracer texture layers', () => {
    const sizes = [UNTEXTURED_IMAGE, PLACEHOLDER_IMAGE, ...doc.textures];
    const { placements } = planTextureLayers(sizes, 4096, 16);
    const at = (name: string) => placements[2 + doc.textures.findIndex((t) => t.name === name)];
    for (const name of ['hytale', 'clamp', 'repeat']) {
      const image = at(name);
      const sentinel = at(`${name}-sentinel`);
      expect(sentinel, name).toEqual({ ...image, x: (image?.x ?? 0) + WRAP_TEXELS });
    }
  });
});
