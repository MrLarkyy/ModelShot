import { lightmapLayout } from '@modelshot/renderer-rt';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RT_VIEW, RT_VARIANTS, rtScene } from '../fixtures/src/rtScenes';
import { PT_PAIR_TOLERANCE } from '../src/ptPairTolerance';

/**
 * Which meshes of every baked fixture view get world-density charts (MS-41), so a baked golden or a preview-vs-render
 * pair cannot change by a chart mode unnoticed: the variants that bake themselves and the views the pair tests bake
 * (`bake=64`, src/ptPairTolerance.ts). A view without one lays out exactly as before world charts: its
 * key was recorded on origin/main 086af35.
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
  // Pair views.
  'turntable-y030': { world: [], key: 'e225d06c95593c4a' },
  iso: { world: [], key: 'e225d06c95593c4a' },
  'alpha-plane': { world: ['ground'] },
  'player-hold-34': { world: [], key: 'a85876914bc0f880' },
  'cutout-checker': { world: [], key: 'd713fc70842b7e60' },
  // Its untextured wedge, plane and smooth sphere: per vertex before.
  edges: { world: ['wedge', 'plane', 'sphere'] },
  'outline-hull': { world: [], key: '4b2c48876d06f4e3' },
  'gltf-contact': { world: ['ground', 'box'] },
  // MS-39: the ground and the roof (no normals) are world-charted, the rest per texel.
  'gltf-nodes-y030': { world: ['ground', 'roof'] },
  // MS-39: the star and the floor are world-charted, the box and wedge per texel.
  'obj-shapes-y030': { world: ['floor', 'star'] },
  // MS-52: the wrap boxes, baked by textureWrap.spec.ts's pair test; every face per texel.
  'texture-wrap': { world: [], key: '8aeb28781ff695aa' },
  // MS-60: the textured partial-edge quad, per texel; new, so no key from before world charts.
  'partial-edge': { world: [] },
  // MS-38: the filter quads, baked by textureFilter.spec.ts's pair test; every quad per texel but the subdivided linear one (world chart: shared vertices).
  'texture-filter': { world: ['linear'], key: 'fc199f9d3046e479' },
};

describe('lightmap chart census of the baked fixture views', () => {
  it('lists every variant that bakes', () => {
    const baked = Object.entries(RT_VARIANTS).filter(([, variant]) => (variant.bake ?? DEFAULT_RT_VIEW.bake) > 0);
    for (const [name] of baked) expect(Object.keys(CENSUS), name).toContain(name);
  });

  it('has an entry for every preview-vs-render pair view', () => {
    for (const name of Object.keys(PT_PAIR_TOLERANCE)) expect(Object.keys(CENSUS), name).toContain(name);
  });

  for (const [name, expected] of Object.entries(CENSUS)) {
    it(`${name}: world charts on exactly the listed meshes`, () => {
      const variant = RT_VARIANTS[name];
      expect(variant, name).toBeDefined();
      const doc = rtScene(variant?.scene ?? DEFAULT_RT_VIEW.scene);
      const layout = lightmapLayout(doc);
      const world = new Set(layout.charts.filter((c) => c.mode === 'world').map((c) => doc.meshes[c.mesh]?.name));
      expect([...world]).toEqual(expected.world);
      if (expected.key) expect(layout.layoutKey).toBe(expected.key);
    });
  }
});
