import type { Vec3 } from './Vec3';

/** Longest name accepted in poses and attachments. */
export const MAX_NAME_CHARS = 1024;

/** A string of at most `MAX_NAME_CHARS` characters, else a `RangeError` naming `path`. */
export function checkName(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > MAX_NAME_CHARS) {
    throw new RangeError(`${path}: expected a string of at most ${MAX_NAME_CHARS} characters`);
  }
  return value;
}

/** Three finite numbers with |v| ≤ `maxAbs`, else a `RangeError` naming the offending element's path. */
export function checkVec3(value: unknown, path: string, maxAbs: number): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new RangeError(`${path}: expected three numbers`);
  // An index loop, not forEach: forEach skips the holes of a sparse array such as [0, , 0].
  const items: number[] = [];
  for (let i = 0; i < 3; i++) {
    const item: unknown = (value as unknown[])[i];
    if (typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > maxAbs) {
      throw new RangeError(`${path}[${i}]: expected a finite number with |v| ≤ ${maxAbs}`);
    }
    items.push(item);
  }
  return [items[0] ?? 0, items[1] ?? 0, items[2] ?? 0];
}
