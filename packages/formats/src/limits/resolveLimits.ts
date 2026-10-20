/** `unitScale` or the default; throws a `RangeError` for anything but a finite positive number. */
export function resolveUnitScale(unitScale: number | undefined, fallback: number): number {
  if (unitScale === undefined) return fallback;
  if (typeof unitScale !== 'number' || !Number.isFinite(unitScale) || unitScale <= 0) {
    throw new RangeError(`unitScale must be a finite positive number, got ${String(unitScale)}`);
  }
  return unitScale;
}

/**
 * `defaults` with the caller's overrides applied; each override a positive integer or `Infinity`, else a `RangeError`.
 * Shared by the glTF and OBJ loaders.
 */
export function resolveLimits<T extends object>(defaults: T, overrides: Partial<T> | undefined): T {
  const limits = { ...defaults } as Record<keyof T, number>;
  if (!overrides) return limits as T;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value: unknown = overrides[key];
    if (value === undefined) continue;
    const valid = typeof value === 'number' && value > 0 && (Number.isInteger(value) || value === Infinity);
    if (!valid) {
      throw new RangeError(
        `limit ${String(key)} must be a positive integer or Infinity, got ${typeof value === 'number' ? String(value) : typeof value}`,
      );
    }
    limits[key] = value;
  }
  return limits as T;
}
