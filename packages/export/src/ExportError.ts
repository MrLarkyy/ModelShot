export type ExportErrorCode =
  /** An option of the wrong type, not finite, not an integer, out of range or not one of its values. */
  | 'INVALID_OPTION'
  /** A size, frame count, duration or byte count over its limit (`exportLimits`), or what this GPU can render. */
  | 'LIMIT_EXCEEDED'
  /** The signal aborted. */
  | 'CANCELLED'
  /** The WebGL context was lost during the export; nothing is encoded from it. */
  | 'CONTEXT_LOST'
  /** The browser's encoder failed or produced something unusable. */
  | 'ENCODER_FAILED'
  /** No format of the requested one's fallback chain can be encoded here. */
  | 'UNSUPPORTED_FORMAT';

/** Why an export failed; `field` names the option at fault (`width`, `camera.near`, `scene.shadowCatcher`). */
export class ExportError extends Error {
  override readonly name = 'ExportError';

  constructor(
    readonly code: ExportErrorCode,
    message: string,
    readonly field?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
