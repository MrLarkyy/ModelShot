import { describe, expect, it } from 'vitest';
import type { Rgb } from '../src/agxToneMap';
import { environmentFill } from '../src/environmentFill';
import { ENVIRONMENT_IMAGE_IDS } from '../src/environmentImageIds';
import { environmentImage } from '../src/environmentImage';
import { environmentLighting, prepareEnvironmentLighting, type EnvironmentLighting } from '../src/environmentLighting';
import { imageIrradianceSh } from '../src/imageIrradianceSh';
import { ENVIRONMENT_SH_IMAGES, environmentSh } from '../src/environmentSh';
import { environmentPdf, sampleEnvironment } from '../src/environmentSampling';
import { environmentYaw, equirectDirection, equirectUv, imageDirection, worldDirection } from '../src/equirect';
import { unoccludedRadiance } from '../src/lightRig';
import type { Direction, LookHdriEnvironment } from '../src/LookPreset';
import { LOOK_PRESETS } from '../src/lookPresets';

const SOFTBOX: LookHdriEnvironment = { kind: 'hdri', image: 'softbox-studio', intensity: 1, rotationDeg: 0 };

/** Deterministic numbers in [0, 1) (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` unit directions spread over the sphere (a Fibonacci lattice). */
function sphere(count: number): Direction[] {
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    return [r * Math.cos(phi), y, r * Math.sin(phi)] as const;
  });
}

const SUBSAMPLES = 8;

/**
 * Irradiance over π of the decoded, piecewise-constant image at the image-frame unit normal n: each pixel's solid angle
 * integrated on SUBSAMPLES × SUBSAMPLES sub-directions in (θ, φ), weighted by sin θ and scaled to the pixel's exact
 * solid angle, so the lobe's variation across a pixel counts.
 */
function exactFill(lighting: EnvironmentLighting, n: Direction): Rgb {
  const { width, height, table } = lighting;
  const out = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    const solidAngle =
      ((2 * Math.PI) / width) * (Math.cos((Math.PI * y) / height) - Math.cos((Math.PI * (y + 1)) / height));
    for (let x = 0; x < width; x++) {
      let cosine = 0;
      let weights = 0;
      for (let j = 0; j < SUBSAMPLES; j++) {
        const v = (y + (j + 0.5) / SUBSAMPLES) / height;
        for (let i = 0; i < SUBSAMPLES; i++) {
          const d = equirectDirection((x + (i + 0.5) / SUBSAMPLES) / width, v);
          const weight = Math.sin(Math.PI * v);
          weights += weight;
          cosine += weight * Math.max(0, d[0] * n[0] + d[1] * n[1] + d[2] * n[2]);
        }
      }
      const at = (y * width + x) * 4;
      const mean = (cosine / weights) * solidAngle;
      for (let c = 0; c < 3; c++) out[c] = (out[c] ?? 0) + ((table[at + c] ?? 0) * mean) / Math.PI;
    }
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

describe('equirect mapping', () => {
  it('maps the image centre to the front (-z), u 0.75 to +x, v 0 to the zenith, and back', () => {
    const front = equirectDirection(0.5, 0.5);
    expect(front[2]).toBeCloseTo(-1, 12);
    expect(equirectDirection(0.75, 0.5)[0]).toBeCloseTo(1, 12);
    expect(equirectDirection(0.3, 0)[1]).toBeCloseTo(1, 12);
    for (const [u, v] of [
      [0.1, 0.2],
      [0.6, 0.9],
      [0.99, 0.5],
    ] as const) {
      const [u2, v2] = equirectUv(equirectDirection(u, v));
      expect(u2).toBeCloseTo(u, 12);
      expect(v2).toBeCloseTo(v, 12);
    }
  });

  it('turns lookups by the yaw, +90 taking +x toward -z, the two turns inverse', () => {
    const yaw = environmentYaw(90);
    const turned = worldDirection([1, 0, 0], yaw);
    expect(turned[0]).toBeCloseTo(0, 12);
    expect(turned[2]).toBeCloseTo(-1, 12);
    const d: Direction = [0.3, 0.4, -0.866];
    const back = imageDirection(worldDirection(d, environmentYaw(37)), environmentYaw(37));
    for (let c = 0; c < 3; c++) expect(back[c]).toBeCloseTo(d[c] ?? 0, 12);
    expect(environmentYaw(0)).toEqual([1, 0]);
  });
});

describe('environmentLighting', () => {
  it('decodes once and keeps the prepared tables per image and intensity', () => {
    const a = environmentLighting(SOFTBOX);
    const turned: LookHdriEnvironment = { ...SOFTBOX, rotationDeg: 90 };
    expect(environmentLighting(turned)).toBe(a);
    const brighter = environmentLighting({ ...SOFTBOX, intensity: 2 });
    expect(brighter).not.toBe(a);
    expect(brighter.table[0]).toBeCloseTo(2 * (a.table[0] ?? 0), 6);
    // The CDF does not depend on the intensity; only the radiance and the harmonics scale.
    expect(brighter.table[3]).toBe(a.table[3]);
    expect(brighter.marginal).toEqual(a.marginal);
    expect([a.width, a.height, a.table.length, a.marginal.length, a.catcherMarginal.length]).toEqual([
      32,
      16,
      32 * 16 * 4,
      16,
      16,
    ]);
  });

  it("the preview's precomputed harmonics are the decoded image's, scaled by the intensity", () => {
    const image = environmentImage('softbox-studio');
    expect([...environmentSh(SOFTBOX)]).toEqual([...imageIrradianceSh(image, 1)]);
    const brighter = environmentSh({ ...SOFTBOX, intensity: 2.5 });
    const exact = imageIrradianceSh(image, 2.5);
    for (let i = 0; i < 27; i++) expect(brighter[i]).toBeCloseTo(exact[i] ?? 0, 6);
    expect([...ENVIRONMENT_SH_IMAGES]).toEqual([...ENVIRONMENT_IMAGE_IDS]);
    expect(() => environmentSh({ image: 'nope', intensity: 1 })).toThrow(RangeError);
  });

  it('the preview fill (L2 irradiance) is within 1 % of the exact one per channel, 256 normals x 8 rotations', () => {
    const lighting = environmentLighting(SOFTBOX);
    let worst = 0;
    let lowest = Infinity;
    for (let r = 0; r < 8; r++) {
      const rotationDeg = -180 + r * 45 + 7;
      const environment = { ...SOFTBOX, rotationDeg };
      for (const n of sphere(256)) {
        const approx = environmentFill(environment, n);
        const exact = exactFill(lighting, imageDirection(n, environmentYaw(rotationDeg)));
        for (let c = 0; c < 3; c++) {
          worst = Math.max(worst, Math.abs((approx[c] ?? 0) - (exact[c] ?? 0)) / (exact[c] ?? 0));
          lowest = Math.min(lowest, approx[c] ?? 0);
        }
      }
    }
    console.log(
      `[softbox-studio] worst relative L2 fill error ${(worst * 100).toFixed(3)} %, lowest fill ${lowest.toFixed(4)}`,
    );
    expect(worst).toBeLessThanOrEqual(0.01);
    expect(lowest).toBeGreaterThan(0);
  });

  it('unoccludedRadiance under Softbox fills with the image irradiance: environmentFill plus the key', () => {
    const look = LOOK_PRESETS['softbox'];
    if (!look || look.environment.kind !== 'hdri') throw new Error('softbox is lit by an image');
    const n: Direction = [0, 0, -1];
    const albedo: Rgb = [0.5, 0.25, 1];
    const shaded = unoccludedRadiance(look, albedo, n, undefined, environmentFill);
    const fill = environmentFill(look.environment, n);
    const k = Math.max(0, -look.lights.key.direction[2]);
    for (let c = 0; c < 3; c++) {
      expect(shaded[c]).toBeCloseTo((albedo[c] ?? 0) * ((fill[c] ?? 0) + (look.lights.key.color[c] ?? 0) * k), 12);
    }
    expect(() => unoccludedRadiance(look, albedo, n)).toThrow(TypeError);
  });
});

describe('the catcher marginal (cos x luminance over the upper hemisphere, per row)', () => {
  const synthetic = (width: number, height: number, at: (x: number, y: number) => number): EnvironmentLighting => {
    const rgb = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) rgb.fill(at(x, y), (y * width + x) * 3, (y * width + x + 1) * 3);
    return prepareEnvironmentLighting({ width, height, rgb }, 1);
  };
  const shares = (cdf: Float32Array): number[] => [...cdf].map((v, i) => v - (i > 0 ? (cdf[i - 1] ?? 0) : 0));

  it('is monotone, 1 from the last row above the horizon on, and gives rows below it nothing', () => {
    for (const lighting of [
      environmentLighting(SOFTBOX),
      synthetic(8, 9, (x, y) => 0.1 + x + y),
      synthetic(8, 6, (_, y) => (y >= 3 ? 50 : 0.2)),
    ]) {
      const cdf = lighting.catcherMarginal;
      const upper = Math.ceil(lighting.height / 2);
      expect(cdf).toHaveLength(lighting.height);
      shares(cdf).forEach((share, row) => {
        expect(share, `row ${row}`).toBeGreaterThanOrEqual(0);
        if (row >= upper) expect(share, `row ${row} below the horizon`).toBe(0);
      });
      for (let row = upper - 1; row < lighting.height; row++) expect(cdf[row]).toBe(1);
    }
  });

  it('weights a row by its luminance sum times the integral of cos sin theta over its band, clipped at the horizon', () => {
    // A uniform image: rows share by cos^2 theta0 - cos^2 theta1 only; the odd middle row keeps its upper half.
    const lighting = synthetic(4, 5, () => 1);
    const band = (row: number): number => {
      const y0 = Math.max(0, Math.cos((Math.PI * row) / 5));
      const y1 = Math.max(0, Math.cos((Math.PI * (row + 1)) / 5));
      return y0 * y0 - y1 * y1;
    };
    shares(lighting.catcherMarginal).forEach((share, row) => expect(share, `row ${row}`).toBeCloseTo(band(row), 6));
  });

  it('stores each row band cos^2 theta0 - cos^2 theta1 clipped at the horizon, 0 below it', () => {
    for (const height of [8, 9]) {
      const { catcherBands } = synthetic(4, height, () => 1);
      for (let row = 0; row < height; row++) {
        const y0 = Math.cos((Math.PI * row) / height);
        const y1 = Math.max(0, Math.cos((Math.PI * (row + 1)) / height));
        const band = row < Math.ceil(height / 2) ? y0 * y0 - y1 * y1 : 0;
        expect(catcherBands[row], `height ${height}, row ${row}`).toBe(Math.fround(band));
      }
    }
  });

  it('falls back to uniform over the upper rows when they are all black', () => {
    const lighting = synthetic(4, 8, (_, y) => (y >= 4 ? 3 : 0));
    expect([...lighting.catcherMarginal]).toEqual([0.25, 0.5, 0.75, 1, 1, 1, 1, 1]);
  });

  it('does not depend on the intensity', () => {
    expect(environmentLighting({ ...SOFTBOX, intensity: 3 }).catcherMarginal).toEqual(
      environmentLighting(SOFTBOX).catcherMarginal,
    );
  });
});

describe('environment sampling (the path tracer mirror)', () => {
  const lighting = environmentLighting(SOFTBOX);

  it('the density integrates to 1 over the sphere (midpoint rule in theta and phi, 4 x 4 per pixel)', () => {
    const steps = 4;
    const rows = lighting.height * steps;
    const columns = lighting.width * steps;
    const dTheta = Math.PI / rows;
    const dPhi = (2 * Math.PI) / columns;
    let total = 0;
    for (let y = 0; y < rows; y++) {
      const v = (y + 0.5) / rows;
      for (let x = 0; x < columns; x++) {
        total +=
          environmentPdf(lighting, equirectDirection((x + 0.5) / columns, v)) * Math.sin(Math.PI * v) * dTheta * dPhi;
      }
    }
    expect(total).toBeCloseTo(1, 6);
  });

  it('environmentPdf of a sampled direction is the density the sample reports', () => {
    const random = seeded(47);
    for (let i = 0; i < 4096; i++) {
      const { direction, pdf } = sampleEnvironment(lighting, random(), random());
      expect(Math.hypot(...direction)).toBeCloseTo(1, 9);
      expect(pdf).toBeGreaterThan(0);
      expect(Math.abs(environmentPdf(lighting, direction) / pdf - 1)).toBeLessThan(1e-3);
    }
  });

  it('64k samples fall on the rows and columns in proportion to luminance x sin(theta)', () => {
    const random = seeded(48);
    const samples = 65_536;
    const rows = new Float64Array(lighting.height);
    const columns = new Float64Array(lighting.width);
    for (let i = 0; i < samples; i++) {
      const [u, v] = equirectUv(sampleEnvironment(lighting, random(), random()).direction);
      rows[Math.min(lighting.height - 1, Math.floor(v * lighting.height))]! += 1;
      columns[Math.min(lighting.width - 1, Math.floor(u * lighting.width))]! += 1;
    }
    const weight = (x: number, y: number): number => {
      const i = (y * lighting.width + x) * 4;
      const lum =
        0.2126 * (lighting.table[i] ?? 0) +
        0.7152 * (lighting.table[i + 1] ?? 0) +
        0.0722 * (lighting.table[i + 2] ?? 0);
      return lum * Math.sin((Math.PI * (y + 0.5)) / lighting.height);
    };
    let total = 0;
    const rowWeight = new Float64Array(lighting.height);
    const columnWeight = new Float64Array(lighting.width);
    for (let y = 0; y < lighting.height; y++) {
      for (let x = 0; x < lighting.width; x++) {
        const w = weight(x, y);
        rowWeight[y]! += w;
        columnWeight[x]! += w;
        total += w;
      }
    }
    // Within 5 standard deviations of the binomial count, plus a count of slack for the tiny bins.
    const check = (observed: Float64Array, expected: Float64Array): void => {
      observed.forEach((count, i) => {
        const p = (expected[i] ?? 0) / total;
        const sigma = Math.sqrt(samples * p * (1 - p));
        expect(Math.abs(count - samples * p), `bin ${i}`).toBeLessThan(5 * sigma + 2);
      });
    };
    check(rows, rowWeight);
    check(columns, columnWeight);
  });
});
