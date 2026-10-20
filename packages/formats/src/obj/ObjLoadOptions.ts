import { resolveLimits } from '../limits/resolveLimits';

/** Limits checked before anything proportional to them is allocated or decoded. */
export interface ObjLimits {
  /** Size of the `.obj` file, and of each `.mtl`, in bytes (UTF-8 bytes for text). */
  readonly maxFileBytes: number;
  /** Characters of one logical line (continuation lines joined). */
  readonly maxLineChars: number;
  /** Vertices of one face; larger polygons are triangulated by ear clipping, so this bounds its cost. */
  readonly maxFaceVertices: number;
  readonly maxTriangles: number;
  /** Vertices loaded (after merging equal corners), and `v`, `vt` and `vn` statements each. */
  readonly maxVertices: number;
  /** `o` and `g` statements. */
  readonly maxObjects: number;
  readonly maxMaterials: number;
  readonly maxTextures: number;
  /** Width or height of a texture in pixels (from the PNG header). */
  readonly maxTextureSide: number;
  readonly maxTexturePixels: number;
  /** Length of a name or file reference. */
  readonly maxStringChars: number;
}

export const DEFAULT_OBJ_LIMITS: ObjLimits = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxLineChars: 4096,
  maxFaceVertices: 64,
  maxTriangles: 200_000,
  maxVertices: 400_000,
  maxObjects: 10_000,
  maxMaterials: 256,
  maxTextures: 64,
  maxTextureSide: 4096,
  maxTexturePixels: 16_777_216,
  maxStringChars: 1024,
});

/** 1 OBJ unit = 1 block = 16 scene units, the scale of Blockbench's OBJ export. */
export const DEFAULT_OBJ_UNIT_SCALE = 16;

export interface ObjLoadOptions {
  /** Overrides for some of `DEFAULT_OBJ_LIMITS`: positive integers or `Infinity`, else a `RangeError`. */
  readonly limits?: Partial<ObjLimits>;
  /**
   * Files the user picked next to the `.obj` (`.mtl` libraries, `.png` textures), keyed by file name or relative path;
   * `mtllib` and `map_Kd` are matched by exact relative path, then case-insensitive base name. Nothing else is read.
   */
  readonly files?: ReadonlyMap<string, Uint8Array>;
  /** Name of the `.obj` file, for messages and the object of faces before any `o`/`g`; default `model.obj`. */
  readonly fileName?: string;
  /** Scene units per OBJ unit; a finite positive number, else a `RangeError`. Default `DEFAULT_OBJ_UNIT_SCALE`. */
  readonly unitScale?: number;
}

/** Defaults with the caller's overrides applied; an invalid override throws a `RangeError`. */
export function resolveObjLimits(overrides: Partial<ObjLimits> | undefined): ObjLimits {
  return resolveLimits(DEFAULT_OBJ_LIMITS, overrides);
}
