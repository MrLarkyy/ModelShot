import { shortenPath } from '../bbmodel/quoteValue';

export type ObjErrorCode =
  | 'FILE_TOO_LARGE'
  | 'LINE_TOO_LONG'
  | 'INVALID_STATEMENT'
  | 'INDEX_OUT_OF_RANGE'
  | 'NON_FINITE_DATA'
  | 'TOO_MANY_FACE_VERTICES'
  | 'TOO_MANY_TRIANGLES'
  | 'TOO_MANY_VERTICES'
  | 'TOO_MANY_OBJECTS'
  | 'TOO_MANY_MATERIALS'
  | 'TOO_MANY_TEXTURES'
  | 'TEXTURE_TOO_LARGE';

const TITLES: Readonly<Record<ObjErrorCode, string>> = {
  FILE_TOO_LARGE: 'File too large',
  LINE_TOO_LONG: 'Line too long',
  INVALID_STATEMENT: 'Invalid statement',
  INDEX_OUT_OF_RANGE: 'Index out of range',
  NON_FINITE_DATA: 'Non-finite number',
  TOO_MANY_FACE_VERTICES: 'Too many face vertices',
  TOO_MANY_TRIANGLES: 'Too many triangles',
  TOO_MANY_VERTICES: 'Too many vertices',
  TOO_MANY_OBJECTS: 'Too many objects',
  TOO_MANY_MATERIALS: 'Too many materials',
  TOO_MANY_TEXTURES: 'Too many textures',
  TEXTURE_TOO_LARGE: 'Texture too large',
};

/**
 * The only error `loadObj` throws. `path` is `<file>:<line>` (`model.obj:12`, `model.mtl:3`), or the file name alone
 * for the whole file; the message reads `<what> at <path>: <detail>` and quotes at most 32 characters of file content.
 */
export class ObjError extends Error {
  override readonly name = 'ObjError';
  readonly code: ObjErrorCode;
  readonly path: string;

  constructor(code: ObjErrorCode, path: string, detail: string) {
    super(`${TITLES[code]} at ${shortenPath(path)}: ${detail}`);
    this.code = code;
    this.path = path;
  }
}
