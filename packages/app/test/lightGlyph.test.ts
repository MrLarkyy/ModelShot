import { describe, expect, it } from 'vitest';
import { LIGHT_INSET_PX, lightGlyph } from '../src/viewport/lightGlyph';

const W = 400;
const H = 300;
const drawn = (g: NonNullable<ReturnType<typeof lightGlyph>>) =>
  [...(g.shaft ?? []), g.ring, g.marker, g.head].filter((p): p is NonNullable<typeof p> => p !== null);

describe('lightGlyph', () => {
  it('leaves a helper inside the view as it is', () => {
    const glyph = lightGlyph({ x: 100, y: 100 }, { x: 200, y: 150 }, W, H);
    expect(glyph?.shaft).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 150 },
    ]);
    expect(glyph?.ring).toEqual({ x: 100, y: 100 });
    expect(glyph?.marker).toBeNull();
  });

  it('keeps everything drawn inside the view, 16 px in, for every direction of the light', () => {
    for (let degrees = 0; degrees < 360; degrees += 5) {
      for (const far of [50, 300, 5000]) {
        const angle = (degrees * Math.PI) / 180;
        const b = { x: W / 2 + Math.cos(angle) * far * 0.6, y: H / 2 + Math.sin(angle) * far * 0.6 };
        const a = { x: W / 2 + Math.cos(angle) * far, y: H / 2 + Math.sin(angle) * far };
        const glyph = lightGlyph(a, b, W, H);
        expect(glyph).not.toBeNull();
        for (const p of drawn(glyph!)) {
          expect(p.x, `${degrees} ${far}`).toBeGreaterThanOrEqual(LIGHT_INSET_PX);
          expect(p.x).toBeLessThanOrEqual(W - LIGHT_INSET_PX);
          expect(p.y).toBeGreaterThanOrEqual(LIGHT_INSET_PX);
          expect(p.y).toBeLessThanOrEqual(H - LIGHT_INSET_PX);
        }
      }
    }
  });

  it('shows a helper wholly outside the view as a marker at the edge', () => {
    const glyph = lightGlyph({ x: 900, y: -400 }, { x: 800, y: -300 }, W, H);
    expect(glyph?.shaft).toBeNull();
    expect(glyph?.marker).not.toBeNull();
    expect(glyph?.marker?.x).toBeLessThanOrEqual(W - LIGHT_INSET_PX);
  });

  it('gives no glyph for points that are not numbers', () => {
    expect(lightGlyph({ x: NaN, y: 0 }, { x: 1, y: 1 }, W, H)).toBeNull();
  });
});
