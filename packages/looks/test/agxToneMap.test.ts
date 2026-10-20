import { describe, expect, it } from 'vitest';
import agxGlsl from '../src/glsl/agx.glsl?raw';
import { agxToneMap } from '../src/agxToneMap';

const grey = (v: number): [number, number, number] => [v, v, v];

describe('agxToneMap', () => {
  it('maps black and negative input to 0', () => {
    expect(agxToneMap(grey(0))).toEqual([0, 0, 0]);
    expect(agxToneMap([-1, -5, 0])).toEqual([0, 0, 0]);
  });

  it('is monotonic on a grey ramp', () => {
    let previous = -1;
    for (let ev = -14; ev <= 6; ev += 0.25) {
      const [value] = agxToneMap(grey(0.18 * 2 ** ev));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('pins 18% grey', () => {
    const [r, g, b] = agxToneMap(grey(0.18));
    expect(r).toBeCloseTo(0.49668, 4);
    expect(g).toBeCloseTo(r, 3);
    expect(b).toBeCloseTo(r, 3);
  });

  it('keeps very large input below 1', () => {
    for (const value of agxToneMap([1e6, 1e4, 50])) expect(value).toBeLessThan(1);
  });

  it('uses the constants of the GLSL chunk', () => {
    for (const constant of ['0.842479062253094', '1.19687900512017', '-12.47393', '4.026069', '15.5 * x4 * x2']) {
      expect(agxGlsl).toContain(constant);
    }
  });
});
