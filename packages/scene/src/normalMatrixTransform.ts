import type { Vec3 } from './Vec3';

/**
 * Applies a normal matrix as `mat4NormalMatrix` returns it (column-major 3×3, `n[column * 3 + row]`) to `v`; the
 * result is not normalised.
 */
export function normalMatrixTransform(n: ArrayLike<number>, v: Vec3): [number, number, number] {
  const e = (i: number): number => n[i] ?? 0;
  return [
    e(0) * v[0] + e(3) * v[1] + e(6) * v[2],
    e(1) * v[0] + e(4) * v[1] + e(7) * v[2],
    e(2) * v[0] + e(5) * v[1] + e(8) * v[2],
  ];
}
