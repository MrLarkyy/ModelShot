/** Limits checked before anything proportional to them is allocated or decoded. */
export interface BbmodelLimits {
  /** Size of the `.bbmodel` file in UTF-8 bytes. */
  readonly maxFileBytes: number;
  readonly maxElements: number;
  readonly maxGroups: number;
  readonly maxTriangles: number;
  /** Vertices of the loaded geometry (each face has its own), and keys of one mesh's `vertices`. */
  readonly maxVertices: number;
  /** Vertices of one mesh face; larger polygons are triangulated by ear clipping, so this bounds its cost. */
  readonly maxFaceVertices: number;
  /** Groups nested inside each other. */
  readonly maxNesting: number;
  readonly maxTextures: number;
  /** Width or height of a texture in pixels (from the PNG header). */
  readonly maxTextureSide: number;
  readonly maxTexturePixels: number;
  /** Length of a texture `source` string (an embedded data URI). */
  readonly maxDataUriChars: number;
  /** Length of a name, uuid, path or other short string. */
  readonly maxStringChars: number;
  /** Entries of `animations`. */
  readonly maxAnimations: number;
  /** Keyframes of all animations together, counted before any is read. */
  readonly maxKeyframes: number;
}

export const DEFAULT_BBMODEL_LIMITS: BbmodelLimits = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxElements: 10_000,
  maxGroups: 10_000,
  maxTriangles: 200_000,
  maxVertices: 400_000,
  maxFaceVertices: 16,
  maxNesting: 64,
  maxTextures: 64,
  maxTextureSide: 4096,
  maxTexturePixels: 16_777_216,
  maxDataUriChars: 24 * 1024 * 1024,
  maxStringChars: 1024,
  maxAnimations: 1024,
  maxKeyframes: 200_000,
});

export interface BbmodelLoadOptions {
  /** Overrides for some of `DEFAULT_BBMODEL_LIMITS`: positive integers or `Infinity`, else a `RangeError`. */
  readonly limits?: Partial<BbmodelLimits>;
  /**
   * Files the user picked next to the model, keyed by file name. A texture without an embedded image is matched by
   * the case-insensitive base name of its `relative_path`, then `path`, then `name`. Nothing else is ever read.
   */
  readonly textureFiles?: ReadonlyMap<string, Uint8Array>;
}

/**
 * Defaults with the caller's overrides applied. An override must be a positive integer or `Infinity`; anything else
 * is a programming error and throws a `RangeError` (it is not a problem of the model file).
 */
export function resolveBbmodelLimits(overrides: Partial<BbmodelLimits> | undefined): BbmodelLimits {
  const limits: Record<keyof BbmodelLimits, number> = { ...DEFAULT_BBMODEL_LIMITS };
  if (!overrides) return limits;
  for (const key of Object.keys(DEFAULT_BBMODEL_LIMITS) as (keyof BbmodelLimits)[]) {
    const value: unknown = overrides[key];
    if (value === undefined) continue;
    const valid = typeof value === 'number' && value > 0 && (Number.isInteger(value) || value === Infinity);
    if (!valid)
      throw new RangeError(
        `limit ${key} must be a positive integer or Infinity, got ${typeof value === 'number' ? String(value) : typeof value}`,
      );
    limits[key] = value;
  }
  return limits;
}
