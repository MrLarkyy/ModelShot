import { resolveLimits } from '../limits/resolveLimits';

/** Limits checked before anything proportional to them is allocated or decoded. */
export interface GltfLimits {
  /** Size of the `.gltf` or `.glb` file in bytes (UTF-8 bytes for text). */
  readonly maxFileBytes: number;
  readonly maxNodes: number;
  readonly maxMeshes: number;
  /** Primitives of all meshes together. */
  readonly maxPrimitives: number;
  /** Accessors, and separately buffer views. */
  readonly maxAccessors: number;
  readonly maxBuffers: number;
  readonly maxMaterials: number;
  /** Textures, and separately images and samplers. */
  readonly maxTextures: number;
  /** Triangles drawn, every instance of a mesh counted. */
  readonly maxTriangles: number;
  /** Vertices loaded, every instance counted, primitives without normals counted de-indexed (3 per triangle). */
  readonly maxVertices: number;
  /** Depth of the node hierarchy. */
  readonly maxNesting: number;
  /** Width or height of a texture in pixels (from the PNG header). */
  readonly maxTextureSide: number;
  readonly maxTexturePixels: number;
  /** Length of a `data:` URI of a buffer or image. */
  readonly maxDataUriChars: number;
  /** Length of a name, URI or other short string. */
  readonly maxStringChars: number;
}

export const DEFAULT_GLTF_LIMITS: GltfLimits = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxNodes: 10_000,
  maxMeshes: 10_000,
  maxPrimitives: 10_000,
  maxAccessors: 50_000,
  maxBuffers: 256,
  maxMaterials: 256,
  maxTextures: 64,
  maxTriangles: 200_000,
  maxVertices: 400_000,
  maxNesting: 64,
  maxTextureSide: 4096,
  maxTexturePixels: 16_777_216,
  maxDataUriChars: 64 * 1024 * 1024,
  maxStringChars: 1024,
});

/** 1 glTF unit (a metre) = 1 block = 16 scene units, the scale of Blockbench's glTF export. */
export const DEFAULT_GLTF_UNIT_SCALE = 16;

export interface GltfLoadOptions {
  /** Overrides for some of `DEFAULT_GLTF_LIMITS`: positive integers or `Infinity`, else a `RangeError`. */
  readonly limits?: Partial<GltfLimits>;
  /**
   * Files the user picked next to a `.gltf` (`.bin` buffers, `.png` images), keyed by file name or relative path. A
   * `uri` is matched by its exact relative path, then by its case-insensitive base name. Nothing else is ever read,
   * and no URL is fetched.
   */
  readonly files?: ReadonlyMap<string, Uint8Array>;
  /** Scene units per glTF unit; a finite positive number, else a `RangeError`. Default `DEFAULT_GLTF_UNIT_SCALE`. */
  readonly unitScale?: number;
}

/**
 * Defaults with the caller's overrides applied. An override must be a positive integer or `Infinity`; anything else
 * is a programming error and throws a `RangeError` (it is not a problem of the model file).
 */
export function resolveGltfLimits(overrides: Partial<GltfLimits> | undefined): GltfLimits {
  return resolveLimits(DEFAULT_GLTF_LIMITS, overrides);
}
