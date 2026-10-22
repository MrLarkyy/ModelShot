import { lightmapLayout } from '@modelshot/renderer-rt';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RT_VIEW, RT_VARIANTS, rtScene } from '../fixtures/src/rtScenes';

/**
 * Which meshes of every baked fixture variant get world-density charts (MS-41), so a baked golden cannot change by a
 * chart mode unnoticed. A variant without one lays out exactly as before world charts: its key was recorded on
 * origin/main 086af35.
 */
const CENSUS: Readonly<Record<string, { world: readonly string[]; key?: string }>> = {
  'bake-cutout-checker': { world: [], key: 'd713fc70842b7e60' },
  'bake-cutout-checker-fallback': { world: [], key: 'd713fc70842b7e60' },
  'bake-alpha-plane': { world: ['ground'] },
  'bake-turntable-y030': { world: [], key: 'e225d06c95593c4a' },
  'preset-marketplace': { world: [], key: 'a85876914bc0f880' },
  'preset-rim': { world: [], key: 'a85876914bc0f880' },
  'preset-marketplace-yaw30': { world: [], key: 'a85876914bc0f880' },
  'preset-marketplace-fallback': { world: [], key: 'a85876914bc0f880' },
  'bake-gltf-contact': { world: ['ground', 'box'] },
};

describe('lightmap chart census of the baked fixture variants', () => {
  const baked = Object.entries(RT_VARIANTS).filter(([, variant]) => (variant.bake ?? DEFAULT_RT_VIEW.bake) > 0);

  it('lists every baked variant', () => {
    expect(baked.map(([name]) => name).sort()).toEqual(Object.keys(CENSUS).sort());
  });

  for (const [name, variant] of baked) {
    it(`${name}: world charts on exactly the listed meshes`, () => {
      const doc = rtScene(variant.scene ?? DEFAULT_RT_VIEW.scene);
      const layout = lightmapLayout(doc);
      const world = new Set(layout.charts.filter((c) => c.mode === 'world').map((c) => doc.meshes[c.mesh]?.name));
      expect([...world]).toEqual(CENSUS[name]?.world);
      const key = CENSUS[name]?.key;
      if (key) expect(layout.layoutKey).toBe(key);
    });
  }
});
