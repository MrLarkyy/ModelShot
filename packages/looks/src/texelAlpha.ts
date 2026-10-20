/**
 * Per-texel coverage on the 8-bit texel, for renderers that test alpha in a shader. The rule itself is the scene
 * format's (`resolveMaterialAlpha` / `texelCoverage` of `@modelshot/scene`); comparing alpha bytes against a cutoff
 * byte gives exactly its result for every byte, with no float rounding at the boundary. `glsl/texelAlpha.glsl` holds
 * the same ids and rule.
 */
export const ALPHA_MODE_ID = Object.freeze({ opaque: 0, mask: 1, blend: 2 } as const);
export type AlphaModeId = (typeof ALPHA_MODE_ID)[keyof typeof ALPHA_MODE_ID];

export const COVERAGE_INVISIBLE = 0;
export const COVERAGE_PARTIAL = 1;
export const COVERAGE_OPAQUE = 2;
export type CoverageId = typeof COVERAGE_INVISIBLE | typeof COVERAGE_PARTIAL | typeof COVERAGE_OPAQUE;

/**
 * The smallest alpha byte k with k / 255 ≥ `cutoff` (256 when none is), so `k < cutoffByte` is exactly
 * `k / 255 < cutoff`. `cutoff` is a resolved cutoff in 0..1.
 */
export function alphaCutoffByte(cutoff: number): number {
  for (let k = 0; k <= 255; k++) if (k / 255 >= cutoff) return k;
  return 256;
}

/** Coverage of a texel with alpha byte `k` (0..255) under a material's mode id and cutoff byte. */
export function texelCoverageByte(k: number, modeId: AlphaModeId, cutoffByte: number): CoverageId {
  if (modeId === ALPHA_MODE_ID.opaque) return COVERAGE_OPAQUE;
  if (k < cutoffByte) return COVERAGE_INVISIBLE;
  if (modeId === ALPHA_MODE_ID.mask || k >= 255) return COVERAGE_OPAQUE;
  return COVERAGE_PARTIAL;
}
