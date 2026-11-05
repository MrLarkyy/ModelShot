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
  /** Per row the marginal CDF through it (1 at the last row), `u_envMarginal`. */
  readonly marginal: Float32Array;
}

const LUMINANCE = [0.2126, 0.7152, 0.0722] as const;
/** Prepared lightings kept, most recent last: a look switch back and forth decodes nothing again. */
const MAX_PREPARED = 8;

const prepared = new Map<string, EnvironmentLighting>();

/**
 * Sampling tables proportional to luminance × sin θ (the pixel's solid angle): per row the CDF over its pixels, and
 * over rows the CDF of their sums. A row or image of zero luminance gets a uniform CDF, so every table is valid.
 */
function cdfTables(image: RadianceImage): { conditional: Float32Array; marginal: Float32Array } {
  const { width, height, rgb } = image;
  const conditional = new Float32Array(width * height);
  const rowSums = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const sinTheta = Math.sin((Math.PI * (y + 0.5)) / height);
    let sum = 0;
    const weights = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const lum = LUMINANCE[0] * (rgb[i] ?? 0) + LUMINANCE[1] * (rgb[i + 1] ?? 0) + LUMINANCE[2] * (rgb[i + 2] ?? 0);
      weights[x] = Math.max(0, lum) * sinTheta;
      sum += weights[x] ?? 0;
    }
    rowSums[y] = sum;
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
  return { conditional, marginal };
}

function prepare(image: RadianceImage, intensity: number): EnvironmentLighting {
  const { width, height, rgb } = image;
  const { conditional, marginal } = cdfTables(image);
  const table = new Float32Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    table[p * 4] = (rgb[p * 3] ?? 0) * intensity;
    table[p * 4 + 1] = (rgb[p * 3 + 1] ?? 0) * intensity;
    table[p * 4 + 2] = (rgb[p * 3 + 2] ?? 0) * intensity;
    table[p * 4 + 3] = conditional[p] ?? 0;
  }
  return Object.freeze({ width, height, table, marginal });
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
    lighting = prepare(environmentImage(environment.image), environment.intensity);
    if (prepared.size >= MAX_PREPARED) {
      const oldest = prepared.keys().next().value;
      if (oldest !== undefined) prepared.delete(oldest);
    }
  }
  prepared.set(key, lighting);
  return lighting;
}
