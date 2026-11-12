import { LOOK_PRESETS, lightingKey } from '@modelshot/looks';
import { describe, expect, it } from 'vitest';
import { NO_LOOK_ADJUST, adjustLook, isNeutral, sameAdjust } from '../src/session/adjustLook';

const studio = LOOK_PRESETS['studio']!;

describe('adjustLook', () => {
  it('returns the preset itself when nothing is adjusted', () => {
    expect(adjustLook(studio, NO_LOOK_ADJUST)).toBe(studio);
    expect(isNeutral(NO_LOOK_ADJUST)).toBe(true);
  });

  it('adds exposure and scales saturation on a copy with the same id, clamped to the look ranges', () => {
    const lit = adjustLook(studio, { exposure: 1.5, saturation: 0.5, backdrop: null });
    expect(lit).not.toBe(studio);
    expect(lit.id).toBe(studio.id);
    expect(lit.toneMapping.exposure).toBeCloseTo(studio.toneMapping.exposure + 1.5);
    expect(lit.toneMapping.grade.saturation).toBeCloseTo(studio.toneMapping.grade.saturation * 0.5);
    expect(adjustLook(studio, { exposure: 6, saturation: 2, backdrop: null }).toneMapping.exposure).toBe(6);
    expect(adjustLook(studio, { exposure: 99, saturation: 99, backdrop: null }).toneMapping.grade.saturation).toBe(2);
    expect(studio.toneMapping.exposure).toBe(0);
  });

  it('sets a flat backdrop from an sRGB colour and keeps the look backdrop for null', () => {
    const flat = adjustLook(studio, { exposure: 0, saturation: 1, backdrop: '#ffffff' });
    expect(flat.backdrop.top).toEqual([1, 1, 1]);
    expect(flat.backdrop.bottom).toEqual(flat.backdrop.top);
    const black = adjustLook(studio, { exposure: 0, saturation: 1, backdrop: '#000000' });
    expect(black.backdrop.top).toEqual([0, 0, 0]);
    expect(adjustLook(studio, { exposure: 1, saturation: 1, backdrop: null }).backdrop).toEqual(studio.backdrop);
  });

  it('never changes what baked light depends on, so an adjustment needs no bake', () => {
    for (const look of Object.values(LOOK_PRESETS)) {
      const adjusted = adjustLook(look, { exposure: -2, saturation: 0.3, backdrop: '#336699' });
      expect(lightingKey(adjusted)).toBe(lightingKey(look));
    }
  });

  it('compares adjustments by value', () => {
    expect(sameAdjust(NO_LOOK_ADJUST, { exposure: 0, saturation: 1, backdrop: null })).toBe(true);
    expect(sameAdjust(NO_LOOK_ADJUST, { exposure: 0.1, saturation: 1, backdrop: null })).toBe(false);
  });
});
