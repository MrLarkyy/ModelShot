import { expect } from 'vitest';
import shapesMtl from '../fixtures/obj/shapes.mtl?raw';
import shapesObj from '../fixtures/obj/shapes.obj?raw';
import shapesPngUri from '../fixtures/obj/shapes.png?inline';
import { loadObj, ObjError, type ObjErrorCode, type ObjLoadOptions } from '../../src/index';
import { fromBase64 } from '../gltf/gltfBuilder';

export { shapesObj };

/** The files a user picks next to `shapes.obj`. */
export function shapesFiles(): Map<string, Uint8Array> {
  return new Map([
    ['shapes.mtl', new TextEncoder().encode(shapesMtl)],
    ['shapes.png', fromBase64(shapesPngUri.slice(shapesPngUri.indexOf(',') + 1))],
  ]);
}

export function objFailure(input: string | Uint8Array, options?: ObjLoadOptions): ObjError {
  try {
    loadObj(input, options);
  } catch (error) {
    if (error instanceof ObjError) return error;
    throw new Error(`expected an ObjError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected loading to fail');
}

/** Code and path as expected, a short message, and no run of file content longer than 32 characters in it. */
export function expectObjError(
  input: string | Uint8Array,
  code: ObjErrorCode,
  path: string,
  options?: ObjLoadOptions,
): ObjError {
  const error = objFailure(input, options);
  expect({ code: error.code, path: error.path }).toEqual({ code, path });
  expect(error.message.length).toBeLessThan(220);
  expect(error.message).not.toMatch(/A{33}/);
  return error;
}

/** A unit quad in the XY plane facing +Z, with vt and vn. */
export const QUAD = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vn 0 0 1'];
export const QUAD_FACE = 'f 1/1/1 2/2/1 3/3/1 4/4/1';
export const lines = (...items: string[]): string => items.join('\n');
