import type { Mat4 } from '@modelshot/scene';

/** 3×3 matrix, row-major (`m[row * 3 + column]`). */
export type Mat3 = readonly number[];

/** The upper-left 3×3 (rotation, scale, shear) of a column-major 4×4. */
export function mat3FromMat4(m: Mat4): Mat3 {
  const at = (column: number, row: number): number => m[column * 4 + row] ?? 0;
  return [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => at(column, row)));
}

export function mat3Determinant(m: Mat3): number {
  const a = (i: number): number => m[i] ?? 0;
  return a(0) * (a(4) * a(8) - a(5) * a(7)) - a(1) * (a(3) * a(8) - a(5) * a(6)) + a(2) * (a(3) * a(7) - a(4) * a(6));
}

/**
 * Whether `m` flattens space: its determinant is at most 1e-9 of the product of its column lengths (so the test does
 * not depend on the overall scale), or a column is zero.
 */
export function mat3IsDegenerate(m: Mat3): boolean {
  const column = (c: number): number => Math.hypot(m[c] ?? 0, m[3 + c] ?? 0, m[6 + c] ?? 0);
  const scale = column(0) * column(1) * column(2);
  return !(scale > 0) || Math.abs(mat3Determinant(m)) <= 1e-9 * scale;
}

/** The inverse transpose (cofactors over the determinant): it carries normals under non-uniform scale and mirroring. */
export function mat3InverseTranspose(m: Mat3): Mat3 {
  const det = mat3Determinant(m);
  const a = (row: number, column: number): number => m[row * 3 + column] ?? 0;
  const cofactor = (row: number, column: number): number => {
    const [r0 = 0, r1 = 0] = [0, 1, 2].filter((i) => i !== row);
    const [c0 = 0, c1 = 0] = [0, 1, 2].filter((i) => i !== column);
    const minor = a(r0, c0) * a(r1, c1) - a(r0, c1) * a(r1, c0);
    return ((row + column) % 2 ? -minor : minor) / det;
  };
  return [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => cofactor(row, column)));
}

export function mat3TransformVector(m: Mat3, x: number, y: number, z: number): [number, number, number] {
  const a = (i: number): number => m[i] ?? 0;
  return [a(0) * x + a(1) * y + a(2) * z, a(3) * x + a(4) * y + a(5) * z, a(6) * x + a(7) * y + a(8) * z];
}
