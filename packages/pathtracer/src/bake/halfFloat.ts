const scratch = new Float32Array(1);
const bits = new Uint32Array(scratch.buffer);

/**
 * The IEEE 754 half-float bits nearest to `value` (rounded to float32 first, then to nearest, ties to even), as
 * WebGL's HALF_FLOAT uploads take them. Overflow gives ±Infinity, NaN a quiet NaN.
 */
export function toHalf(value: number): number {
  scratch[0] = value;
  const x = bits[0] ?? 0;
  const sign = (x >>> 16) & 0x8000;
  const exponent = (x >>> 23) & 0xff;
  const mantissa = x & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa !== 0 ? 0x200 : 0);
  const e = exponent - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    // Subnormal half (or zero): the implicit 1 joins the mantissa, shifted right by 1 - e more places.
    if (e < -10) return sign;
    const full = mantissa | 0x800000;
    const shift = 14 - e;
    const half = full >>> shift;
    const rest = full & ((1 << shift) - 1);
    const middle = 1 << (shift - 1);
    return sign | (half + (rest > middle || (rest === middle && (half & 1) === 1) ? 1 : 0));
  }
  const half = (e << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  // A carry out of the mantissa rounds up into the exponent, which is the correct next value (or Infinity).
  return sign | (half + (rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1) ? 1 : 0));
}

/** The value of half-float bits `h`. */
export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >>> 10) & 0x1f;
  const mantissa = h & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa !== 0 ? NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
