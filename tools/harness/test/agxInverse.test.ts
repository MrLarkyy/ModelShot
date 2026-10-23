import { describe, expect, it } from 'vitest';
import { agxToneMap } from '../../../packages/looks/src/agxToneMap';
import { agxInverse } from '../src/agxInverse';

describe('agxInverse', () => {
  it('returns the linear colour the tone map took', () => {
    for (const linear of [
      [0.18, 0.18, 0.18],
      [0.05, 0.1, 0.4],
      [0.9, 0.5, 0.02],
      [2, 2, 2],
    ] as const) {
      const back = agxInverse(agxToneMap(linear));
      for (let c = 0; c < 3; c++) expect(back[c], `${linear.join(', ')} channel ${c}`).toBeCloseTo(linear[c] ?? 0, 6);
    }
  });

  it('honours exposure and a grade', () => {
    const toneMapping = {
      exposure: 0.5,
      grade: { slope: [1, 1, 1], offset: [0, 0, 0], power: [1.25, 1.25, 1.25], saturation: 1.1 },
    } as const;
    const linear = [0.3, 0.2, 0.1] as const;
    const back = agxInverse(agxToneMap(linear, toneMapping), toneMapping);
    for (let c = 0; c < 3; c++) expect(back[c]).toBeCloseTo(linear[c] ?? 0, 6);
  });
});
