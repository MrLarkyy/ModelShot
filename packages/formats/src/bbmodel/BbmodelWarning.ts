import { shortenPath } from './quoteValue';

export type BbmodelWarningCode =
  'UNSUPPORTED_ELEMENT' | 'UNSUPPORTED_VALUE' | 'MISSING_TEXTURE' | 'UNKNOWN_REFERENCE' | 'SOURCE_NOT_FETCHED';

/** Something the loader skipped or could not resolve; the model still loads. */
export interface BbmodelWarning {
  readonly code: BbmodelWarningCode;
  readonly path: string;
  readonly message: string;
}

/** A hostile file can trigger a warning per element; only the first ones are kept. */
export const MAX_BBMODEL_WARNINGS = 100;

const TITLES: Readonly<Record<BbmodelWarningCode, string>> = {
  UNSUPPORTED_ELEMENT: 'Unsupported element skipped',
  UNSUPPORTED_VALUE: 'Unsupported value ignored',
  MISSING_TEXTURE: 'Missing texture',
  UNKNOWN_REFERENCE: 'Unknown reference skipped',
  SOURCE_NOT_FETCHED: 'Texture source not fetched',
};

export class BbmodelWarningList {
  readonly items: BbmodelWarning[] = [];

  add(code: BbmodelWarningCode, path: string, detail: string): void {
    if (this.items.length >= MAX_BBMODEL_WARNINGS) return;
    this.items.push({ code, path, message: `${TITLES[code]} at ${shortenPath(path)}: ${detail}` });
  }
}
