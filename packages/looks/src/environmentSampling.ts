import { cdfSearch } from './cdfSearch';
import type { EnvironmentLighting } from './environmentLighting';
import { equirectDirection, equirectUv } from './equirect';
import type { Direction } from './LookPreset';

const rowCdf = (lighting: EnvironmentLighting, row: number): number => (row < 0 ? 0 : (lighting.marginal[row] ?? 1));
const columnCdf = (lighting: EnvironmentLighting, x: number, row: number): number =>
  x < 0 ? 0 : (lighting.table[(row * lighting.width + x) * 4 + 3] ?? 1);

/** Solid-angle density of a pixel's (u, v) density at polar sine `sinTheta`: du dv = dω / (2π² sin θ). */
const toSolidAngle = (uvDensity: number, sinTheta: number): number =>
  sinTheta > 0 ? uvDensity / (2 * Math.PI * Math.PI * sinTheta) : 0;

/**
 * A direction of the image's frame drawn by luminance × solid angle from two uniform numbers in [0, 1), and its
 * density per steradian: the TS mirror of `sampleEnvironment` of the path tracer's environmentMap chunk.
 */
export function sampleEnvironment(
  lighting: EnvironmentLighting,
  u1: number,
  u2: number,
): { readonly direction: Direction; readonly pdf: number } {
  const { width, height } = lighting;
  const row = cdfSearch(height, u1, (i) => rowCdf(lighting, i));
  const r0 = rowCdf(lighting, row - 1);
  const r1 = rowCdf(lighting, row);
  const x = cdfSearch(width, u2, (i) => columnCdf(lighting, i, row));
  const c0 = columnCdf(lighting, x - 1, row);
  const c1 = columnCdf(lighting, x, row);
  const v = (row + Math.min(1, Math.max(0, (u1 - r0) / Math.max(r1 - r0, 1e-30)))) / height;
  const u = (x + Math.min(1, Math.max(0, (u2 - c0) / Math.max(c1 - c0, 1e-30)))) / width;
  const pdf = toSolidAngle((r1 - r0) * (c1 - c0) * width * height, Math.sin(Math.PI * v));
  return { direction: equirectDirection(u, v), pdf };
}

/** The density per steradian with which `sampleEnvironment` draws the image-frame unit direction d. */
export function environmentPdf(lighting: EnvironmentLighting, d: Direction): number {
  const { width, height } = lighting;
  const [u, v] = equirectUv(d);
  const x = Math.min(width - 1, Math.floor(u * width));
  const row = Math.min(height - 1, Math.floor(v * height));
  const p =
    (rowCdf(lighting, row) - rowCdf(lighting, row - 1)) *
    (columnCdf(lighting, x, row) - columnCdf(lighting, x - 1, row));
  return toSolidAngle(p * width * height, Math.sqrt(Math.max(0, 1 - d[1] * d[1])));
}
