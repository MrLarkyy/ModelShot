import { describe, expect, it } from 'vitest';
import { checkBackground } from '../src/checkBackground';
import { MAX_LOOK_COLOR, checkLookPreset } from '../src/checkLookPreset';
import { DEFAULT_LOOK } from '../src/lookPresets';

describe('checkBackground', () => {
  it('returns a frozen copy of three finite channels in 0..16', () => {
    const input = [0, 1.5, 16];
    const out = checkBackground(input);
    expect(out).toEqual([0, 1.5, 16]);
    expect(Object.isFrozen(out)).toBe(true);
    expect(out).not.toBe(input);
  });

  it.each([[[NaN, 0, 0]], [[0, Infinity, 0]], [[-0.001, 0, 0]], [[0, 16.001, 0]], [[0, 0]], [[0, 0, 0, 0]]])(
    'throws a RangeError naming background for %j',
    (value) => {
      expect(() => checkBackground(value)).toThrow(RangeError);
      expect(() => checkBackground(value)).toThrow(/^background must be/);
    },
  );

  it('accepts exactly the channels a look backdrop colour accepts', () => {
    const top = checkBackground([MAX_LOOK_COLOR, 0, 0]);
    expect(() => checkLookPreset({ ...DEFAULT_LOOK, backdrop: { top, bottom: top } })).not.toThrow();
    const over = [MAX_LOOK_COLOR + 0.001, 0, 0] as const;
    expect(() => checkBackground(over)).toThrow(RangeError);
    expect(() => checkLookPreset({ ...DEFAULT_LOOK, backdrop: { top: over, bottom: over } })).toThrow();
  });
});
