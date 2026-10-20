import { expect } from 'vitest';
import { GltfError, loadGltf, type GltfErrorCode, type GltfLoadOptions } from '../../src/index';

export function gltfFailure(input: string | Uint8Array, options?: GltfLoadOptions): GltfError {
  try {
    loadGltf(input, options);
  } catch (error) {
    if (error instanceof GltfError) return error;
    throw new Error(`expected a GltfError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected loading to fail');
}

/** Code and path as expected, a short message, and no run of file content longer than 32 characters in it. */
export function expectGltfError(
  input: string | Uint8Array,
  code: GltfErrorCode,
  path: string,
  options?: GltfLoadOptions,
): GltfError {
  const error = gltfFailure(input, options);
  expect({ code: error.code, path: error.path }).toEqual({ code, path });
  expect(error.message.length).toBeLessThan(220);
  expect(error.message).not.toMatch(/A{33}/);
  return error;
}

export const json = (value: unknown): string => JSON.stringify(value);
