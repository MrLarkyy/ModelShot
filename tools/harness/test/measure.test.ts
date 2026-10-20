import { describe, expect, it } from 'vitest';
import { median, p90 } from '../src/measure';

describe('measure', () => {
  it('median of odd, even and single sets', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('p90 of odd, even and single sets', () => {
    expect(p90(Array.from({ length: 10 }, (_, i) => i + 1))).toBe(9);
    expect(p90([5, 1, 3])).toBe(5);
    expect(p90([8, 2, 4, 6])).toBe(8);
    expect(p90([7])).toBe(7);
  });

  it('throws on an empty set', () => {
    expect(() => median([])).toThrow(/no measurements/);
    expect(() => p90([])).toThrow(/no measurements/);
  });

  it('does not reorder its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});
