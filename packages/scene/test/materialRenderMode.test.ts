import { describe, expect, it } from 'vitest';
import { MAX_MATERIAL_LAYERS, resolveMaterialRenderMode, type SceneMaterial } from '../src/index';

const material = (extra: Partial<SceneMaterial> = {}): SceneMaterial => ({ name: 'm', texture: 2, ...extra });

describe('resolveMaterialRenderMode', () => {
  it('defaults to normal blending, no alpha emission and the material texture as the only layer', () => {
    expect(resolveMaterialRenderMode(material())).toEqual({ blending: 'normal', alphaEmission: false, layers: [2] });
    expect(resolveMaterialRenderMode(material({ texture: -1 })).layers).toEqual([-1]);
    expect(resolveMaterialRenderMode(undefined)).toEqual({ blending: 'normal', alphaEmission: false, layers: [-1] });
  });

  it('keeps additive blending', () => {
    expect(resolveMaterialRenderMode(material({ blending: 'additive' })).blending).toBe('additive');
    expect(resolveMaterialRenderMode(material({ blending: 'normal' })).blending).toBe('normal');
  });

  it('keeps alpha emission only when it is true', () => {
    expect(resolveMaterialRenderMode(material({ alphaEmission: true })).alphaEmission).toBe(true);
    expect(resolveMaterialRenderMode(material({ alphaEmission: false })).alphaEmission).toBe(false);
    const odd = { ...material(), alphaEmission: 'yes' } as unknown as SceneMaterial;
    expect(resolveMaterialRenderMode(odd).alphaEmission).toBe(false);
  });

  it('keeps a layer stack bottom to top', () => {
    expect(resolveMaterialRenderMode(material({ layers: [0, 3, 1] })).layers).toEqual([0, 3, 1]);
  });

  it('treats an unknown blending from an untyped caller as normal', () => {
    const odd = { ...material(), blending: 'multiply' } as unknown as SceneMaterial;
    expect(resolveMaterialRenderMode(odd).blending).toBe('normal');
  });

  it('replaces non-array or empty layers with the material texture', () => {
    for (const layers of ['0,1', 3, null, {}, []]) {
      const odd = { ...material(), layers } as unknown as SceneMaterial;
      expect(resolveMaterialRenderMode(odd).layers).toEqual([2]);
    }
  });

  it('keeps the first MAX_MATERIAL_LAYERS layers and turns a non-integer entry into no texture', () => {
    expect(MAX_MATERIAL_LAYERS).toBe(3);
    expect(resolveMaterialRenderMode(material({ layers: [4, 5, 6, 7, 8] })).layers).toEqual([4, 5, 6]);
    const odd = { ...material(), layers: [1, 'x', 1.5] } as unknown as SceneMaterial;
    expect(resolveMaterialRenderMode(odd).layers).toEqual([1, -1, -1]);
  });
});
