/** Limits `loadSkin` checks before it copies anything. */
export interface SkinLimits {
  /** Size of the PNG file in bytes. */
  readonly maxFileBytes: number;
  /** Largest image width in pixels; a skin is 64 · 2^k wide (HD skins up to this side). */
  readonly maxSide: number;
}

export const DEFAULT_SKIN_LIMITS: SkinLimits = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxSide: 1024,
});

/**
 * Defaults with the caller's overrides applied. An override must be a positive integer (`maxSide` at least 64);
 * anything else is a programming error and throws a `RangeError`.
 */
export function resolveSkinLimits(overrides: Partial<SkinLimits> | undefined): SkinLimits {
  const limits: Record<keyof SkinLimits, number> = { ...DEFAULT_SKIN_LIMITS };
  if (!overrides) return limits;
  for (const key of Object.keys(DEFAULT_SKIN_LIMITS) as (keyof SkinLimits)[]) {
    const value: unknown = overrides[key];
    if (value === undefined) continue;
    const min = key === 'maxSide' ? 64 : 1;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      throw new RangeError(`limits.${key} must be an integer of at least ${min}`);
    }
    limits[key] = value;
  }
  return limits;
}
