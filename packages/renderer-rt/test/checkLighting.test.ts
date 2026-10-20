import { describe, expect, it } from 'vitest';
import type { BakedLighting } from '../src/BakedLighting';
import { checkLighting } from '../src/checkLighting';
import { lightmapLayout } from '../src/lightmapLayout';
import { quadScene } from './testScene';

const layout = lightmapLayout(quadScene());
const lighting = (change: Partial<BakedLighting> = {}): BakedLighting => ({
  layoutKey: layout.layoutKey,
  width: layout.width,
  height: layout.height,
  data: new Uint16Array(layout.width * layout.height * 4),
  samples: 4,
  catcher: { y: 0, rect: [-1, -1, 1, 1], width: 4, height: 2, data: new Uint16Array(32) },
  ...change,
});

describe('checkLighting', () => {
  it('accepts lighting baked for the layout', () => {
    expect(checkLighting(layout, lighting())).toBe(true);
    expect(checkLighting(layout, lighting({ catcher: null }))).toBe(true);
  });

  it('rejects another layout key, size or data length', () => {
    expect(checkLighting(layout, lighting({ layoutKey: 'other' }))).toBe(false);
    expect(checkLighting(layout, lighting({ height: layout.height + 1 }))).toBe(false);
    expect(checkLighting(layout, lighting({ data: new Uint16Array(4) }))).toBe(false);
  });

  it('rejects a malformed catcher', () => {
    const catcher = lighting().catcher!;
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, width: 0 } }))).toBe(false);
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, width: 513, data: new Uint16Array(513 * 8) } }))).toBe(
      false,
    );
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, data: new Uint16Array(31) } }))).toBe(false);
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, rect: [0, 0, 0, 1] } }))).toBe(false);
    expect(checkLighting(layout, lighting({ catcher: { ...catcher, y: NaN } }))).toBe(false);
  });
});
