import { shortenPath } from '../text/quoteValue';

export type GltfWarningCode =
  | 'UNSUPPORTED_SKIN'
  | 'UNSUPPORTED_MORPH_TARGETS'
  | 'UNSUPPORTED_ANIMATION'
  | 'UNSUPPORTED_CAMERA'
  | 'UNSUPPORTED_EXTENSION'
  | 'UNSUPPORTED_MATERIAL_FEATURE'
  | 'UNSUPPORTED_ATTRIBUTE'
  | 'UNSUPPORTED_PRIMITIVE_MODE'
  | 'EMPTY_PRIMITIVE'
  | 'UNSUPPORTED_SPARSE_ACCESSOR'
  | 'UNSUPPORTED_IMAGE'
  | 'EXTRA_SCENES_IGNORED'
  | 'NO_SCENE'
  /** A sampler asks magFilter NEAREST with a linear-family minFilter; the texture is drawn nearest (MS-38). */
  | 'TEXTURE_FILTER_NEAREST'
  | 'UV_WRAP_CLAMPED'
  | 'BASE_COLOR_FACTOR_IGNORED'
  | 'MISSING_RESOURCE'
  | 'MISSING_TEXCOORD'
  | 'INVALID_TRANSFORM'
  | 'DEGENERATE_TRANSFORM';

/** Something the loader cannot represent or resolve; the model still loads without it. */
export interface GltfWarning {
  readonly code: GltfWarningCode;
  readonly path: string;
  readonly message: string;
}

/** A hostile file can trigger a warning per primitive; only the first ones are kept. */
export const MAX_GLTF_WARNINGS = 100;

const TITLES: Readonly<Record<GltfWarningCode, string>> = {
  UNSUPPORTED_SKIN: 'Skin ignored (drawn unskinned)',
  UNSUPPORTED_MORPH_TARGETS: 'Morph targets ignored (base geometry drawn)',
  UNSUPPORTED_ANIMATION: 'Animations ignored',
  UNSUPPORTED_CAMERA: 'Cameras ignored',
  UNSUPPORTED_EXTENSION: 'Extension ignored',
  UNSUPPORTED_MATERIAL_FEATURE: 'Material features ignored',
  UNSUPPORTED_ATTRIBUTE: 'Attribute ignored',
  UNSUPPORTED_PRIMITIVE_MODE: 'Primitive skipped',
  EMPTY_PRIMITIVE: 'Empty primitive skipped',
  UNSUPPORTED_SPARSE_ACCESSOR: 'Primitive with a sparse accessor skipped',
  UNSUPPORTED_IMAGE: 'Image not usable',
  EXTRA_SCENES_IGNORED: 'Other scenes ignored',
  NO_SCENE: 'No scene',
  TEXTURE_FILTER_NEAREST: 'Texture drawn with nearest filtering',
  UV_WRAP_CLAMPED: 'Texture wrapping clamped',
  BASE_COLOR_FACTOR_IGNORED: 'Base colour factor ignored',
  MISSING_RESOURCE: 'Missing file',
  MISSING_TEXCOORD: 'Missing texture coordinates',
  INVALID_TRANSFORM: 'Invalid transform',
  DEGENERATE_TRANSFORM: 'Node with a degenerate transform skipped',
};

export class GltfWarningList {
  readonly items: GltfWarning[] = [];

  add(code: GltfWarningCode, path: string, detail: string): void {
    if (this.items.length >= MAX_GLTF_WARNINGS) return;
    this.items.push({ code, path, message: `${TITLES[code]} at ${shortenPath(path)}: ${detail}` });
  }
}
