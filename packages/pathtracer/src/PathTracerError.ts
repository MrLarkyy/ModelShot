export type PathTracerErrorCode =
  | 'WEBGL2_UNAVAILABLE'
  | 'FLOAT_TARGETS_UNAVAILABLE'
  | 'HIGHP_UNAVAILABLE'
  | 'SHADER_COMPILE'
  | 'SHADER_LINK'
  | 'INVALID_SCENE'
  | 'SCENE_TOO_LARGE';

/**
 * A failure the path tracer cannot render around. `FLOAT_TARGETS_UNAVAILABLE` / `HIGHP_UNAVAILABLE`: this GPU cannot
 * accumulate exactly (the preview still works); `SCENE_TOO_LARGE`: a limit was exceeded before anything was allocated;
 * `INVALID_SCENE`: `path` names the offending scene field.
 */
export class PathTracerError extends Error {
  override readonly name = 'PathTracerError';

  constructor(
    readonly code: PathTracerErrorCode,
    message: string,
    readonly path = '',
  ) {
    super(path ? `${message} (at ${path})` : message);
  }
}
