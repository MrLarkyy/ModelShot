import { LOOK_PRESETS } from '@modelshot/looks';
import { describe, expect, it } from 'vitest';
import { lookSwatch } from '../src/panels/lookSwatch';

describe('lookSwatch', () => {
  it('is deterministic for every preset and ends in its backdrop gradient', () => {
    for (const look of Object.values(LOOK_PRESETS)) {
      const swatch = lookSwatch(look);
      expect(lookSwatch(look)).toBe(swatch);
      expect(swatch).toMatch(/linear-gradient\(180deg, #[0-9A-F]{6}, #[0-9A-F]{6}\)$/);
    }
  });

  it('tints from the key and draws a rim line only for a look whose rim is lit', () => {
    const studio = lookSwatch(LOOK_PRESETS['studio']!);
    expect(studio).toContain('radial-gradient(circle at 68% 30%, #FFFCF9CC');
    expect(studio).not.toContain('90deg');
    const lit = {
      ...LOOK_PRESETS['studio']!,
      lights: {
        ...LOOK_PRESETS['studio']!.lights,
        rim: { ...LOOK_PRESETS['studio']!.lights.rim, color: [1, 0.5, 0] as const },
      },
    };
    expect(lookSwatch(lit)).toContain('linear-gradient(90deg, #FFBC00');
  });

  it('gives different looks different swatches', () => {
    const all = Object.values(LOOK_PRESETS).map(lookSwatch);
    expect(new Set(all).size).toBe(all.length);
  });
});
