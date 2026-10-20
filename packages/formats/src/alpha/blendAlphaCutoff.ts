/**
 * Cutoff of a blended material from a format whose blend mode has none (glTF `BLEND`, textured OBJ materials): only an
 * alpha byte of 0 is invisible, every byte from 1 to 254 is partial. Half a byte step, so a GPU's 8-bit alpha of 1/255
 * never rounds below it; the scene default of 0.5 would hide every texel under half alpha.
 */
export const BLEND_ALPHA_CUTOFF = 0.5 / 255;
