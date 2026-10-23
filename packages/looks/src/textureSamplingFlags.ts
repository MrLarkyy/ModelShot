/**
 * A texture's sampling as one integer of bits, the form both renderers hand to `faceTexel` (glsl/faceTexels.glsl, which
 * holds the same bits): per vertex in the preview, per material row in the path tracer.
 */
export const TEXTURE_FLAG_REPEAT = 1;

/** The scene's resolved sampling of a texture (`textureSampling` of `@modelshot/scene`). */
export interface TextureSamplingInput {
  readonly wrap: 'clamp' | 'repeat';
}

/** The flag bits of a texture's resolved sampling; 0 for clamp. */
export function textureSamplingFlags(sampling: TextureSamplingInput): number {
  return sampling.wrap === 'repeat' ? TEXTURE_FLAG_REPEAT : 0;
}
