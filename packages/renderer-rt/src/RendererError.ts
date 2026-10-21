export type RendererErrorCode =
  'WEBGL2_UNAVAILABLE' | 'SHADER_COMPILE' | 'SHADER_LINK' | 'INVALID_SCENE' | 'SCENE_TOO_LARGE';

/**
 * A failure the renderer cannot recover from; `path` names the offending scene field for `INVALID_SCENE` and
 * `SCENE_TOO_LARGE` (a limit exceeded before anything was allocated).
 */
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
