/** Limits checked before anything proportional to them is allocated or decoded. */
export interface BbmodelLimits {
  /** Size of the `.bbmodel` file in UTF-8 bytes. */
  readonly maxFileBytes: number;
  readonly maxElements: number;
  readonly maxGroups: number;
  readonly maxTriangles: number;
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
}

export const DEFAULT_BBMODEL_LIMITS: BbmodelLimits = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxElements: 10_000,
  maxGroups: 10_000,
  maxTriangles: 200_000,
  maxNesting: 64,
  maxTextures: 64,
  maxTextureSide: 4096,
  maxTexturePixels: 16_777_216,
  maxDataUriChars: 24 * 1024 * 1024,
  maxStringChars: 1024,
});

export interface BbmodelLoadOptions {
  /** Overrides for some of `DEFAULT_BBMODEL_LIMITS`. */
  readonly limits?: Partial<BbmodelLimits>;
  /**
   * Files the user picked next to the model, keyed by file name. A texture without an embedded image is matched by
   * the case-insensitive base name of its `relative_path`, then `path`, then `name`. Nothing else is ever read.
   */
  readonly textureFiles?: ReadonlyMap<string, Uint8Array>;
}

export function resolveBbmodelLimits(overrides: Partial<BbmodelLimits> | undefined): BbmodelLimits {
  const limits: Record<keyof BbmodelLimits, number> = { ...DEFAULT_BBMODEL_LIMITS };
  if (!overrides) return limits;
  for (const key of Object.keys(DEFAULT_BBMODEL_LIMITS) as (keyof BbmodelLimits)[]) {
    const value = overrides[key];
    if (typeof value === 'number') limits[key] = value;
  }
  return limits;
}
