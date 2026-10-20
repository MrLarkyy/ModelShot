/**
 * A parsed, untrusted JSON object and the format-neutral ways to look into it. Fields are read as own properties
 * only, so `__proto__` or `constructor` keys in a file are inert; values are only read, never spread into our objects.
 */
export type JsonObject = { readonly [key: string]: unknown };

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function field(object: JsonObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** `$.a` + `b` -> `$.a.b`; `$.a` + 3 -> `$.a[3]`. */
export function childPath(path: string, key: string | number): string {
  return typeof key === 'number' ? `${path}[${key}]` : `${path}.${key}`;
}
