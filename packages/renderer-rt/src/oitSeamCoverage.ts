/**
 * How the OIT pass covers the seams of partial texels (`u_seamCoverage` of oitAccum.frag.glsl):
 *
 * - 0: off. The nearest texel alone decides and weighs, so seams stay hard. Accumulated exact frames (`accumulating`:
 *   one shifted pass of a sample history) are anti-aliased by the mean of their passes, and a second ramp in each
 *   pass would filter them twice; without texel anti-aliasing there is no ramp at all.
 * - 1: a one-pixel coverage ramp on partial|invisible and partial|partial seams, its 50 % point on the texel boundary;
 *   an opaque neighbour counts as the partial texel's own alpha, as the opaque pass keeps the hard per-texel shape.
 * - 2: as 1, but the opaque pass covers its seams by alpha-to-coverage (`alphaToCoverageActive`): a partial texel then
 *   takes the anti-aliased coverage of every tap, the opaque side of an opaque|partial seam being the opaque pass's.
 */
export type OitSeamCoverageMode = 0 | 1 | 2;

export function oitSeamCoverageMode(
  accumulating: boolean,
  texelAntialias: boolean,
  alphaToCoverage: boolean,
): OitSeamCoverageMode {
  if (accumulating || !texelAntialias) return 0;
  return alphaToCoverage ? 2 : 1;
}
