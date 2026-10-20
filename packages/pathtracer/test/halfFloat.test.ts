import { describe, expect, it } from 'vitest';
import { fromHalf, toHalf } from '../src/bake/halfFloat';

describe('half floats', () => {
  it('encodes exact values', () => {
    expect(toHalf(0)).toBe(0);
    expect(toHalf(-0)).toBe(0x8000);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(65504)).toBe(0x7bff);
  });

  it('encodes subnormals and underflows to zero', () => {
    expect(toHalf(2 ** -24)).toBe(1);
    expect(toHalf(3 * 2 ** -24)).toBe(3);
    expect(toHalf(2 ** -14)).toBe(0x0400);
    expect(toHalf(2 ** -26)).toBe(0);
    expect(fromHalf(toHalf(5 * 2 ** -24))).toBe(5 * 2 ** -24);
  });

  it('rounds to nearest with ties to even', () => {
    const step = 2 ** -10;
    // 1 + step / 2 is a tie between 1 (even) and 1 + step: to 1.
    expect(toHalf(1 + step / 2)).toBe(0x3c00);
    // 1 + 3 step / 2 ties between 1 + step (odd) and 1 + 2 step: to the even one.
    expect(toHalf(1 + (3 * step) / 2)).toBe(0x3c02);
    expect(toHalf(1 + step * 0.51)).toBe(0x3c01);
    // A subnormal tie: 2.5 ulp goes to 2.
    expect(toHalf(2.5 * 2 ** -24)).toBe(2);
    expect(toHalf(3.5 * 2 ** -24)).toBe(4);
  });

  it('overflows to infinity and keeps NaN', () => {
    expect(toHalf(65520)).toBe(0x7c00);
    expect(toHalf(-1e9)).toBe(0xfc00);
    expect(Number.isNaN(fromHalf(toHalf(NaN)))).toBe(true);
  });

  it('round-trips every half value', () => {
    for (let h = 0; h < 0x7c00; h++) expect(toHalf(fromHalf(h))).toBe(h);
  });
});
