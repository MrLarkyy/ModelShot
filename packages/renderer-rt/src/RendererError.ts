export type RendererErrorCode = 'WEBGL2_UNAVAILABLE' | 'SHADER_COMPILE' | 'SHADER_LINK' | 'INVALID_SCENE';

/** A failure the renderer cannot recover from; `path` names the offending scene field for `INVALID_SCENE`. */
export class RendererError extends Error {
  override readonly name = 'RendererError';

  constructor(
    readonly code: RendererErrorCode,
    message: string,
    readonly path = '',
  ) {
    super(path ? `${message} (at ${path})` : message);
  }
}
