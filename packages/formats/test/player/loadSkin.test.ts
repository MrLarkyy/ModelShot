import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SKIN_LIMITS, loadSkin, SkinError, type SkinErrorCode, type SkinLoadOptions } from '../../src/index';
import * as decodeModule from '../../src/png/decodePngRgba';
import { pngHeader } from '../bbmodel/fixtures';
import { deflateSync } from 'node:zlib';
import { BitWriter } from '../support/BitWriter';
import { buildPng, imageData, pngChunk, type PngSpec } from '../support/buildPng';
import { seededRandom } from '../support/seededRandom';
import { skinBytes } from './skins';

// Pass-through, so the tests can see whether loadSkin decoded the pixels at all.
vi.mock('../../src/png/decodePngRgba', async (importOriginal) => {
  const original = await importOriginal<typeof decodeModule>();
  return { ...original, decodePngRgba: vi.fn(original.decodePngRgba) };
});
const decodeSpy = vi.mocked(decodeModule.decodePngRgba);

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

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
  return out;
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

  it('accepts a valid header over undecodable data, keeping the hat of a legacy skin', () => {
    const modern = loadSkin(headerOver(64, 64, 500));
    expect(modern.texture.bytes).toHaveLength(533);
    expect(modern.legacyHatOpaque).toBe(false);
    const legacy = loadSkin(headerOver(64, 32, 500));
    expect(legacy.texture.bytes).toHaveLength(533);
    expect(legacy.legacyHatOpaque).toBe(false);
  });

  it('decodes a legacy skin to find an opaque hat area, never a modern skin', () => {
    decodeSpy.mockClear();
    expect(loadSkin(skinBytes('legacy-opaque-hat')).legacyHatOpaque).toBe(true);
    expect(loadSkin(skinBytes('legacy')).legacyHatOpaque).toBe(false);
    expect(decodeSpy).toHaveBeenCalledTimes(2);
    // Bounded by a fixed pixel count, never by what the header claims.
    expect(decodeSpy).toHaveBeenLastCalledWith(expect.any(Uint8Array), 1024 * 512);
    decodeSpy.mockClear();
    expect(loadSkin(skinBytes('classic')).legacyHatOpaque).toBe(false);
    expect(loadSkin(skinBytes('slim')).legacyHatOpaque).toBe(false);
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  it('throws nothing but a SkinError for corrupted legacy skins (seeded fuzz)', () => {
    const random = seededRandom(36);
    const sources = [skinBytes('legacy'), skinBytes('legacy-opaque-hat')];
    const outcomes = { error: 0, opaque: 0, kept: 0 };
    for (let k = 0; k < 2000; k++) {
      let bytes = Uint8Array.from(sources[k % 2] ?? []);
      if (random() < 0.3) bytes = bytes.subarray(0, Math.floor(random() * bytes.length));
      const flips = Math.floor(random() * 4) + (bytes.length ? 1 : 0);
      for (let f = 0; f < flips; f++) {
        const at = Math.floor(random() * bytes.length);
        bytes[at] = (bytes[at] ?? 0) ^ (1 << Math.floor(random() * 8));
      }
      try {
        const { legacyHatOpaque } = loadSkin(bytes);
        expect(typeof legacyHatOpaque).toBe('boolean');
        outcomes[legacyHatOpaque ? 'opaque' : 'kept']++;
      } catch (error) {
        expect(error).toBeInstanceOf(SkinError);
        outcomes.error++;
      }
    }
    // The mutations reach every outcome, so the loop exercised the decoder and not only the header check.
    expect(Math.min(outcomes.error, outcomes.opaque, outcomes.kept)).toBeGreaterThan(20);
  });

  it('keeps the hat of a legacy header claiming 2^31 x 2^30 pixels without allocating them', () => {
    const png = concat([
      pngHeader(2 ** 31, 2 ** 30),
      pngChunk('IDAT', new Uint8Array(deflateSync(new Uint8Array(8)))),
      pngChunk('IEND', new Uint8Array(0)),
    ]);
    expect(png).toHaveLength(68);
    const skin = loadSkin(png, { limits: { maxSide: 2 ** 31 } });
    expect(skin.layout).toBe('legacy');
    expect(skin.legacyHatOpaque).toBe(false);
  });

  it('decodes an opaque legacy skin up to 1024 x 512; a 2048 x 1024 one keeps its hat', () => {
    const opaqueGrey = (width: number): Uint8Array =>
      buildPng({
        width,
        height: width / 2,
        colourType: 0,
        depth: 8,
        samples: new Uint8Array((width * width) / 2).fill(200),
      });
    expect(loadSkin(opaqueGrey(1024)).legacyHatOpaque).toBe(true);
    expect(loadSkin(opaqueGrey(2048), { limits: { maxSide: 2048 } }).legacyHatOpaque).toBe(false);
  });

  const opaqueLegacy: PngSpec = {
    width: 64,
    height: 32,
    colourType: 6,
    depth: 8,
    samples: new Uint8Array(64 * 32 * 4).fill(255),
  };

  it('keeps the hat of a legacy skin whose IDAT is cut short', () => {
    expect(loadSkin(buildPng(opaqueLegacy)).legacyHatOpaque).toBe(true);
    for (const keep of [0, 2, 0.5, 0.9]) {
      const png = buildPng({
        ...opaqueLegacy,
        mapIdat: (zlib) => zlib.subarray(0, keep < 1 ? Math.floor(zlib.length * keep) : keep),
      });
      expect(loadSkin(png).legacyHatOpaque, `IDAT cut to ${keep}`).toBe(false);
    }
  });

  it('keeps the hat of a legacy skin whose IDAT is a zlib bomb (64 MiB of zeros for 8 KiB of pixels)', () => {
    const bomb = new Uint8Array(deflateSync(new Uint8Array(64 * 1024 * 1024), { level: 9 }));
    const png = buildPng({ ...opaqueLegacy, mapIdat: () => bomb });
    expect(png.length).toBeLessThan(DEFAULT_SKIN_LIMITS.maxFileBytes);
    const start = performance.now();
    expect(loadSkin(png).legacyHatOpaque).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('walks 2 MiB of minimal dynamic blocks in a legacy skin within a second', () => {
    // Each block (91 bits) redefines every code and holds only an end-of-block: the most table builds per byte.
    const w = new BitWriter();
    const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1];
    const blocks = Math.floor(((DEFAULT_SKIN_LIMITS.maxFileBytes - 8224 - 200) * 8) / 91);
    for (let b = 0; b < blocks; b++) {
      w.bits(0, 1)
        .bits(2, 2)
        .bits(0, 5)
        .bits(0, 5)
        .bits(order.length - 4, 4);
      // Code-length code: symbols 1 and 18 at one bit each (codes 0 and 1).
      for (const symbol of order) w.bits(symbol === 1 || symbol === 18 ? 1 : 0, 3);
      // Literal 0 and end-of-block at length 1, 255 zeros between (138 + 117), one distance code of length 1.
      w.code(0, 1).code(1, 1).bits(127, 7).code(1, 1).bits(106, 7).code(0, 1).code(0, 1);
      w.code(1, 1);
    }
    const raw = imageData(opaqueLegacy);
    w.bits(1, 1)
      .bits(0, 2)
      .raw([raw.length & 0xff, raw.length >> 8, ~raw.length & 0xff, (~raw.length >> 8) & 0xff]);
    w.raw(Array.from(raw));
    const stream = w.done();
    const png = buildPng({ ...opaqueLegacy, mapIdat: () => stream });
    expect(png.length).toBeLessThanOrEqual(DEFAULT_SKIN_LIMITS.maxFileBytes);
    expect(png.length).toBeGreaterThan(DEFAULT_SKIN_LIMITS.maxFileBytes - 1024);
    const start = performance.now();
    const skin = loadSkin(png);
    const elapsed = performance.now() - start;
    // Decoded through every block to the final stored one.
    expect(skin.legacyHatOpaque).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('decodes a 1024 x 512 16-bit RGBA legacy skin within a second', () => {
    const width = 1024;
    const height = 512;
    const samples = new Uint16Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        samples[at] = ((x * 37 + y * 11) & 0xff) * 257;
        samples[at + 1] = ((x ^ y) & 0xff) << 8;
        samples[at + 2] = (x * y) & 0xffff;
        samples[at + 3] = 0xffff;
      }
    }
    const png = buildPng({ width, height, colourType: 6, depth: 16, samples, filter: (row) => row % 5 });
    expect(png.length).toBeLessThan(DEFAULT_SKIN_LIMITS.maxFileBytes);
    const start = performance.now();
    const skin = loadSkin(png);
    const elapsed = performance.now() - start;
    expect(skin.legacyHatOpaque).toBe(true);
    expect(elapsed).toBeLessThan(1000);
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
