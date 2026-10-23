/**
 * Why files could not be opened. `code` is one of the app's own (`MULTIPLE_MODELS`, `NO_MODEL`, `LOAD_TIMEOUT`,
 * `LOAD_FAILED`), a handoff limit code (`EMPTY`, `TOO_MANY`, `TOO_LARGE`, `UNSUPPORTED_TYPE`) or the code of the loader
 * that refused the file (`NOT_BBMODEL`, `FILE_TOO_LARGE`, ...).
 */
export class IntakeError extends Error {
  override readonly name = 'IntakeError';

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
