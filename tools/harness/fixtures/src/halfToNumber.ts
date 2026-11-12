const NEGATIVE = 0x8000;

/** The value of an IEEE half float stored as its 16 bits (BakedLighting data). */
export function halfToNumber(half: number): number {
  const sign = half & NEGATIVE ? -1 : 1;
  const exponent = (half >> 10) & 31;
  const fraction = half & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}
