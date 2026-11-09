import type { RadianceImage } from '@modelshot/formats';
import { environmentImage } from './environmentImage';
import type { LookHdriEnvironment } from './LookPreset';

/**
 * A bundled environment image prepared for the path tracer and the light bake, in the image's own frame (a look's
 * rotation turns lookups, never the data). The preview needs only its harmonics, `environmentSh`, and never loads it.
 */
export interface EnvironmentLighting {
  readonly width: number;
  readonly height: number;
  /**
   * RGBA per pixel, row 0 the zenith: rgb the radiance times the look's intensity, a the conditional CDF of its row
   * through this pixel (1 at the row's last), the path tracer's `u_envRadiance`.
   */
  readonly table: Float32Array;
  /** Per row the marginal CDF through it (1 at the last row), `u_envMarginal` r. */
  readonly marginal: Float32Array;
  /**
   * Per row the shadow catcher's marginal CDF through it, `u_envMarginal` g: rows weighted by their luminance sum ×
   * the integral of cos θ sin θ over the row's band clipped at the horizon (0 for a row at or below it), so a row and
   * then a pixel by its conditional CDF are drawn by cos × luminance over the upper hemisphere (catcherFill chunk of
   * the path tracer). 1 from the last row above the horizon on; uniform over those rows if they are all black.
   */
  readonly catcherMarginal: Float32Array;
}

const LUMINANCE = [0.2126, 0.7152, 0.0722] as const;
/** Prepared lightings kept, most recent last: a look switch back and forth decodes nothing again. */
const MAX_PREPARED = 8;

const prepared = new Map<string, EnvironmentLighting>();

/**
 * Sampling tables proportional to luminance × sin θ (the pixel's solid angle): per row the CDF over its pixels, and
 * over rows the CDF of their sums; and the shadow catcher's CDF over rows (`EnvironmentLighting.catcherMarginal`).
 * A row or image of zero luminance gets a uniform CDF, so every table is valid.
 */
function cdfTables(image: RadianceImage): {
  conditional: Float32Array;
  marginal: Float32Array;
  catcherMarginal: Float32Array;
} {
  const { width, height, rgb } = image;
  const conditional = new Float32Array(width * height);
  const rowSums = new Float64Array(height);
  const catcherRows = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const sinTheta = Math.sin((Math.PI * (y + 0.5)) / height);
    let sum = 0;
    let luminanceSum = 0;
    const weights = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const lum = LUMINANCE[0] * (rgb[i] ?? 0) + LUMINANCE[1] * (rgb[i + 1] ?? 0) + LUMINANCE[2] * (rgb[i + 2] ?? 0);
      weights[x] = Math.max(0, lum) * sinTheta;
      sum += weights[x] ?? 0;
      luminanceSum += Math.max(0, lum);
    }
    rowSums[y] = sum;
    // cos(pi / 2) rounds to 6e-17, not 0: rows from ceil(height / 2) on are set apart by index.
    if (y < Math.ceil(height / 2)) {
      const y0 = Math.cos((Math.PI * y) / height);
      const y1 = Math.max(0, Math.cos((Math.PI * (y + 1)) / height));
      catcherRows[y] = (luminanceSum * (y0 * y0 - y1 * y1)) / 2;
    }
    let running = 0;
    for (let x = 0; x < width; x++) {
      running += weights[x] ?? 0;
      conditional[y * width + x] = x === width - 1 ? 1 : sum > 0 ? running / sum : (x + 1) / width;
    }
  }
  const total = rowSums.reduce((a, b) => a + b, 0);
  const marginal = new Float32Array(height);
  let running = 0;
  for (let y = 0; y < height; y++) {
    running += rowSums[y] ?? 0;
    marginal[y] = y === height - 1 ? 1 : total > 0 ? running / total : (y + 1) / height;
  }
  return { conditional, marginal, catcherMarginal: catcherCdf(catcherRows) };
}

/** The catcher's row CDF from its row weights: rows from `ceil(height / 2)` on lie below the horizon. */
function catcherCdf(rows: Float64Array): Float32Array {
  const height = rows.length;
  const upper = Math.ceil(height / 2);
  const total = rows.reduce((a, b) => a + b, 0);
  const cdf = new Float32Array(height);
  let running = 0;
  for (let y = 0; y < height; y++) {
    running += rows[y] ?? 0;
    cdf[y] = y >= upper - 1 ? 1 : total > 0 ? running / total : (y + 1) / upper;
  }
  return cdf;
}

/**
 * The tables of `image` at `intensity`, uncached: `environmentLighting` keeps them for the bundled images, tests build
 * them for synthetic ones.
 */
export function prepareEnvironmentLighting(image: RadianceImage, intensity: number): EnvironmentLighting {
  const { width, height, rgb } = image;
  const { conditional, marginal, catcherMarginal } = cdfTables(image);
  const table = new Float32Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    table[p * 4] = (rgb[p * 3] ?? 0) * intensity;
    table[p * 4 + 1] = (rgb[p * 3 + 1] ?? 0) * intensity;
    table[p * 4 + 2] = (rgb[p * 3 + 2] ?? 0) * intensity;
    table[p * 4 + 3] = conditional[p] ?? 0;
  }
  return Object.freeze({ width, height, table, marginal, catcherMarginal });
}

/**
 * The bundled image of `environment` prepared at its intensity: decoded once per image (`decodeRadianceHdr` under
 * the default limits, synchronously, cheap for a small image), the tables kept for the last few
 * (image, intensity) pairs, so the same pair returns the same object. The rotation is not part of it.
 */
export function environmentLighting(
  environment: Pick<LookHdriEnvironment, 'image' | 'intensity'>,
): EnvironmentLighting {
  const key = `${environment.image}:${environment.intensity}`;
  let lighting = prepared.get(key);
  if (lighting) {
    prepared.delete(key);
  } else {
    lighting = prepareEnvironmentLighting(environmentImage(environment.image), environment.intensity);
    if (prepared.size >= MAX_PREPARED) {
      const oldest = prepared.keys().next().value;
      if (oldest !== undefined) prepared.delete(oldest);
    }
  }
  prepared.set(key, lighting);
  return lighting;
}
