/**
 * The path tracer's random numbers, mirrored by `shaders/rng.glsl` bit for bit: a PCG hash (Jarzynski and Olano,
 * "Hash Functions for GPU Rendering", JCGT 2020) chained over the seed, the sample index and the pixel, then over a
 * dimension. Pure functions of their inputs, so an image depends only on (scene, camera, seed, sample count).
 */
export function pcgHash(value: number): number {
  const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** Hash of one pixel's sample: every random number of that sample derives from it. */
export function sampleHash(seed: number, sample: number, x: number, y: number): number {
  let h = pcgHash(seed);
  h = pcgHash((h + sample) >>> 0);
  h = pcgHash((h + x) >>> 0);
  return pcgHash((h + y) >>> 0);
}

/**
 * Uniform number in [0, 1) for dimension `dimension` of a sample, with an optional `extra` key (a triangle, so each
 * partially transparent surface a ray meets gets its own number). 24 bits, exact in a float.
 */
export function unitRandom(sample: number, dimension: number, extra = 0): number {
  const h = pcgHash((pcgHash((sample + dimension) >>> 0) ^ extra) >>> 0);
  return (h >>> 8) / 16777216;
}
