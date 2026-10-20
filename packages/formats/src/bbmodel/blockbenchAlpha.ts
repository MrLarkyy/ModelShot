/**
 * Blockbench draws every texture blended and discards texels with alpha below 0.01 (`texture.frag.glsl`), so a
 * `.bbmodel` material is `alphaMode: 'blend'` with this cutoff.
 */
export const BLOCKBENCH_ALPHA_CUTOFF = 0.01;
