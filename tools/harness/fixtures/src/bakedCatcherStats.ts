import type { BakedLighting } from '@modelshot/renderer-rt';

/** IEEE half 1.0. */
const HALF_ONE = 0x3c00;
const HALF_EXPONENT = 0x7c00;

/** Counts over a bake's half-float texels (BakedLighting): its shadow catcher and its model lightmap. */
export interface BakedCatcherStats {
  /** Catcher texels; 0 without a catcher. */
  readonly texels: number;
  /** Catcher texels exactly 1 in all four channels: nothing blocked any of their rays. */
  readonly exactOnes: number;
  /** Catcher texels whose rgb (the fill) is exactly 1. */
  readonly rgbOnes: number;
  /** Catcher texels with key visibility below 1. */
  readonly keyShadowed: number;
  /** Catcher texels with a NaN or infinite channel. */
  readonly nonFinite: number;
  /** Model lightmap texels with key visibility below 1. */
  readonly chartKeyShadowed: number;
  /** Model lightmap texels with a NaN or infinite channel. */
  readonly chartNonFinite: number;
}

const finite = (half: number): boolean => (half & HALF_EXPONENT) !== HALF_EXPONENT;

// Key visibility is 0..1, never negative: below 1 is any half other than 1.0 itself.
const shadowed = (half: number): boolean => half !== HALF_ONE;

export function bakedCatcherStats(lighting: BakedLighting): BakedCatcherStats {
  let exactOnes = 0;
  let rgbOnes = 0;
  let keyShadowed = 0;
  let nonFinite = 0;
  const catcher = lighting.catcher?.data ?? new Uint16Array(0);
  for (let i = 0; i < catcher.length; i += 4) {
    const [r = 0, g = 0, b = 0, a = 0] = catcher.subarray(i, i + 4);
    const rgbOne = r === HALF_ONE && g === HALF_ONE && b === HALF_ONE;
    if (rgbOne) rgbOnes++;
    if (rgbOne && a === HALF_ONE) exactOnes++;
    if (shadowed(a)) keyShadowed++;
    if (![r, g, b, a].every(finite)) nonFinite++;
  }
  let chartKeyShadowed = 0;
  let chartNonFinite = 0;
  for (let i = 0; i < lighting.data.length; i += 4) {
    const texel = Array.from(lighting.data.subarray(i, i + 4));
    if (shadowed(texel[3] ?? 0)) chartKeyShadowed++;
    if (!texel.every(finite)) chartNonFinite++;
  }
  return { texels: catcher.length / 4, exactOnes, rgbOnes, keyShadowed, nonFinite, chartKeyShadowed, chartNonFinite };
}
