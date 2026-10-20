import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SKIN_LIMITS, loadSkin, SkinError, type SkinErrorCode, type SkinLoadOptions } from '../../src/index';
import { pngHeader } from '../bbmodel/fixtures';
import { skinBytes } from './skins';

function failure(bytes: Uint8Array, options?: SkinLoadOptions): SkinError {
  try {
    loadSkin(bytes, options);
  } catch (error) {
    if (error instanceof SkinError) return error;
    throw new Error(`expected a SkinError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected loading to fail');
}

/** A PNG header claiming `width` × `height` followed by `extra` bytes of garbage. */
function headerOver(width: number, height: number, extra: number): Uint8Array {
  const bytes = new Uint8Array(33 + extra).map((_, i) => (i * 97) & 255);
  bytes.set(pngHeader(width, height));
  return bytes;
}

describe('loadSkin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [64, 64, 'modern', 64],
    [64, 32, 'legacy', 32],
    [128, 128, 'modern', 64],
    [128, 64, 'legacy', 32],
    [1024, 1024, 'modern', 64],
  ] as const)('accepts %i x %i as %s with UV height %i', (width, height, layout, uvHeight) => {
    const { texture, layout: loaded } = loadSkin(headerOver(width, height, 0));
    expect(loaded).toBe(layout);
    expect(texture).toMatchObject({ width, height, uvWidth: 64, uvHeight, mimeType: 'image/png', missing: false });
    expect(texture.name).toBe('skin');
  });

  it('loads the generated skins', () => {
    expect(loadSkin(skinBytes('classic')).layout).toBe('modern');
    expect(loadSkin(skinBytes('slim')).layout).toBe('modern');
    expect(loadSkin(skinBytes('legacy'), { name: 'old.png' }).texture).toMatchObject({
      name: 'old.png',
      width: 64,
      height: 32,
      uvHeight: 32,
    });
  });

  it('returns a copy of the bytes', () => {
    const bytes = skinBytes('classic');
    const { texture } = loadSkin(bytes);
    expect(texture.bytes).toEqual(bytes);
    expect(texture.bytes).not.toBe(bytes);
    bytes[40] = (bytes[40] ?? 0) ^ 0xff;
    expect(texture.bytes?.[40]).not.toBe(bytes[40]);
  });

  it('returns a copy for a Buffer-like input whose slice is a view', () => {
    // Node's Buffer overrides slice to return a view of the same memory; this subclass does the same.
    class ViewSlice extends Uint8Array {
      override slice(start?: number, end?: number): Uint8Array<ArrayBuffer> {
        return this.subarray(start, end);
      }
    }
    const input = new ViewSlice(skinBytes('classic'));
    const { texture } = loadSkin(input);
    const before = texture.bytes?.[40];
    input[40] = (input[40] ?? 0) ^ 0xff;
    expect(texture.bytes?.[40]).toBe(before);
    expect(texture.bytes?.buffer).not.toBe(input.buffer);
  });

  it('accepts a valid header over undecodable data (pixels are never decoded here)', () => {
    expect(loadSkin(headerOver(64, 64, 500)).texture.bytes).toHaveLength(533);
  });

  it.each([
    ['64x48', 64, 48],
    ['63x64', 63, 64],
    ['96x96 (not a power of two)', 96, 96],
    ['32x32', 32, 32],
    ['2048x2048 header (over maxSide)', 2048, 2048],
    ['64x128 (taller than wide)', 64, 128],
  ])('rejects %s with BAD_SIZE before copying anything', (_name, width, height) => {
    const slice = vi.spyOn(Uint8Array.prototype, 'slice');
    expect(failure(headerOver(width, height, 16)).code).toBe('BAD_SIZE');
    expect(slice).not.toHaveBeenCalled();
  });

  it.each<[string, Uint8Array, SkinErrorCode]>([
    ['empty', new Uint8Array(0), 'TRUNCATED'],
    ['20 bytes of a header', pngHeader(64, 64).slice(0, 20), 'TRUNCATED'],
    ['the signature alone', pngHeader(64, 64).slice(0, 8), 'TRUNCATED'],
    ['5 bytes of a signature', pngHeader(64, 64).slice(0, 5), 'NOT_PNG'],
    ['JPEG magic', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(60).fill(0)]), 'NOT_PNG'],
    ['zero width', pngHeader(0, 64), 'BAD_SIZE'],
  ])('rejects %s', (_name, bytes, code) => {
    const error = failure(bytes);
    expect(error.code).toBe(code);
    expect(error.name).toBe('SkinError');
  });

  it('rejects a first chunk that is not IHDR as NOT_PNG', () => {
    const bytes = pngHeader(64, 64);
    bytes.set([0x74, 0x45, 0x58, 0x74], 12);
    expect(failure(bytes).code).toBe('NOT_PNG');
  });

  it('checks the file length first, before reading the header', () => {
    const big = new Uint8Array(DEFAULT_SKIN_LIMITS.maxFileBytes + 1);
    expect(failure(big).code).toBe('FILE_TOO_LARGE');
    const error = failure(headerOver(64, 64, 100), { limits: { maxFileBytes: 64 } });
    expect(error.code).toBe('FILE_TOO_LARGE');
    expect(error.message).toContain('64 bytes');
  });

  it('honours a lower maxSide', () => {
    expect(failure(headerOver(128, 128, 0), { limits: { maxSide: 64 } }).code).toBe('BAD_SIZE');
  });

  it('rejects a name over 1024 characters, accepts 1024', () => {
    expect(failure(skinBytes('classic'), { name: 'x'.repeat(1025) }).code).toBe('INVALID_NAME');
    expect(loadSkin(skinBytes('classic'), { name: 'x'.repeat(1024) }).texture.name).toHaveLength(1024);
  });

  it('never quotes file content in its messages', () => {
    const bytes = new TextEncoder().encode('SECRET-CONTENT-'.repeat(8));
    expect(failure(bytes).message).not.toContain('SECRET');
  });

  it('throws a RangeError for invalid limits', () => {
    expect(() => loadSkin(skinBytes('classic'), { limits: { maxSide: 32 } })).toThrow(RangeError);
    expect(() => loadSkin(skinBytes('classic'), { limits: { maxFileBytes: 0.5 } })).toThrow(RangeError);
  });
});
