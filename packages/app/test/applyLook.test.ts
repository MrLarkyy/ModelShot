import { DEFAULT_LOOK, LOOK_PRESETS, LookPresetError, type LookPreset } from '@modelshot/looks';
import { describe, expect, it } from 'vitest';
import { applyLook } from '../src/session/applyLook';

describe('applyLook', () => {
  it('hands the same checked look object to every target, edges included', () => {
    const seen: LookPreset[] = [];
    const marketplace = LOOK_PRESETS['marketplace'] ?? DEFAULT_LOOK;
    const applied = applyLook(marketplace, [
      { setLook: (look) => seen.push(look) },
      null,
      { setLook: (look) => seen.push(look) },
    ]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toBe(applied);
    expect(applied.id).toBe('marketplace');
    expect(applied.edges).toEqual(marketplace.edges);
  });

  it('refuses an invalid look before any target changes', () => {
    const seen: LookPreset[] = [];
    const broken = { ...DEFAULT_LOOK, edges: { width: -1, sharpAngleDeg: 30 } } as LookPreset;
    expect(() => applyLook(broken, [{ setLook: (look) => seen.push(look) }])).toThrow(LookPresetError);
    expect(seen).toEqual([]);
  });
});
