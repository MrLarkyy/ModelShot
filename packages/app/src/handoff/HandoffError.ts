export type HandoffErrorCode = 'EMPTY' | 'TOO_MANY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE';

export class HandoffError extends Error {
  override readonly name = 'HandoffError';

  constructor(
    readonly code: HandoffErrorCode,
    message: string,
  ) {
    super(message);
  }
}
