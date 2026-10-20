import { shortenPath } from '../text/quoteValue';

export type GltfErrorCode =
  | 'FILE_TOO_LARGE'
  | 'NOT_GLB'
  | 'NOT_JSON'
  | 'NOT_GLTF'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_FIELD'
  | 'UNSUPPORTED_REQUIRED_EXTENSION'
  | 'MISSING_BUFFER'
  | 'ACCESSOR_OUT_OF_BOUNDS'
  | 'INDEX_OUT_OF_RANGE'
  | 'NODE_GRAPH_INVALID'
  | 'NESTING_TOO_DEEP'
  | 'TOO_MANY_NODES'
  | 'TOO_MANY_MESHES'
  | 'TOO_MANY_PRIMITIVES'
  | 'TOO_MANY_ACCESSORS'
  | 'TOO_MANY_BUFFERS'
  | 'TOO_MANY_MATERIALS'
  | 'TOO_MANY_TEXTURES'
  | 'TOO_MANY_TRIANGLES'
  | 'TOO_MANY_VERTICES'
  | 'TEXTURE_TOO_LARGE'
  | 'NON_FINITE_DATA';

const TITLES: Readonly<Record<GltfErrorCode, string>> = {
  FILE_TOO_LARGE: 'File too large',
  NOT_GLB: 'Broken GLB container',
  NOT_JSON: 'Not JSON',
  NOT_GLTF: 'Not a glTF model',
  UNSUPPORTED_VERSION: 'Unsupported glTF version',
  INVALID_FIELD: 'Invalid field',
  UNSUPPORTED_REQUIRED_EXTENSION: 'Required extension not supported',
  MISSING_BUFFER: 'Missing buffer',
  ACCESSOR_OUT_OF_BOUNDS: 'Accessor out of bounds',
  INDEX_OUT_OF_RANGE: 'Index out of range',
  NODE_GRAPH_INVALID: 'Invalid node hierarchy',
  NESTING_TOO_DEEP: 'Nesting too deep',
  TOO_MANY_NODES: 'Too many nodes',
  TOO_MANY_MESHES: 'Too many meshes',
  TOO_MANY_PRIMITIVES: 'Too many primitives',
  TOO_MANY_ACCESSORS: 'Too many accessors',
  TOO_MANY_BUFFERS: 'Too many buffers',
  TOO_MANY_MATERIALS: 'Too many materials',
  TOO_MANY_TEXTURES: 'Too many textures',
  TOO_MANY_TRIANGLES: 'Too many triangles',
  TOO_MANY_VERTICES: 'Too many vertices',
  TEXTURE_TOO_LARGE: 'Texture too large',
  NON_FINITE_DATA: 'Non-finite number',
};

/**
 * The only error `loadGltf` throws. `path` is a JSON path into the glTF document (`$.accessors[3].count`), or into the
 * GLB container (`glb[12]`, a byte offset); the message reads `<what> at <path>: <detail>` and quotes at most 32
 * characters of file content.
 */
export class GltfError extends Error {
  override readonly name = 'GltfError';
  readonly code: GltfErrorCode;
  readonly path: string;

  constructor(code: GltfErrorCode, path: string, detail: string) {
    super(`${TITLES[code]} at ${shortenPath(path)}: ${detail}`);
    this.code = code;
    this.path = path;
  }
}
