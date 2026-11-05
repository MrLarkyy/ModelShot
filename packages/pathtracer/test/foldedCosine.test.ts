import { describe, expect, it } from 'vitest';
import { pathTracerProgramSource } from '../src/pathTracerShaders';

type Vec = readonly [number, number, number];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec): Vec => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Mirror of foldedCosinePdf (pathSampling.glsl). */
function foldedCosinePdf(n: Vec, side: Vec, d: Vec): number {
  const below = dot(d, side);
  const m: Vec = [d[0] - 2 * below * side[0], d[1] - 2 * below * side[1], d[2] - 2 * below * side[2]];
  return (Math.max(dot(n, d), 0) + Math.max(dot(n, m), 0)) / Math.PI;
}

const SIDE: Vec = [0, 1, 0];
const sky = (d: Vec): number => 1 + 0.8 * d[0] + 0.5 * d[1] ** 2;

/** Mean of sky over aboveSurface(cosineDirection(n)) on a stratified grid: what the bounce strategy estimates. */
function foldedSamplingMean(n: Vec, count: number): number {
  const up: Vec = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = normalize([up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]]);
  const b: Vec = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      const r = Math.sqrt((i + 0.5) / count);
      const phi = (2 * Math.PI * (j + 0.5)) / count;
      const z = Math.sqrt(1 - (i + 0.5) / count);
      let d: Vec = [
        t[0] * r * Math.cos(phi) + b[0] * r * Math.sin(phi) + n[0] * z,
        t[1] * r * Math.cos(phi) + b[1] * r * Math.sin(phi) + n[1] * z,
        t[2] * r * Math.cos(phi) + b[2] * r * Math.sin(phi) + n[2] * z,
      ];
      const below = dot(d, SIDE);
      if (below < 0) d = [d[0] - 2 * below * SIDE[0], d[1] - 2 * below * SIDE[1], d[2] - 2 * below * SIDE[2]];
      sum += sky(d);
    }
  }
  return sum / (count * count);
}

/** The integral of pdf x sky over the hemisphere above SIDE: what the light sampling covers. */
function pdfIntegral(n: Vec, weighted: boolean, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      const y = (i + 0.5) / count;
      const r = Math.sqrt(1 - y * y);
      const phi = (2 * Math.PI * (j + 0.5)) / count;
      const d: Vec = [r * Math.cos(phi), y, r * Math.sin(phi)];
      sum += foldedCosinePdf(n, SIDE, d) * (weighted ? sky(d) : 1);
    }
  }
  return (sum * 2 * Math.PI) / (count * count);
}

describe('foldedCosinePdf', () => {
  for (const degrees of [0, 15, 30, 45, 70]) {
    const a = (degrees * Math.PI) / 180;
    const n: Vec = [Math.sin(a), Math.cos(a), 0];

    it(`integrates to 1 over the upper side for a normal bent ${degrees} degrees`, () => {
      expect(pdfIntegral(n, false, 600)).toBeCloseTo(1, 3);
    });

    it(`carries the energy of the folded bounce for a normal bent ${degrees} degrees`, () => {
      expect(pdfIntegral(n, true, 600)).toBeCloseTo(foldedSamplingMean(n, 600), 2);
    });
  }

  it('is the plain cosine lobe where the normal is the surface normal', () => {
    const d = normalize([0.3, 0.8, -0.2]);
    expect(foldedCosinePdf(SIDE, SIDE, d)).toBeCloseTo(d[1] / Math.PI, 12);
  });

  it('is the one the shaders use', () => {
    const source = pathTracerProgramSource('trace').fragment;
    expect(source).toContain('float foldedCosinePdf(vec3 n, vec3 side, vec3 d)');
    expect(source).toContain('return (max(dot(n, d), 0.0) + max(dot(n, mirrored), 0.0)) / 3.141592653589793;');
  });
});
