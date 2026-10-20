import { shortenPath } from '../bbmodel/quoteValue';

export type ObjWarningCode =
  | 'UNSUPPORTED_STATEMENT'
  | 'UNSUPPORTED_VERTEX_COLOR'
  | 'SMOOTHING_IGNORED'
  | 'MISSING_RESOURCE'
  | 'UNKNOWN_MATERIAL'
  | 'UNSUPPORTED_MAP_OPTION'
  | 'UNSUPPORTED_MATERIAL_FEATURE'
  | 'MATERIAL_PARAMS_IGNORED'
  | 'BASE_COLOR_FACTOR_IGNORED'
  | 'UNSUPPORTED_IMAGE';

/** Something the loader cannot represent or resolve; the model still loads without it. */
export interface ObjWarning {
  readonly code: ObjWarningCode;
  readonly path: string;
  readonly message: string;
}

/** A hostile file can trigger many warnings; only the first ones are kept. */
export const MAX_OBJ_WARNINGS = 100;

const TITLES: Readonly<Record<ObjWarningCode, string>> = {
  UNSUPPORTED_STATEMENT: 'Statement ignored',
  UNSUPPORTED_VERTEX_COLOR: 'Vertex colours ignored',
  SMOOTHING_IGNORED: 'Smoothing groups ignored (flat normals)',
  MISSING_RESOURCE: 'Missing file',
  UNKNOWN_MATERIAL: 'Unknown material',
  UNSUPPORTED_MAP_OPTION: 'Texture map options ignored',
  UNSUPPORTED_MATERIAL_FEATURE: 'Material maps ignored',
  MATERIAL_PARAMS_IGNORED: 'Material parameters ignored',
  BASE_COLOR_FACTOR_IGNORED: 'Diffuse colour ignored',
  UNSUPPORTED_IMAGE: 'Image not usable',
};

export class ObjWarningList {
  readonly items: ObjWarning[] = [];

  add(code: ObjWarningCode, path: string, detail: string): void {
    if (this.items.length >= MAX_OBJ_WARNINGS) return;
    this.items.push({ code, path, message: `${TITLES[code]} at ${shortenPath(path)}: ${detail}` });
  }
}
