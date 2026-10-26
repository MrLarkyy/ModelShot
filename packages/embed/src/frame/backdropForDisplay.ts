import { MAX_LOOK_COLOR, agxToneMap, type LookToneMapping, type Rgb } from '@modelshot/looks';

const MIN_LOG2 = -20;
const MAX_LOG2 = Math.log2(MAX_LOOK_COLOR);
const STEP = 1e-4;
const ITERATIONS = 60;
const DONE = 1e-6;

type Vec3 = [number, number, number];

const clampLog = (x: number): number => Math.min(MAX_LOG2, Math.max(MIN_LOG2, x));
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function residual(x: Vec3, target: Rgb, toneMapping: Pick<LookToneMapping, 'exposure' | 'grade'>): Vec3 {
  const shown = agxToneMap([2 ** x[0], 2 ** x[1], 2 ** x[2]], toneMapping);
  return [shown[0] - target[0], shown[1] - target[1], shown[2] - target[2]];
}

const norm = (r: Vec3): number => r[0] * r[0] + r[1] * r[1] + r[2] * r[2];

/** Solves the 3 x 3 system `m` x = `b` (row-major) by Cramer's rule; null when singular. */
function solve3(m: readonly number[], b: Vec3): Vec3 | null {
  const det = (a: readonly number[]): number =>
    a[0]! * (a[4]! * a[8]! - a[5]! * a[7]!) -
    a[1]! * (a[3]! * a[8]! - a[5]! * a[6]!) +
    a[2]! * (a[3]! * a[7]! - a[4]! * a[6]!);
  const d = det(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-30) return null;
  const column = (c: number): number[] => m.map((v, i) => (i % 3 === c ? b[Math.floor(i / 3)]! : v));
  return [det(column(0)) / d, det(column(1)) / d, det(column(2)) / d];
}

/**
 * The scene-linear backdrop colour that `toneMapping` (the look's AgX view transform with its exposure and grade, the
 * one both renderers apply to the backdrop) displays as `display`, sRGB-encoded channels in 0..1: a page colour comes
 * out as that colour. Damped Gauss-Newton in log2 space through `agxToneMap`, so the transform lives once (looks).
 * A colour the transform cannot show (very saturated ones; AgX desaturates) gives the closest it can.
 */
export function backdropForDisplay(display: Rgb, toneMapping: Pick<LookToneMapping, 'exposure' | 'grade'>): Rgb {
  let x: Vec3 = [0, 1, 2].map((i) => clampLog(Math.log2(Math.max(2 ** MIN_LOG2, srgbToLinear(display[i]!))))) as Vec3;
  let r = residual(x, display, toneMapping);
  let lambda = 1e-3;
  for (let i = 0; i < ITERATIONS && Math.max(...r.map(Math.abs)) > DONE; i++) {
    // Jacobian by forward differences, column j = d residual / d x_j.
    const jac: Vec3[] = [0, 1, 2].map((j) => {
      const xj: Vec3 = [x[0] + (j === 0 ? STEP : 0), x[1] + (j === 1 ? STEP : 0), x[2] + (j === 2 ? STEP : 0)];
      const rj = residual(xj, display, toneMapping);
      return [(rj[0] - r[0]) / STEP, (rj[1] - r[1]) / STEP, (rj[2] - r[2]) / STEP];
    });
    const jtj: number[] = [];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const value = jac[a]![0] * jac[b]![0] + jac[a]![1] * jac[b]![1] + jac[a]![2] * jac[b]![2];
        jtj.push(a === b ? value * (1 + lambda) + 1e-12 : value);
      }
    }
    const jtr: Vec3 = [0, 1, 2].map((a) => -(jac[a]![0] * r[0] + jac[a]![1] * r[1] + jac[a]![2] * r[2])) as Vec3;
    const dx = solve3(jtj, jtr);
    const next: Vec3 | null = dx ? [clampLog(x[0] + dx[0]), clampLog(x[1] + dx[1]), clampLog(x[2] + dx[2])] : null;
    const nextR = next ? residual(next, display, toneMapping) : null;
    if (next && nextR && norm(nextR) < norm(r)) {
      x = next;
      r = nextR;
      lambda = Math.max(1e-9, lambda / 4);
    } else {
      lambda *= 8;
      if (lambda > 1e9) break;
    }
  }
  return Object.freeze([2 ** x[0], 2 ** x[1], 2 ** x[2]] as const);
}
