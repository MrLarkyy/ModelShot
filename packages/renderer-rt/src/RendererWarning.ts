export type RendererWarningCode =
  'TEXTURE_MISSING' | 'TEXTURE_TOO_LARGE' | 'TEXTURE_DECODE_FAILED' | 'TEXTURE_SIZE_MISMATCH';

/** A texture the renderer replaced by its placeholder; the rest of the scene still draws. */
export interface RendererWarning {
  readonly code: RendererWarningCode;
  /** Index into `SceneDocument.textures`. */
  readonly texture: number;
  readonly message: string;
}
