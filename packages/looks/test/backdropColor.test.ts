import { describe, expect, it } from 'vitest';
import { backdropColor } from '../src/backdropColor';
import backdropSource from '../src/glsl/backdrop.glsl?raw';
import { DEFAULT_LOOK, LOOK_PRESETS } from '../src/lookPresets';

describe('backdropColor', () => {
  it('runs from bottom at 0 to top at 1, linearly', () => {
    const look = LOOK_PRESETS['marketplace'];
    if (!look) throw new Error('no marketplace preset');
    expect(backdropColor(look, 0)).toEqual(look.backdrop.bottom);
    expect(backdropColor(look, 1)).toEqual(look.backdrop.top);
    const mid = backdropColor(look, 0.5);
    for (const c of [0, 1, 2] as const) {
      expect(mid[c]).toBeCloseTo((look.backdrop.top[c] + look.backdrop.bottom[c]) / 2, 12);
    }
  });

  it('a flat backdrop is exactly its colour everywhere', () => {
    for (const y of [0, 0.37, 1]) expect(backdropColor(DEFAULT_LOOK, y)).toEqual(DEFAULT_LOOK.backdrop.top);
  });

  it('the GLSL chunk computes the same expression in screen y', () => {
    expect(backdropSource).toContain(
      'return u_lookBackdropBottom + (u_lookBackdropTop - u_lookBackdropBottom) * yNorm;',
    );
    expect(backdropSource).toContain('return backdropAt(gl_FragCoord.y / u_lookFrameHeight);');
  });
});
