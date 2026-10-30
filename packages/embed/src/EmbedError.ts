/**
 * The embed's own failure codes (docs/embed.md, Errors). Codes of the app intake and of the loaders (`UNSUPPORTED_TYPE`,
 * `LOAD_TIMEOUT`, `NOT_BBMODEL`, ...) are passed through unchanged, so an error event's `code` is any string.
 */
export const EMBED_ERROR_CODES = [
  'MISSING_MODEL',
  'INVALID_PARAM',
  'UNSUPPORTED_VERSION',
  'MODEL_URL_INVALID',
  'MODEL_INSECURE',
  'MODEL_CORS_BLOCKED',
  'MODEL_UNREACHABLE',
  'MODEL_HTTP_ERROR',
  'MODEL_TOO_LARGE',
  'MODEL_FETCH_TIMEOUT',
  'SIDECAR_REFUSED',
  'TOO_MANY_SIDECARS',
  'WEBGL2_UNAVAILABLE',
  'SCENE_REJECTED',
] as const;

export type EmbedErrorCode = (typeof EMBED_ERROR_CODES)[number];

export class EmbedError extends Error {
  override readonly name = 'EmbedError';

  constructor(
    readonly code: EmbedErrorCode,
    message: string,
    /** The parameter or attribute at fault (`INVALID_PARAM`, `MODEL_URL_INVALID`). */
    readonly param?: string,
  ) {
    super(message);
  }
}
