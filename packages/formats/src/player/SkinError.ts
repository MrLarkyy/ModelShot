export type SkinErrorCode = 'FILE_TOO_LARGE' | 'NOT_PNG' | 'TRUNCATED' | 'BAD_SIZE' | 'INVALID_NAME';

const TITLES: Readonly<Record<SkinErrorCode, string>> = {
  FILE_TOO_LARGE: 'Skin file too large',
  NOT_PNG: 'Skin is not a PNG',
  TRUNCATED: 'Skin file truncated',
  BAD_SIZE: 'Unsupported skin size',
  INVALID_NAME: 'Invalid skin name',
};

/** The only error `loadSkin` throws for a bad file. The message names the limit or rule, never file content. */
export class SkinError extends Error {
  override readonly name = 'SkinError';
  readonly code: SkinErrorCode;

  constructor(code: SkinErrorCode, detail: string) {
    super(`${TITLES[code]}: ${detail}`);
    this.code = code;
  }
}
