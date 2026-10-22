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

describe('agxToneMap with a look', () => {
  const neutral = {
    exposure: 0,
    grade: { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], saturation: 1 },
  } as const;
  const samples: [number, number, number][] = [
    [0, 0, 0],
    [0.18, 0.18, 0.18],
    [0.9, 0.3, 0.05],
    [12, 3, 0.4],
  ];

  it('a neutral look gives exactly the plain transform', () => {
    for (const s of samples) expect(agxToneMap(s, neutral)).toEqual(agxToneMap(s));
  });

  it('exposure +1 equals twice the input', () => {
    for (const s of samples) {
      expect(agxToneMap(s, { ...neutral, exposure: 1 })).toEqual(agxToneMap([s[0] * 2, s[1] * 2, s[2] * 2]));
    }
  });

  // Grey up to the outset matrix, whose rows sum to 1 within 2e-4.
  it('saturation 0 gives grey', () => {
    const [r, g, b] = agxToneMap([0.9, 0.3, 0.05], { ...neutral, grade: { ...neutral.grade, saturation: 0 } });
    expect(g).toBeCloseTo(r, 3);
    expect(b).toBeCloseTo(r, 3);
  });

  it('a power above 1 darkens the mid tones', () => {
    const [plain] = agxToneMap(grey(0.18));
    const [graded] = agxToneMap(grey(0.18), { ...neutral, grade: { ...neutral.grade, power: [1.2, 1.2, 1.2] } });
    expect(graded).toBeLessThan(plain);
  });

  it('the GLSL chunk grades after the contrast curve, skipping a neutral grade', () => {
    expect(agxGlsl).toContain('vec3 v = AGX_INSET * max(linearColor * u_lookExposureScale, vec3(0.0));');
    expect(agxGlsl).toContain('if (u_lookGraded) v = agxGrade(v);');
    expect(agxGlsl).toContain('v = pow(max(v * u_lookSlope + u_lookOffset, vec3(0.0)), u_lookPower);');
    expect(agxGlsl).toContain('return luma + u_lookSaturation * (v - luma);');
  });
});
