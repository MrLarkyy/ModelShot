import type { Vec3 } from './Vec3';

/** 4×4 matrix, column-major (`m[column * 4 + row]`), as WebGL expects. */
export type Mat4 = Float64Array;

export function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += at(a, k, row) * at(b, col, k);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** `Rz · Ry · Rx` for Euler angles in degrees (three.js order `'ZYX'`, as Blockbench uses). */
export function mat4Rotation(rotationDegrees: Vec3): Mat4 {
  const [sx, cx] = sinCosDegrees(rotationDegrees[0]);
  const [sy, cy] = sinCosDegrees(rotationDegrees[1]);
  const [sz, cz] = sinCosDegrees(rotationDegrees[2]);
  const m = mat4Identity();
  m[0] = cz * cy;
  m[1] = sz * cy;
  m[2] = -sy;
  m[4] = cz * sy * sx - sz * cx;
  m[5] = sz * sy * sx + cz * cx;
  m[6] = cy * sx;
  m[8] = cz * sy * cx + sz * sx;
  m[9] = sz * sy * cx - cz * sx;
  m[10] = cy * cx;
  return m;
}

/** Node local matrix `T(translation) · T(pivot) · Rz · Ry · Rx · T(−pivot)`. */
export function mat4NodeLocal(translation: Vec3, pivot: Vec3, rotationDegrees: Vec3): Mat4 {
  const m = mat4Rotation(rotationDegrees);
  const rotatedPivot = mat4TransformDirection(m, pivot);
  m[12] = translation[0] + pivot[0] - rotatedPivot[0];
  m[13] = translation[1] + pivot[1] - rotatedPivot[1];
  m[14] = translation[2] + pivot[2] - rotatedPivot[2];
  return m;
}

export function mat4TransformPoint(m: Mat4, p: Vec3): [number, number, number] {
  const [x, y, z] = mat4TransformDirection(m, p);
  return [x + at(m, 3, 0), y + at(m, 3, 1), z + at(m, 3, 2)];
}

/** Applies the upper 3×3 only (no translation); for rigid transforms this also maps normals. */
export function mat4TransformDirection(m: Mat4, d: Vec3): [number, number, number] {
  return [
    at(m, 0, 0) * d[0] + at(m, 1, 0) * d[1] + at(m, 2, 0) * d[2],
    at(m, 0, 1) * d[0] + at(m, 1, 1) * d[1] + at(m, 2, 1) * d[2],
    at(m, 0, 2) * d[0] + at(m, 1, 2) * d[1] + at(m, 2, 2) * d[2],
  ];
}

function at(m: Mat4, col: number, row: number): number {
  return m[col * 4 + row] ?? 0;
}

// Quarter turns are exact so axis-aligned models keep integer coordinates (Math.cos(π/2) is 6e-17, not 0).
function sinCosDegrees(degrees: number): [number, number] {
  const turn = ((degrees % 360) + 360) % 360;
  if (turn === 0) return [0, 1];
  if (turn === 90) return [1, 0];
  if (turn === 180) return [0, -1];
  if (turn === 270) return [-1, 0];
  const radians = (degrees * Math.PI) / 180;
  return [Math.sin(radians), Math.cos(radians)];
}
