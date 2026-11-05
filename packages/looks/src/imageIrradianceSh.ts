import type { RadianceImage } from '@modelshot/formats';
import { equirectDirection } from './equirect';
import { SH_COSINE_BANDS, shBasis } from './shIrradiance';

/**
 * L2 spherical harmonics of the image's irradiance over π at `intensity` (27 floats: nine RGB coefficients, each pixel
 * weighted by its exact solid angle, each band times `SH_COSINE_BANDS`): the fill of a unit-albedo Lambert surface.
 * The preview reads them precomputed (`environmentSh`); a test keeps the two equal.
 */
export function imageIrradianceSh(image: RadianceImage, intensity: number): Float32Array {
  const { width, height, rgb } = image;
  const sums = new Float64Array(27);
  for (let y = 0; y < height; y++) {
    const solidAngle =
      ((2 * Math.PI) / width) * (Math.cos((Math.PI * y) / height) - Math.cos((Math.PI * (y + 1)) / height));
    for (let x = 0; x < width; x++) {
      const basis = shBasis(equirectDirection((x + 0.5) / width, (y + 0.5) / height));
      const i = (y * width + x) * 3;
      for (let k = 0; k < 9; k++) {
        const w = (basis[k] ?? 0) * solidAngle;
        for (let c = 0; c < 3; c++) sums[k * 3 + c] = (sums[k * 3 + c] ?? 0) + (rgb[i + c] ?? 0) * w;
      }
    }
  }
  return Float32Array.from(sums, (value, j) => value * (SH_COSINE_BANDS[Math.floor(j / 3)] ?? 0) * intensity);
}
