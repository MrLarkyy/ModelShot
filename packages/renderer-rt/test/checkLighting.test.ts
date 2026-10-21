import { describe, expect, it } from 'vitest';
import type { BakedLighting } from '../src/BakedLighting';
import { DEFAULT_LOOK, LOOK_PRESETS, lightingKey } from '@modelshot/looks';
import { checkLighting } from '../src/checkLighting';
import { lightmapLayout } from '../src/lightmapLayout';
import { quadScene } from './testScene';

const layout = lightmapLayout(quadScene());
const KEY = lightingKey(DEFAULT_LOOK);
const lighting = (change: Partial<BakedLighting> = {}): BakedLighting => ({
  layoutKey: layout.layoutKey,
  lightingKey: KEY,
  width: layout.width,
  height: layout.height,
  data: new Uint16Array(layout.width * layout.height * 4),
  samples: 4,
  catcher: { y: 0, rect: [-1, -1, 1, 1], width: 4, height: 2, data: new Uint16Array(32) },
  ...change,
});

describe('checkLighting', () => {
  it('accepts lighting baked for the layout', () => {
    expect(checkLighting(layout, lighting(), KEY)).toBe(true);
    expect(checkLighting(layout, lighting({ catcher: null }), KEY)).toBe(true);
  });

  it('rejects light baked under a look of another lighting key', () => {
    const marketplace = LOOK_PRESETS['marketplace'];
    if (!marketplace) throw new Error('no marketplace preset');
    expect(checkLighting(layout, lighting(), lightingKey(marketplace))).toBe(false);
    expect(checkLighting(layout, lighting({ lightingKey: lightingKey(marketplace) }), lightingKey(marketplace))).toBe(
      true,
    );
  });

  it('rejects another layout key, size or data length', () => {
    expect(checkLighting(layout, lighting({ layoutKey: 'other' }), KEY)).toBe(false);
    expect(checkLighting(layout, lighting({ height: layout.height + 1 }), KEY)).toBe(false);
    expect(checkLighting(layout, lighting({ data: new Uint16Array(4) }), KEY)).toBe(false);
  });

  it('rejects a malformed catcher', () => {
    const catcher = lighting().catcher!;
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, width: 0 } }), KEY)).toBe(false);
    expect(
      checkLighting(layout, lighting({ catcher: { ...catcher, width: 513, data: new Uint16Array(513 * 8) } }), KEY),
    ).toBe(false);
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, data: new Uint16Array(31) } }), KEY)).toBe(false);
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, rect: [0, 0, 0, 1] } }), KEY)).toBe(false);
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, y: NaN } }), KEY)).toBe(false);
  });
});
