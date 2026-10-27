/**
 * Whether the opaque pass of a float-path frame covers cutout seams by alpha-to-coverage: the shader keeps the
 * fragments of the half-pixel band beside an opaque texel and writes the texel-AA coverage ramp as alpha, so only
 * then may A2C turn that alpha into samples.
 *
 * - `msaaBound`: the multisampled target is bound. Exact frames draw single-sampled (their key is the depth at the
 *   pixel centre), and without sample buffers GL ignores A2C, so the band fragments would grow the cutout shape by
 *   half a pixel. There each pass keeps the hard per-texel shape, and the mean of a still frame's shifted passes
 *   antialiases its seams (`exactSampleCount`).
 * - `samples`: the MSAA target's sample count. One sample turns the ramp into a hard step at alpha 0.5 at best; the
 *   binary per-texel discard is exact there.
 * - `texelAntialias`: without texel anti-aliasing the coverage is the nearest texel's alone, so A2C adds nothing.
 */
export function alphaToCoverageActive(msaaBound: boolean, samples: number, texelAntialias: boolean): boolean {
  return msaaBound && samples > 1 && texelAntialias;
}
