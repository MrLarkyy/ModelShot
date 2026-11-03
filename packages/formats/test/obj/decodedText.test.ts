import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OBJ_LIMITS,
  ObjError,
  decodeObjText,
  listObjReferences,
  loadObj,
  type DecodedObjText,
} from '../../src/index';
import { shapesFiles, shapesObj } from './fixtures';

const MAX_BYTES = DEFAULT_OBJ_LIMITS.maxFileBytes;
const MAX = { maxReferences: 31 };
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const TRIANGLE = 'mtllib shapes.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';

function failure(run: () => unknown): ObjError {
  try {
    run();
  } catch (error) {
    if (error instanceof ObjError) return error;
    throw error;
  }
  throw new Error('expected an ObjError');
}

function withBytes(prefix: number[], text: string): Uint8Array {
  return new Uint8Array([...prefix, ...encode(text)]);
}

describe('an .obj decoded once by decodeObjText', () => {
  it.each([
    ['the shapes fixture', encode(shapesObj)],
    ['a file with a byte-order mark', withBytes([0xef, 0xbb, 0xbf], TRIANGLE)],
    ['a file with two byte-order marks', withBytes([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], TRIANGLE)],
    ['a file with invalid UTF-8 in a comment', withBytes([0x23, 0xff, 0xfe, 0x0a], TRIANGLE)],
  ])('loads and lists %s as its bytes do', (_what, bytes) => {
    const options = { files: shapesFiles(), fileName: 'model.obj' };
    const decoded = decodeObjText(bytes, 'model.obj', MAX_BYTES);
    expect(loadObj(decoded, options)).toEqual(loadObj(bytes, options));
    expect(listObjReferences(decoded, MAX)).toEqual(listObjReferences(bytes, MAX));
  });

  it("checks the file's size, not the decoded text's: replaced bytes count once", () => {
    const bytes = withBytes([0x23, ...Array<number>(60).fill(0xff), 0x0a], TRIANGLE);
    const limits = { maxFileBytes: bytes.byteLength };
    const decoded = decodeObjText(bytes, 'model.obj', MAX_BYTES);
    expect(decoded.byteLength).toBe(bytes.byteLength);
    expect(loadObj(decoded, { limits })).toEqual(loadObj(bytes, { limits }));
    const over = { maxFileBytes: bytes.byteLength - 1 };
    const fromDecoded = failure(() => loadObj(decoded, { limits: over }));
    const fromBytes = failure(() => loadObj(bytes, { limits: over }));
    expect([fromDecoded.code, fromDecoded.message]).toEqual([fromBytes.code, fromBytes.message]);
    expect(fromDecoded.code).toBe('FILE_TOO_LARGE');
  });

  it('refuses a file over the limit when decoding, with the error loading it gives', () => {
    const bytes = encode(TRIANGLE);
    const decoding = failure(() => decodeObjText(bytes, 'a.obj', 8));
    const loading = failure(() => loadObj(bytes, { fileName: 'a.obj', limits: { maxFileBytes: 8 } }));
    expect([decoding.code, decoding.path, decoding.message]).toEqual([loading.code, loading.path, loading.message]);
  });

  it('takes no look-alike object as decoded text', () => {
    const copy: DecodedObjText = { ...decodeObjText(encode(TRIANGLE), 'model.obj', MAX_BYTES) };
    expect(failure(() => loadObj(copy)).code).toBe('INVALID_STATEMENT');
    expect(listObjReferences(copy, MAX)).toEqual([]);
  });
});
