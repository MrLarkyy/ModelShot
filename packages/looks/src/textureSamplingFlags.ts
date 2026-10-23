/**
 * A texture's sampling as one integer of bits, the form both renderers hand to `faceTexel` (glsl/faceTexels.glsl, which
 * holds the same bits): per vertex in the preview, per material row in the path tracer. Bit 0: repeat; bits 8 and up:
 * the frame count of a strip minus 1 (0 for a still image), so a still clamped texture is 0.
 */
export const TEXTURE_FLAG_REPEAT = 1;
export const TEXTURE_FRAMES_SHIFT = 8;
/** Largest frame count the flags carry; the word stays an integer a 32-bit float holds exactly (below 2^24). */
export const MAX_TEXTURE_FLAG_FRAMES = 65_535;

/** The scene's resolved sampling of a texture (`textureSampling` of `@modelshot/scene`). */
export interface TextureSamplingInput {
  readonly wrap: 'clamp' | 'repeat';
  /** Frames of a vertical strip (`SceneTextureFrames.count`), 1 for a still image. */
  readonly frames: number;
}

/** The flag bits of a texture's resolved sampling; a frame count that is no integer in 2..65 535 counts as 1. */
export function textureSamplingFlags(sampling: TextureSamplingInput): number {
  const frames = sampling.frames;
  const strip = Number.isInteger(frames) && frames >= 2 && frames <= MAX_TEXTURE_FLAG_FRAMES ? frames : 1;
  return (sampling.wrap === 'repeat' ? TEXTURE_FLAG_REPEAT : 0) + (strip - 1) * 2 ** TEXTURE_FRAMES_SHIFT;
}
