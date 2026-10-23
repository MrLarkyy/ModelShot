// The package index pulls in GLSL through Vite's ?raw, which Playwright cannot load: the plain module directly.
import { agxToneMap, type Rgb } from '../../../packages/looks/src/agxToneMap';
import type { LookToneMapping } from '../../../packages/looks/src/LookPreset';

/**
 * Scene-linear colour whose AgX display value (`agxToneMap`, 0..1) is `display`: Newton's method on the forward
 * transform with a numeric Jacobian, from mid grey. For test measures in linear light (MSAA resolves average samples
 * before the tone map); a display value at 0 or 1 in some channel has no unique inverse and comes back approximate.
 */
export function agxInverse(display: Rgb, toneMapping?: Pick<LookToneMapping, 'exposure' | 'grade'>): Rgb {
  // Solved in log2 space: the transform is close to linear there, and the result stays positive.
  let x: [number, number, number] = [-2, -2, -2];
  const forward = (v: Rgb): [number, number, number] => agxToneMap([2 ** v[0], 2 ** v[1], 2 ** v[2]], toneMapping);
  for (let iteration = 0; iteration < 40; iteration++) {
    const y = forward(x);
    const r = [0, 1, 2].map((c) => (y[c] ?? 0) - (display[c] ?? 0));
    if (Math.max(...r.map(Math.abs)) < 1e-9) break;
    const h = 1e-4;
    // Column c: d forward / d x[c].
    const jacobian = [0, 1, 2].map((c) => {
      const step: [number, number, number] = [x[0], x[1], x[2]];
      step[c] = (step[c] ?? 0) + h;
      const yh = forward(step);
      return [0, 1, 2].map((k) => ((yh[k] ?? 0) - (y[k] ?? 0)) / h);
    });
    const delta = solve3(jacobian, r);
    if (!delta) break;
    x = [x[0] - (delta[0] ?? 0), x[1] - (delta[1] ?? 0), x[2] - (delta[2] ?? 0)];
  }
  return [2 ** x[0], 2 ** x[1], 2 ** x[2]];
}

/** Solves J d = r for d, J given by columns; null when singular. */
function solve3(columns: number[][], r: number[]): number[] | null {
  const m = (row: number, col: number): number => columns[col]?.[row] ?? 0;
  const det3 = (a: (row: number, col: number) => number): number =>
    a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) -
    a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) +
    a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
  const det = det3(m);
  if (Math.abs(det) < 1e-12) return null;
  return [0, 1, 2].map((col) => det3((row, c) => (c === col ? (r[row] ?? 0) : m(row, c))) / det);
}
