import type { Rgb } from './agxToneMap';
import { cdfSearch } from './cdfSearch';
import type { EnvironmentLighting } from './environmentLighting';
import { worldDirection } from './equirect';
import type { Direction, LookDomeEnvironment } from './LookPreset';

/**
 * A shadow-catcher fill direction (world, never below the horizon) and the radiance a blocked ray along it takes from
 * the catcher, weighted by cos / (π × density): the TS mirror of `sampleCatcherFill` of the path tracer's catcherFill
 * chunk.
 */
export interface CatcherFillSample {
  readonly direction: Direction;
  readonly lost: Rgb;
}

const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const scaled = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const NOTHING: CatcherFillSample = Object.freeze({ direction: [0, 1, 0] as const, lost: [0, 0, 0] as const });

/** The dome's `environmentRadiance` at direction height y (lightRig.glsl). */
function domeRadiance(environment: Pick<LookDomeEnvironment, 'sky' | 'ground'>, y: number): Rgb {
  const { sky, ground } = environment;
  const t = y * 0.75 + 0.5;
  return [
    ground[0] + (sky[0] - ground[0]) * t,
    ground[1] + (sky[1] - ground[1]) * t,
    ground[2] + (sky[2] - ground[2]) * t,
  ];
}

/**
 * A direction drawn by cos × the dome's luminance from u1, u2 in [0, 1). The luminance is A + B y, so the density in
 * y is (A + B) y² + A y (1 − y): y = ∛t for the first component, the inverse Beta(2, 2) CDF for the second; a blocked
 * ray loses exactly lum(sky) (= Z / π).
 */
export function sampleDomeCatcherFill(
  environment: Pick<LookDomeEnvironment, 'sky' | 'ground'>,
  u1: number,
  u2: number,
): CatcherFillSample {
  const horizon = Math.max(0, luminance(domeRadiance(environment, 0)));
  const zenith = Math.max(0, luminance(domeRadiance(environment, 1)));
  const quadratic = zenith / 3;
  const total = quadratic + horizon / 6;
  if (!(total > 0)) return NOTHING;
  const pick = quadratic / total;
  let y: number;
  if (u1 < pick) {
    const t = u1 / pick;
    y = t > 0 ? Math.cbrt(t) : 0;
  } else {
    const t = clamp01((u1 - pick) / (1 - pick));
    y = 0.5 + Math.sin(Math.asin(Math.min(1, Math.max(-1, 2 * t - 1))) / 3);
  }
  const phi = 2 * Math.PI * u2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const radiance = domeRadiance(environment, y);
  const lum = luminance(radiance);
  return {
    direction: [r * Math.cos(phi), y, r * Math.sin(phi)],
    lost: lum > 0 ? scaled(radiance, (2 * total) / lum) : [0, 0, 0],
  };
}

/**
 * A direction drawn by cos × the image's luminance over the upper hemisphere from u1, u2 in [0, 1), `yaw` the look's
 * (cos, sin): a row by `catcherMarginal`, a pixel by its row's conditional CDF, cos² θ uniform inside the row's band
 * clipped at the horizon. The weight (y0² − y1²) / (width × P) uses the P of the CDF values the search read, so the
 * estimate is unbiased for the stored tables and a blocked ray loses the cos-weighted mean luminance of the image.
 */
export function sampleImageCatcherFill(
  lighting: EnvironmentLighting,
  yaw: readonly [number, number],
  u1: number,
  u2: number,
): CatcherFillSample {
  const { width, height, table, catcherMarginal } = lighting;
  const rowCdf = (row: number): number => (row < 0 ? 0 : (catcherMarginal[row] ?? 1));
  const columnCdf = (x: number, row: number): number => (x < 0 ? 0 : (table[(row * width + x) * 4 + 3] ?? 1));
  const row = cdfSearch(height, u1, rowCdf);
  const r0 = rowCdf(row - 1);
  const r1 = rowCdf(row);
  const x = cdfSearch(width, u2, (i) => columnCdf(i, row));
  const c0 = columnCdf(x - 1, row);
  const c1 = columnCdf(x, row);
  const y0 = Math.cos((Math.PI * row) / height);
  const band = lighting.catcherBands[row] ?? 0;
  const t = clamp01((u1 - r0) / Math.max(r1 - r0, 1e-30));
  const y = Math.sqrt(Math.max(0, y0 * y0 - band * t));
  const sinTheta = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = 2 * Math.PI * ((x + clamp01((u2 - c0) / Math.max(c1 - c0, 1e-30))) / width) - Math.PI;
  const direction = worldDirection([sinTheta * Math.sin(phi), y, -sinTheta * Math.cos(phi)], yaw);
  const at = (row * width + x) * 4;
  const radiance: Rgb = [table[at] ?? 0, table[at + 1] ?? 0, table[at + 2] ?? 0];
  const p = (r1 - r0) * (c1 - c0);
  return {
    direction,
    lost: luminance(radiance) > 0 && p > 0 && band > 0 ? scaled(radiance, band / (width * p)) : [0, 0, 0],
  };
}
