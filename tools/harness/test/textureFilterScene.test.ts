import { PLACEHOLDER_IMAGE, UNTEXTURED_IMAGE, validateScene } from '@modelshot/renderer-rt';
import { textureSampling } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { planTextureLayers } from '../../../packages/pathtracer/src/textureLayers';
import { RT_VARIANTS, rtScene } from '../fixtures/src/rtScenes';
import { FILTER_QUADS, FILTER_TEXELS, filterQuadPoint } from '../fixtures/src/textureFilterLayout';

describe('texture-filter fixture scene', () => {
  const doc = rtScene('texture-filter');
  const textureOf = (name: string) => {
    const mesh = doc.meshes.find((m) => m.name === name);
    const material = mesh ? doc.materials[mesh.groups[0]?.material ?? -1] : undefined;
    return material ? material.texture : -1;
  };

  it('is a valid document whose quads sample as the glTF samplers say', () => {
    expect(() => validateScene(doc)).not.toThrow();
    for (const quad of FILTER_QUADS) {
      const sampling = textureSampling(doc.textures[textureOf(quad.name)]);
      expect([quad.name, sampling.filter, sampling.wrap]).toEqual([quad.name, quad.filter, quad.wrap]);
    }
    // The nearest quad shows the linear quad's image: a scene texture of its own, sharing the bytes.
    const linear = doc.textures[textureOf('linear')];
    const nearest = doc.textures[textureOf('nearest')];
    expect(textureOf('nearest')).not.toBe(textureOf('linear'));
    expect(nearest?.bytes).toBe(linear?.bytes);
    expect(nearest).not.toHaveProperty('filter');
    expect(doc.materials[doc.meshes.find((m) => m.name === 'cutout')!.groups[0]!.material]?.alphaMode).toBe('mask');
  });

  it('maps each quad to its UV range, where filterQuadPoint says', () => {
    for (const quad of FILTER_QUADS) {
      const mesh = doc.meshes.find((m) => m.name === quad.name);
      if (!mesh) throw new Error(`no mesh ${quad.name}`);
      const vertices = (quad.cells + 1) ** 2;
      expect(mesh.positions.length / 3, quad.name).toBe(vertices);
      expect(mesh.indices.length, quad.name).toBe(quad.cells * quad.cells * 6);
      for (let k = 0; k < vertices; k++) {
        const [u, v] = [(mesh.uvs[k * 2] ?? 0) * FILTER_TEXELS, (mesh.uvs[k * 2 + 1] ?? 0) * FILTER_TEXELS];
        const [x, y] = filterQuadPoint(quad, u, v);
        expect(x).toBeCloseTo(mesh.positions[k * 3] ?? NaN, 5);
        expect(y).toBeCloseTo(mesh.positions[k * 3 + 1] ?? NaN, 5);
        const rect = [...mesh.uvRects.subarray(k * 4, k * 4 + 4)].map((t) => t * FILTER_TEXELS);
        if (quad.cells === 1) expect(rect, quad.name).toEqual([...quad.uv]);
        // A subdivided quad's vertex rect is that of the triangles using it, inside the quad's UV range.
        else {
          expect(rect[0]!, quad.name).toBeGreaterThanOrEqual(quad.uv[0]);
          expect(rect[2]!, quad.name).toBeLessThanOrEqual(quad.uv[2]);
          expect(rect[2]! - rect[0]!, quad.name).toBeGreaterThanOrEqual((quad.uv[2] - quad.uv[0]) / quad.cells);
        }
      }
      expect(mesh.normals[2]).toBe(1);
    }
  });

  it('puts a sentinel image right of every linear texture in the path tracer texture layers', () => {
    const sizes = [UNTEXTURED_IMAGE, PLACEHOLDER_IMAGE, ...doc.textures];
    const { placements } = planTextureLayers(sizes, 4096, 16);
    for (const quad of FILTER_QUADS.filter((q) => q.filter === 'linear')) {
      const t = textureOf(quad.name);
      expect(doc.textures[t + 1]?.name, quad.name).toMatch(/^image \d+$/);
      const image = placements[2 + t];
      expect(placements[2 + t + 1], quad.name).toEqual({ ...image, x: (image?.x ?? 0) + FILTER_TEXELS });
    }
  });

  it('has a magnified and a minified (far) view', () => {
    expect(RT_VARIANTS['texture-filter']).toEqual({ scene: 'texture-filter', look: 'filter' });
    expect(RT_VARIANTS['texture-filter-far']).toEqual({ scene: 'texture-filter', look: 'filter-far' });
  });
});
