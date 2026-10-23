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
    ]);
    expect(WRAP_CUBES.map((cube) => cube.wrap)).toEqual(['clamp', 'clamp', 'repeat']);
    expect(doc.textures.map((t) => [t.name, t.wrap ?? 'clamp'])).toEqual([
      ['hytale', 'clamp'],
      ['hytale-sentinel', 'clamp'],
      ['clamp', 'clamp'],
      ['clamp-sentinel', 'clamp'],
      ['repeat', 'repeat'],
      ['repeat-sentinel', 'clamp'],
    ]);
  });

  it('maps u -4 .. 20 across each south face, where wrapFacePoint says', () => {
    for (const cube of WRAP_CUBES) {
      const mesh = doc.meshes.find((m) => m.name === cube.name);
      if (!mesh) throw new Error(`no mesh ${cube.name}`);
      const south: [number, number][] = [];
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        if (mesh.normals[v * 3 + 2] !== 1) continue;
        south.push([mesh.positions[v * 3] ?? 0, (mesh.uvs[v * 2] ?? 0) * WRAP_TEXELS]);
        expect([...mesh.uvRects.subarray(v * 4, v * 4 + 4)].map((x) => x * WRAP_TEXELS)).toEqual([-4, 0, 20, 16]);
      }
      expect(south).toHaveLength(4);
      for (const [x, u] of south) expect(wrapFacePoint(cube, u)[0]).toBeCloseTo(x, 5);
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
