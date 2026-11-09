import { describe, expect, it } from 'vitest';
import type { Rgb } from '../src/agxToneMap';
import { sampleDomeCatcherFill, sampleImageCatcherFill, type CatcherFillSample } from '../src/catcherFillSampling';
import { environmentLighting, prepareEnvironmentLighting, type EnvironmentLighting } from '../src/environmentLighting';
import { environmentYaw, equirectUv, imageDirection } from '../src/equirect';
import type { Direction, LookDomeEnvironment } from '../src/LookPreset';
import { LOOK_PRESETS } from '../src/lookPresets';

type Dome = Pick<LookDomeEnvironment, 'sky' | 'ground'>;

/**
 * An image's loss is constant up to the float32 tables: P is a difference of stored CDF values, so a dim pixel's P
 * carries the CDF's rounding relative to its size (2.6e-6 at most for the images below).
 */
const CONSTANT_LOSS_TOLERANCE = 1e-5;

const luminance = (c: readonly number[]): number => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);

/** Every dome of the shipped presets plus the corners checkLookPreset allows. */
const DOMES: readonly (readonly [string, Dome])[] = [
  ...Object.entries(LOOK_PRESETS).flatMap(([id, look]) =>
    look.environment.kind === 'dome' ? [[id, look.environment] as const] : [],
  ),
  ['ground 5 x sky', { sky: [0.1, 0.12, 0.08], ground: [0.5, 0.6, 0.4] }],
  ['sky 5 x ground', { sky: [0.5, 0.6, 0.4], ground: [0.1, 0.12, 0.08] }],
  ['sky = ground', { sky: [0.3, 0.3, 0.3], ground: [0.3, 0.3, 0.3] }],
  ['one channel 0 in both', { sky: [0.5, 0, 0.3], ground: [0.2, 0, 0.6] }],
];

/** A synthetic image: `at(x, y)` per pixel, row 0 the zenith. */
function image(width: number, height: number, at: (x: number, y: number) => Rgb, intensity = 1): EnvironmentLighting {
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgb.set(at(x, y), (y * width + x) * 3);
  }
  return prepareEnvironmentLighting({ width, height, rgb }, intensity);
}

const SOFTBOX = environmentLighting({ image: 'softbox-studio', intensity: 1 });
const IMAGES: readonly (readonly [string, EnvironmentLighting])[] = [
  ['softbox-studio', SOFTBOX],
  ['softbox-studio x 2.5', environmentLighting({ image: 'softbox-studio', intensity: 2.5 })],
  ['uniform', image(16, 8, () => [0.4, 0.5, 0.6])],
  ['one hot pixel above the horizon', image(16, 8, (x, y) => (x === 5 && y === 2 ? [9, 7, 5] : [0, 0, 0]))],
  ['a hot pixel over a dim sky', image(16, 8, (x, y) => (x === 11 && y === 1 ? [40, 30, 20] : [0.05, 0.06, 0.07]))],
  ['hot only below the horizon', image(16, 8, (_, y) => (y >= 4 ? [3, 3, 3] : [0, 0, 0]))],
  ['odd height, a row across the horizon', image(12, 9, (x, y) => [0.1 + 0.05 * x, 0.2 + 0.1 * y, 0.3])],
];

/** Z / π: the cos-weighted mean luminance of the piecewise-constant image over the upper hemisphere, in float64. */
function cosMeanLuminance(lighting: EnvironmentLighting): number {
  const { width, height, table } = lighting;
  let sum = 0;
  for (let row = 0; row < Math.ceil(height / 2); row++) {
    const y0 = Math.cos((Math.PI * row) / height);
    const y1 = Math.max(0, Math.cos((Math.PI * (row + 1)) / height));
    for (let x = 0; x < width; x++) {
      const at = (row * width + x) * 4;
      sum +=
        (luminance([table[at] ?? 0, table[at + 1] ?? 0, table[at + 2] ?? 0]) *
          (((2 * Math.PI) / width) * (y0 * y0 - y1 * y1))) /
        2;
    }
  }
  return sum / Math.PI;
}

/** The image's radiance along a world direction (escapeRadiance of the environmentMap chunk). */
function imageRadiance(lighting: EnvironmentLighting, yaw: readonly [number, number], d: Direction): Rgb {
  const [u, v] = equirectUv(imageDirection(d, yaw));
  const x = Math.min(lighting.width - 1, Math.floor(u * lighting.width));
  const row = Math.min(lighting.height - 1, Math.floor(v * lighting.height));
  const at = (row * lighting.width + x) * 4;
  return [lighting.table[at] ?? 0, lighting.table[at + 1] ?? 0, lighting.table[at + 2] ?? 0];
}

/** The dome's environmentRadiance at direction height y (lightRig.glsl). */
function domeRadiance(dome: Dome, y: number): Rgb {
  const channel = (c: 0 | 1 | 2): number => dome.ground[c] + (dome.sky[c] - dome.ground[c]) * (y * 0.75 + 0.5);
  return [channel(0), channel(1), channel(2)];
}

/** A Fibonacci lattice of `FIB` points in [0, 1)²: u1 stratified, u2 = frac(i × FIB_PREV / FIB). */
const FIB = 196_418;
const FIB_PREV = 121_393;
function lattice(visit: (u1: number, u2: number) => void, count = FIB, step = FIB_PREV): void {
  for (let i = 0; i < count; i++) visit((i + 0.5) / count, ((i * step) % count) / count + 0.5 / count);
}

/** The cosine-weighted direction of the path tracer (cosineDirection around +y: y = sqrt(1 - u1)). */
function cosineDirection(u1: number, u2: number): Direction {
  const r = Math.sqrt(u1);
  const phi = 2 * Math.PI * u2;
  return [r * Math.cos(phi), Math.sqrt(Math.max(0, 1 - u1)), r * Math.sin(phi)];
}

const BLOCKERS: readonly (readonly [string, (d: Direction) => boolean])[] = [
  ['a cap above y 0.6', (d) => d[1] > 0.6],
  ['the half x > 0', (d) => d[0] > 0],
  ['a band 0.2 < y < 0.4', (d) => d[1] > 0.2 && d[1] < 0.4],
  ['everything', () => true],
];

/** Per channel: the importance-sampled mean of B x lost and the cosine-sampled mean of B x radiance. */
function estimates(
  sample: (u1: number, u2: number) => CatcherFillSample,
  radiance: (d: Direction) => Rgb,
  blocked: (d: Direction) => boolean,
): { importance: number[]; cosine: number[] } {
  const importance = [0, 0, 0];
  const cosine = [0, 0, 0];
  lattice((u1, u2) => {
    const s = sample(u1, u2);
    if (blocked(s.direction)) for (let c = 0; c < 3; c++) importance[c]! += s.lost[c as 0];
    const d = cosineDirection(u1, u2);
    if (blocked(d)) {
      const l = radiance(d);
      for (let c = 0; c < 3; c++) cosine[c]! += l[c as 0];
    }
  });
  return { importance: importance.map((v) => v / FIB), cosine: cosine.map((v) => v / FIB) };
}

describe('catcher fill sampling under a dome (the catcherFill chunk mirror)', () => {
  for (const [name, dome] of DOMES) {
    it(`${name}: a blocked sample always loses lum(sky)`, () => {
      const expected = luminance(dome.sky);
      let worst = 0;
      lattice(
        (u1, u2) => {
          const { direction, lost } = sampleDomeCatcherFill(dome, u1, u2);
          expect(direction[1]).toBeGreaterThanOrEqual(0);
          worst = Math.max(worst, Math.abs(luminance(lost) / expected - 1));
        },
        4096,
        2531,
      );
      expect(worst).toBeLessThan(1e-6);
    });

    it(`${name}: the importance-sampled blocked fill has the cosine estimate's mean`, () => {
      for (const [blocker, blocked] of BLOCKERS) {
        const { importance, cosine } = estimates(
          (u1, u2) => sampleDomeCatcherFill(dome, u1, u2),
          (d) => domeRadiance(dome, d[1]),
          blocked,
        );
        for (let c = 0; c < 3; c++) {
          expect(Math.abs((importance[c] ?? 0) - (cosine[c] ?? 0)), `${blocker}, channel ${c}`).toBeLessThan(1e-3);
          if (blocker === 'everything') expect(Math.abs((importance[c] ?? 0) - dome.sky[c as 0])).toBeLessThan(1e-4);
        }
      }
    });

    it(`${name}: directions fall on y in proportion to y x lum(environmentRadiance)`, () => {
      const bins = 20;
      const count = 65_536;
      const observed = new Float64Array(bins);
      lattice(
        (u1, u2) => {
          const y = sampleDomeCatcherFill(dome, u1, u2).direction[1];
          expect(y).toBeGreaterThanOrEqual(0);
          observed[Math.min(bins - 1, Math.floor(y * bins))]! += 1 / count;
        },
        count,
        40_503,
      );
      const a = luminance(domeRadiance(dome, 0));
      const b = luminance(domeRadiance(dome, 1)) - a;
      const mass = (y: number): number => (a * y * y) / 2 + (b * y * y * y) / 3;
      observed.forEach((share, k) => {
        const expected = (mass((k + 1) / bins) - mass(k / bins)) / mass(1);
        expect(Math.abs(share - expected), `bin ${k}`).toBeLessThanOrEqual(0.02 * expected + 2 / count);
      });
    });
  }

  it('a lightless dome loses nothing and stays finite', () => {
    lattice(
      (u1, u2) => {
        const { direction, lost } = sampleDomeCatcherFill({ sky: [0, 0, 0], ground: [0, 0, 0] }, u1, u2);
        expect([...direction, ...lost].every(Number.isFinite)).toBe(true);
        expect(lost).toEqual([0, 0, 0]);
      },
      256,
      89,
    );
  });
});

describe('catcher fill sampling of an image (the catcherFill chunk mirror)', () => {
  const yaw = environmentYaw(37);

  for (const [name, lighting] of IMAGES) {
    it(`${name}: a blocked sample loses the cos-weighted mean luminance Z / pi`, () => {
      const expected = cosMeanLuminance(lighting);
      let worst = 0;
      lattice(
        (u1, u2) => {
          const { direction, lost } = sampleImageCatcherFill(lighting, yaw, u1, u2);
          expect(direction[1]).toBeGreaterThanOrEqual(0);
          expect(Math.hypot(...direction)).toBeCloseTo(1, 9);
          const lum = luminance(lost);
          worst = Math.max(worst, expected > 0 ? Math.abs(lum / expected - 1) : lum);
        },
        4096,
        2531,
      );
      console.log(`[catcher fill] ${name}: worst relative loss error ${worst.toExponential(2)}`);
      expect(worst).toBeLessThan(CONSTANT_LOSS_TOLERANCE);
    });

    it(`${name}: the importance-sampled blocked fill has the cosine estimate's mean`, () => {
      const scale = Math.max(cosMeanLuminance(lighting), 1e-9);
      for (const [blocker, blocked] of BLOCKERS) {
        const { importance, cosine } = estimates(
          (u1, u2) => sampleImageCatcherFill(lighting, yaw, u1, u2),
          (d) => imageRadiance(lighting, yaw, d),
          blocked,
        );
        for (let c = 0; c < 3; c++) {
          expect(Math.abs((importance[c] ?? 0) - (cosine[c] ?? 0)) / scale, `${blocker}, channel ${c}`).toBeLessThan(
            1e-3,
          );
        }
      }
    });
  }

  it('directions fall on y in proportion to y x the row luminance, the same y at any yaw', () => {
    const { width, height, table } = SOFTBOX;
    const bins = 20;
    const count = 65_536;
    const observed = new Float64Array(bins);
    lattice(
      (u1, u2) => {
        const turned = sampleImageCatcherFill(SOFTBOX, environmentYaw(90), u1, u2).direction[1];
        const y = sampleImageCatcherFill(SOFTBOX, environmentYaw(0), u1, u2).direction[1];
        expect(turned).toBe(y);
        observed[Math.min(bins - 1, Math.floor(y * bins))]! += 1 / count;
      },
      count,
      40_503,
    );
    const rowLuminance = Array.from({ length: height }, (_, row) => {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        const at = (row * width + x) * 4;
        sum += luminance([table[at] ?? 0, table[at + 1] ?? 0, table[at + 2] ?? 0]);
      }
      return sum;
    });
    // Mass of y in [a, b]: per row its luminance times the integral of y dy over the overlap with the row's band.
    const mass = (a: number, b: number): number =>
      rowLuminance.reduce((total, lum, row) => {
        const top = Math.min(b, Math.max(0, Math.cos((Math.PI * row) / height)));
        const bottom = Math.max(a, Math.max(0, Math.cos((Math.PI * (row + 1)) / height)));
        return top > bottom ? total + (lum * (top * top - bottom * bottom)) / 2 : total;
      }, 0);
    observed.forEach((share, k) => {
      const expected = mass(k / bins, (k + 1) / bins) / mass(0, 1);
      expect(Math.abs(share - expected), `bin ${k}`).toBeLessThanOrEqual(0.02 * expected + 2 / count);
    });
  });

  it('an image black above the horizon loses nothing and stays finite', () => {
    const black = image(16, 8, (_, y) => (y >= 4 ? [3, 3, 3] : [0, 0, 0]));
    lattice(
      (u1, u2) => {
        const { direction, lost } = sampleImageCatcherFill(black, yaw, u1, u2);
        expect([...direction, ...lost].every(Number.isFinite)).toBe(true);
        expect(lost).toEqual([0, 0, 0]);
      },
      256,
      89,
    );
  });
});
