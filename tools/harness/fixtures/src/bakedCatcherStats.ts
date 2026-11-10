import type { BakedLighting, LightmapLayout } from '@modelshot/renderer-rt';
import { halfToNumber } from './halfToNumber';

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
  /** Lightmap texels inside a chart of the layout (texels of no chart hold 1 and are left out). */
  readonly chartTexels: number;
  /** Chart texels whose rgb is exactly 1: no fill ray was lost. */
  readonly chartRgbOnes: number;
  /** Mean of the finite rgb channels over the chart texels. */
  readonly chartMean: number;
  /** Model lightmap texels with a negative non-zero rgb channel (the control variate is unclamped). */
  readonly chartNegative: number;
  /** The least rgb channel of any finite model lightmap texel. */
  readonly chartMin: number;
  /** FNV-1a over the key visibility (a) halves of the model lightmap, to pin that the key's bytes did not move. */
  readonly chartKeyHash: number;
  /** FNV-1a over every half of the catcher lightmap, to pin that its bytes did not move. */
  readonly catcherHash: number;
}

const NEGATIVE = 0x8000;

const finite = (half: number): boolean => (half & HALF_EXPONENT) !== HALF_EXPONENT;

// Key visibility is 0..1, never negative: below 1 is any half other than 1.0 itself.
const shadowed = (half: number): boolean => half !== HALF_ONE;

/** Per lightmap texel whether a chart of the layout covers it (a double-sided chart's back side follows its front). */
function chartMask(lighting: BakedLighting, layout: LightmapLayout): Uint8Array {
  const mask = new Uint8Array(lighting.width * lighting.height);
  for (const chart of layout.charts) {
    const width = chart.back ? chart.width * 2 : chart.width;
    for (let y = chart.y; y < chart.y + chart.height; y++)
      mask.fill(1, y * lighting.width + chart.x, y * lighting.width + chart.x + width);
  }
  return mask;
}

export function bakedCatcherStats(lighting: BakedLighting, layout: LightmapLayout): BakedCatcherStats {
  let exactOnes = 0;
  let rgbOnes = 0;
  let keyShadowed = 0;
  let nonFinite = 0;
  const catcher = lighting.catcher?.data ?? new Uint16Array(0);
  let catcherHash = 0x811c9dc5;
  for (const half of catcher) {
    catcherHash = Math.imul(catcherHash ^ (half & 255), 0x01000193) >>> 0;
    catcherHash = Math.imul(catcherHash ^ (half >> 8), 0x01000193) >>> 0;
  }
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
  let chartRgbOnes = 0;
  let chartTexels = 0;
  let meanSum = 0;
  let meanCount = 0;
  const inChart = chartMask(lighting, layout);
  let chartNegative = 0;
  let chartMin = Infinity;
  let chartKeyHash = 0x811c9dc5;
  for (let i = 0; i < lighting.data.length; i += 4) {
    const texel = Array.from(lighting.data.subarray(i, i + 4));
    if (shadowed(texel[3] ?? 0)) chartKeyShadowed++;
    if (!texel.every(finite)) chartNonFinite++;
    const rgb = texel.slice(0, 3);
    if (inChart[i / 4]) {
      chartTexels++;
      if (rgb.every((h) => h === HALF_ONE)) chartRgbOnes++;
      for (const h of rgb) {
        if (finite(h)) {
          meanSum += halfToNumber(h);
          meanCount++;
        }
      }
    }
    if (rgb.every(finite)) {
      if (rgb.some((h) => h & NEGATIVE && (h & 0x7fff) !== 0)) chartNegative++;
      for (const h of rgb) chartMin = Math.min(chartMin, halfToNumber(h));
    }
    const key = texel[3] ?? 0;
    chartKeyHash = Math.imul(chartKeyHash ^ (key & 255), 0x01000193) >>> 0;
    chartKeyHash = Math.imul(chartKeyHash ^ (key >> 8), 0x01000193) >>> 0;
  }
  return {
    texels: catcher.length / 4,
    exactOnes,
    rgbOnes,
    keyShadowed,
    nonFinite,
    chartKeyShadowed,
    chartNonFinite,
    chartTexels,
    chartMean: meanCount ? meanSum / meanCount : 0,
    chartRgbOnes,
    chartNegative,
    chartMin: Number.isFinite(chartMin) ? chartMin : 0,
    chartKeyHash,
    catcherHash,
  };
}
