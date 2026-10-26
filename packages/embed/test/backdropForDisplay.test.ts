import { LOOK_PRESETS, MAX_LOOK_COLOR, agxToneMap } from '@modelshot/looks';
import { describe, expect, it } from 'vitest';
import { backdropForDisplay } from '../src/frame/backdropForDisplay';
import { hexDisplayColor } from '../src/frame/hexDisplayColor';

const looks = Object.values(LOOK_PRESETS).map((look) => [look.id, look] as const);

describe('hexDisplayColor', () => {
  it.each([
    ['#000000', [0, 0, 0]],
    ['#ffffff', [1, 1, 1]],
    ['#1b2a4a', [27 / 255, 42 / 255, 74 / 255]],
  ])('reads %s', (hex, expected) => {
    expect(hexDisplayColor(hex)).toEqual(expected);
  });
});

describe('backdropForDisplay', () => {
  it.each(looks)('the %s look shows page colours as written, within half a level', (_id, look) => {
    for (const hex of ['#1b2a4a', '#808080', '#f4f4f4', '#000000', '#eef0f4', '#121318']) {
      const target = hexDisplayColor(hex);
      const linear = backdropForDisplay(target, look.toneMapping);
      const shown = agxToneMap(linear, look.toneMapping);
      for (let c = 0; c < 3; c++)
        expect(Math.abs(shown[c]! - target[c]!) * 255, `${hex} channel ${c}`).toBeLessThan(0.5);
    }
  });

  it.each(looks)('the %s look gets a colour its checks accept also for colours AgX cannot show', (_id, look) => {
    for (const hex of ['#ff0000', '#00ff00', '#2f4bff', '#ffffff']) {
      const linear = backdropForDisplay(hexDisplayColor(hex), look.toneMapping);
      for (const channel of linear) {
        expect(Number.isFinite(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(MAX_LOOK_COLOR);
      }
    }
    const white = agxToneMap(backdropForDisplay([1, 1, 1], look.toneMapping), look.toneMapping);
    for (const channel of white) expect(channel * 255).toBeGreaterThan(253);
  });

  it('is deterministic', () => {
    const look = LOOK_PRESETS['marketplace']!;
    expect(backdropForDisplay([0.1, 0.2, 0.3], look.toneMapping)).toEqual(
      backdropForDisplay([0.1, 0.2, 0.3], look.toneMapping),
    );
  });
});
