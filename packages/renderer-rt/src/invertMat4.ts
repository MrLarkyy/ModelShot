import type { Mat4 } from '@modelshot/scene';

/** Inverse of a column-major 4×4 matrix by cofactors (projection matrices here, always invertible). */
export function invertMat4(m: Mat4): Float64Array {
  const at = (col: number, row: number): number => m[col * 4 + row] ?? 0;
  const inverse = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      // Cofactor of element (row = col, column = row) of m, transposed into place.
      const rows = [0, 1, 2, 3].filter((r) => r !== col);
      const cols = [0, 1, 2, 3].filter((c) => c !== row);
      const a = (i: number, j: number): number => at(cols[j] ?? 0, rows[i] ?? 0);
      const minor =
        a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) -
        a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) +
        a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
      inverse[col * 4 + row] = ((row + col) % 2 === 0 ? 1 : -1) * minor;
    }
  }
  const det = at(0, 0) * inverse[0]! + at(1, 0) * inverse[1]! + at(2, 0) * inverse[2]! + at(3, 0) * inverse[3]!;
  for (let i = 0; i < 16; i++) inverse[i] = inverse[i]! / det;
  return inverse;
}
