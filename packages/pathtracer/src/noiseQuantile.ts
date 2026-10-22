/** The quantile of the noise estimate a convergence stop compares with `RenderRequest.noiseThreshold`. */
export const NOISE_QUANTILE = 0.99;

/**
 * The nearest-rank `q` quantile of `values` (NaN ignored, Infinity kept: a pixel whose noise is unknown yet), so a
 * few outlier blocks (a firefly, a lone partial texel) cannot hold a render back for good. `Infinity` without values.
 */
export function noiseQuantile(values: ArrayLike<number>, q: number = NOISE_QUANTILE): number {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (!Number.isNaN(v)) finite.push(v);
  }
  if (finite.length === 0) return Infinity;
  finite.sort((a, b) => a - b);
  const rank = Math.min(finite.length, Math.max(1, Math.ceil(q * finite.length)));
  return finite[rank - 1] as number;
}
