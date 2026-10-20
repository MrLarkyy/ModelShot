import { childPath, field, isJsonObject, type JsonObject } from '../bbmodel/JsonFields';
import { quoteValue } from '../bbmodel/quoteValue';
import { GltfError, type GltfErrorCode } from './GltfError';

/**
 * Path-aware readers for the parsed, untrusted glTF JSON; every bad value is a `GltfError` naming its JSON path.
 * Fields are read as own properties only, so `__proto__` or `constructor` keys are inert.
 */
export { childPath, field, isJsonObject, type JsonObject };

function invalid(path: string, expected: string, value: unknown): GltfError {
  return new GltfError('INVALID_FIELD', path, `expected ${expected}, got ${quoteValue(value)}`);
}

export function readObject(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) throw invalid(path, 'an object', value);
  return value;
}

export function readOptionalObject(object: JsonObject, key: string, path: string): JsonObject | undefined {
  const value = field(object, key);
  return value === undefined ? undefined : readObject(value, childPath(path, key));
}

export interface ListLimit {
  readonly max: number;
  readonly code: GltfErrorCode;
  readonly what: string;
}

/** An optional array property, `[]` when absent; its length is checked before any item is read. */
export function readList(object: JsonObject, key: string, path: string, limit: ListLimit): readonly unknown[] {
  const value = field(object, key);
  if (value === undefined) return [];
  const listPath = childPath(path, key);
  if (!Array.isArray(value)) throw invalid(listPath, 'an array', value);
  if (value.length > limit.max) {
    throw new GltfError(limit.code, listPath, `${value.length} ${limit.what}, the limit is ${limit.max}`);
  }
  return value as readonly unknown[];
}

export function readInteger(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(path, `an integer in ${min}..${max}`, value);
  }
  return value;
}

export function readOptionalInteger(
  object: JsonObject,
  key: string,
  path: string,
  range: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  const value = field(object, key);
  return value === undefined ? fallback : readInteger(value, childPath(path, key), range.min, range.max);
}

/** An index into a list of `count` items. */
export function readIndex(value: unknown, path: string, count: number): number {
  if (count === 0) throw invalid(path, 'no reference (the list it points into is empty)', value);
  return readInteger(value, path, 0, count - 1);
}

export function readOptionalIndex(object: JsonObject, key: string, path: string, count: number): number | undefined {
  const value = field(object, key);
  return value === undefined ? undefined : readIndex(value, childPath(path, key), count);
}

export function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(path, 'a finite number', value);
  return value;
}

export function readOptionalNumber(object: JsonObject, key: string, path: string, fallback: number): number {
  const value = field(object, key);
  return value === undefined ? fallback : readNumber(value, childPath(path, key));
}

export function readNumbers(value: unknown, path: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw invalid(path, `an array of ${length} numbers`, value);
  return (value as readonly unknown[]).map((item, index) => readNumber(item, childPath(path, index)));
}

export function readOptionalNumbers(
  object: JsonObject,
  key: string,
  path: string,
  fallback: readonly number[],
): number[] {
  const value = field(object, key);
  return value === undefined ? [...fallback] : readNumbers(value, childPath(path, key), fallback.length);
}

export function readString(value: unknown, path: string, maxChars: number): string {
  if (typeof value !== 'string') throw invalid(path, 'a string', value);
  if (value.length > maxChars) throw invalid(path, `a string of at most ${maxChars} characters`, value);
  return value;
}

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

export function readOptionalBoolean(object: JsonObject, key: string, path: string, fallback: boolean): boolean {
  const value = field(object, key);
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw invalid(childPath(path, key), 'true or false', value);
  return value;
}

/** Items of a list read as objects, in order. */
export function readObjects(list: readonly unknown[], path: string): JsonObject[] {
  return list.map((item, index) => readObject(item, childPath(path, index)));
}
