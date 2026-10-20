import type { Vec3 } from '@modelshot/scene';
import { BbmodelError, type BbmodelErrorCode } from './BbmodelError';
import { childPath, field, isJsonObject, type JsonObject } from '../json/JsonObject';
import { quoteValue } from '../text/quoteValue';

/**
 * Path-aware readers for parsed, untrusted Blockbench JSON; every bad value is a `BbmodelError` naming its JSON path.
 * The format-neutral helpers (`JsonObject`, `isJsonObject`, `field`, `childPath`) come from `json/JsonObject.ts` and
 * are re-exported for the Blockbench modules.
 */
export { childPath, field, isJsonObject, type JsonObject };

/** Coordinates beyond this are rejected: they would overflow Float32 maths or hide an Infinity. */
export const MAX_ABS_NUMBER = 1e7;

function invalid(path: string, expected: string, value: unknown): BbmodelError {
  return new BbmodelError('INVALID_FIELD', path, `expected ${expected}, got ${quoteValue(value)}`);
}

export function readObject(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) throw invalid(path, 'an object', value);
  return value;
}

export interface ArrayLimit {
  readonly max: number;
  readonly code: BbmodelErrorCode;
  readonly what: string;
}

export function readArray(value: unknown, path: string, limit: ArrayLimit): readonly unknown[] {
  if (!Array.isArray(value)) throw invalid(path, 'an array', value);
  if (value.length > limit.max) {
    throw new BbmodelError(limit.code, path, `${value.length} ${limit.what}, the limit is ${limit.max}`);
  }
  return value as readonly unknown[];
}

export function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_ABS_NUMBER) {
    throw invalid(path, `a finite number within ±${MAX_ABS_NUMBER}`, value);
  }
  return value;
}

export function readPositiveNumber(value: unknown, path: string): number {
  const number = readFiniteNumber(value, path);
  if (number <= 0) throw invalid(path, 'a positive number', value);
  return number;
}

export function readNumbers(value: unknown, path: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw invalid(path, `an array of ${length} numbers`, value);
  return (value as readonly unknown[]).map((item, index) => readFiniteNumber(item, childPath(path, index)));
}

export function readVec3(value: unknown, path: string): Vec3 {
  const [x = 0, y = 0, z = 0] = readNumbers(value, path, 3);
  return [x, y, z];
}

export function readString(value: unknown, path: string, maxChars: number): string {
  if (typeof value !== 'string') throw invalid(path, 'a string', value);
  if (value.length > maxChars) throw invalid(path, `a string of at most ${maxChars} characters`, value);
  return value;
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw invalid(path, 'true or false', value);
  return value;
}

/** Each optional reader returns `fallback` when the key is absent (an explicit `null` is still invalid). */
export function readOptionalString(
  object: JsonObject,
  key: string,
  path: string,
  maxChars: number,
  fallback: string,
): string {
  const value = field(object, key);
  return value === undefined ? fallback : readString(value, childPath(path, key), maxChars);
}

export function readOptionalNumber(object: JsonObject, key: string, path: string, fallback: number): number {
  const value = field(object, key);
  return value === undefined ? fallback : readFiniteNumber(value, childPath(path, key));
}

export function readOptionalVec3(object: JsonObject, key: string, path: string, fallback: Vec3): Vec3 {
  const value = field(object, key);
  return value === undefined ? fallback : readVec3(value, childPath(path, key));
}

export function readOptionalBoolean(object: JsonObject, key: string, path: string, fallback: boolean): boolean {
  const value = field(object, key);
  return value === undefined ? fallback : readBoolean(value, childPath(path, key));
}
