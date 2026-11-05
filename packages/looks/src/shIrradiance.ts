import type { Rgb } from './agxToneMap';
import type { Direction } from './LookPreset';

/** The nine real spherical harmonics of bands 0..2 at the unit direction d (Ramamoorthi and Hanrahan 2001). */
export function shBasis(d: Direction): [number, number, number, number, number, number, number, number, number] {
  const [x, y, z] = d;
  return [
    0.282095,
    0.488603 * y,
    0.488603 * z,
    0.488603 * x,
    1.092548 * x * y,
    1.092548 * y * z,
    0.315392 * (3 * z * z - 1),
    1.092548 * x * z,
    0.546274 * (x * x - y * y),
  ];
}

/**
 * Band factors of the clamped cosine over π (A_l / π: 1, 2/3, 1/4): radiance coefficients times these are those of
 * the irradiance over π, the fill a unit-albedo Lambert surface reflects.
 */
export const SH_COSINE_BANDS: readonly number[] = Object.freeze([1, 2 / 3, 2 / 3, 2 / 3, 0.25, 0.25, 0.25, 0.25, 0.25]);

/**
 * The fill of `sh` (27 floats: nine RGB coefficients of irradiance over π, `imageIrradianceSh`) at the unit
 * normal n of the image's frame, as `hemisphereFill` (lightRig chunk) evaluates it before clamping at 0.
 */
export function shIrradiance(sh: ArrayLike<number>, n: Direction): Rgb {
  const basis = shBasis(n);
  const out = [0, 0, 0];
  for (let k = 0; k < 9; k++) {
    for (let c = 0; c < 3; c++) out[c] = (out[c] ?? 0) + (sh[k * 3 + c] ?? 0) * (basis[k] ?? 0);
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}
