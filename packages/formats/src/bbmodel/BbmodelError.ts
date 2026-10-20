import { shortenPath } from '../text/quoteValue';

export type BbmodelErrorCode =
  | 'FILE_TOO_LARGE'
  | 'NOT_JSON'
  | 'NOT_BBMODEL'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_FIELD'
  | 'TOO_MANY_ELEMENTS'
  | 'TOO_MANY_TRIANGLES'
  | 'TOO_MANY_VERTICES'
  | 'TOO_MANY_TEXTURES'
  | 'NESTING_TOO_DEEP'
  | 'DUPLICATE_REFERENCE'
  | 'TEXTURE_TOO_LARGE'
  | 'BAD_TEXTURE';

const TITLES: Readonly<Record<BbmodelErrorCode, string>> = {
  FILE_TOO_LARGE: 'File too large',
  NOT_JSON: 'Not JSON',
  NOT_BBMODEL: 'Not a Blockbench model',
  UNSUPPORTED_VERSION: 'Unsupported format version',
  INVALID_FIELD: 'Invalid field',
  TOO_MANY_ELEMENTS: 'Too many elements',
  TOO_MANY_TRIANGLES: 'Too many triangles',
  TOO_MANY_VERTICES: 'Too many vertices',
  TOO_MANY_TEXTURES: 'Too many textures',
  NESTING_TOO_DEEP: 'Nesting too deep',
  DUPLICATE_REFERENCE: 'Duplicate reference',
  TEXTURE_TOO_LARGE: 'Texture too large',
  BAD_TEXTURE: 'Bad texture',
};

/**
 * The only error `loadBbmodel` throws. `path` is a JSON path into the file (`$.elements[3].from[1]`); the message
 * reads `<what> at <path>: <expected>` and quotes at most 32 characters of file content.
 */
export class BbmodelError extends Error {
  override readonly name = 'BbmodelError';
  readonly code: BbmodelErrorCode;
  readonly path: string;

  constructor(code: BbmodelErrorCode, path: string, detail: string) {
    super(`${TITLES[code]} at ${shortenPath(path)}: ${detail}`);
    this.code = code;
    this.path = path;
  }
}
