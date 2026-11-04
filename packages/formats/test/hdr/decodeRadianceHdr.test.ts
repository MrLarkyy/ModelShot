import { describe, expect, it } from 'vitest';
import { DEFAULT_HDR_LIMITS, decodeRadianceHdr, HdrError, type HdrErrorCode, type HdrLimits } from '../../src/index';
import { encodeRadianceHdr, rgbe } from '../fixtures/hdr/encodeRadianceHdr.mjs';
import { expectCpuBelow } from '../support/expectCpuBelow';
import { seededRandom } from '../support/seededRandom';

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

/** A smooth 16 x 4 image with a run of equal pixels (so RLE writes runs and literals). */
function sample(width = 16, height = 4): { width: number; height: number; rgb: Float32Array } {
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const flat = x < 6;
      rgb[i] = flat ? 0.5 : 0.1 + x * 0.37 + y;
      rgb[i + 1] = flat ? 0.25 : 0.02 * x;
      rgb[i + 2] = flat ? 0.125 : 3 + y * 0.5;
    }
  }
  return { width, height, rgb };
}

function failure(bytes: Uint8Array, limits?: HdrLimits): HdrError {
  try {
    decodeRadianceHdr(bytes, limits);
  } catch (error) {
    if (error instanceof HdrError) return error;
    throw new Error(`expected an HdrError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected decoding to fail');
}

function expectCode(bytes: Uint8Array, code: HdrErrorCode, message: RegExp, limits?: HdrLimits): void {
  const error = failure(bytes, limits);
  expect(error.code, error.message).toBe(code);
  expect(error.message).toMatch(message);
}

/** The header of a w x h file and `body` bytes after it. */
function withHeader(resolution: string, body: readonly number[], lines = ['FORMAT=32-bit_rle_rgbe']): Uint8Array {
  return Uint8Array.from([...ascii(`#?RADIANCE\n${lines.map((l) => `${l}\n`).join('')}\n${resolution}\n`), ...body]);
}

/** Radiance's decode of one stored pixel. */
const decoded = (p: readonly number[]): number[] =>
  p[3] === 0 ? [0, 0, 0] : [0, 1, 2].map((c) => ((p[c] ?? 0) + 0.5) * 2 ** ((p[3] ?? 0) - 136));

describe('decodeRadianceHdr', () => {
  it.each([
    ['run-length', true],
    ['flat', false],
  ])('decodes %s scanlines to what each pixel stored', (_, rle) => {
    const image = sample();
    const bytes = encodeRadianceHdr(image, { rle });
    const out = decodeRadianceHdr(bytes);
    expect([out.width, out.height]).toEqual([16, 4]);
    for (let p = 0; p < 16 * 4; p++) {
      const stored = rgbe(image.rgb[p * 3] ?? 0, image.rgb[p * 3 + 1] ?? 0, image.rgb[p * 3 + 2] ?? 0);
      const expected = decoded(stored);
      for (let c = 0; c < 3; c++) expect(out.rgb[p * 3 + c]).toBe(Math.fround(expected[c] ?? 0));
      // Within the 8-bit mantissa of the brightest channel.
      const max = Math.max(image.rgb[p * 3] ?? 0, image.rgb[p * 3 + 1] ?? 0, image.rgb[p * 3 + 2] ?? 0);
      for (let c = 0; c < 3; c++)
        expect(Math.abs((out.rgb[p * 3 + c] ?? 0) - (image.rgb[p * 3 + c] ?? 0))).toBeLessThan(max / 128);
    }
  });

  it('reads #?RGBE, other header lines and CRLF line ends', () => {
    const body = encodeRadianceHdr(sample(), {
      headerLines: ['# made by a test', 'EXPOSURE=1.0', 'FORMAT=32-bit_rle_rgbe'],
    });
    // Byte for byte (TextDecoder's latin1 is windows-1252, which remaps 0x80..0x9f).
    const text = Array.from(body, (b) => String.fromCharCode(b)).join('');
    const crlf = text.replace('#?RADIANCE\n', '#?RGBE\r\n').replace('EXPOSURE=1.0\n', 'EXPOSURE=1.0\r\n');
    const bytes = Uint8Array.from(crlf, (c) => c.charCodeAt(0));
    expect(decodeRadianceHdr(bytes).rgb).toEqual(decodeRadianceHdr(body).rgb);
  });

  it('decodes exponent 0 as black and a stored pixel 1, 1, 1 only as old-style runs (refused)', () => {
    const zero = decodeRadianceHdr(withHeader('-Y 1 +X 2', [200, 100, 50, 0, 128, 64, 32, 129]));
    expect(Array.from(zero.rgb.subarray(0, 3))).toEqual([0, 0, 0]);
    expectCode(withHeader('-Y 1 +X 2', [128, 64, 32, 129, 1, 1, 1, 3]), 'RLE', /old-style .* scanline 0 \(byte \d+\)/);
  });

  describe('fails with a clear error under limits', () => {
    it('TOO_LARGE before reading anything', () => {
      const bytes = encodeRadianceHdr(sample());
      expectCode(bytes, 'TOO_LARGE', new RegExp(`${bytes.length} bytes is over the limit of 100`), {
        ...DEFAULT_HDR_LIMITS,
        maxBytes: 100,
      });
      expect(DEFAULT_HDR_LIMITS.maxBytes).toBe(32 * 1024 * 1024);
    });

    it('SIGNATURE', () => {
      expectCode(Uint8Array.from(ascii('P6\n2 2\n255\n')), 'SIGNATURE', /#\?RADIANCE or #\?RGBE/);
      expectCode(new Uint8Array(0), 'SIGNATURE', /first line/);
    });

    it('HEADER: no blank line, one beyond maxHeaderBytes, no resolution line', () => {
      expectCode(Uint8Array.from(ascii('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n')), 'HEADER', /file ends at byte 34/);
      const long = withHeader('-Y 1 +X 1', [128, 128, 128, 128], ['#'.repeat(70_000)]);
      expectCode(long, 'HEADER', /within 65536 bytes/);
      expectCode(withHeader('Y 1 X 1', []), 'HEADER', /no resolution line at byte 35/);
      expectCode(withHeader('-Y 1234567890 +X 1', []), 'HEADER', /no resolution line/);
    });

    it('FORMAT: xyze', () => {
      expectCode(
        withHeader('-Y 1 +X 1', [], ['FORMAT=32-bit_rle_xyze']),
        'FORMAT',
        /only FORMAT=32-bit_rle_rgbe .*byte 11/,
      );
    });

    it.each(['+Y 4 +X 16', '-Y 4 -X 16', '+X 16 -Y 4', '-X 16 +Y 4'])('ORIENTATION: %s', (resolution) => {
      expectCode(withHeader(resolution, []), 'ORIENTATION', /only -Y <height> \+X <width>/);
    });

    it('SIZE: no pixels, too wide, too many pixels, before any allocation', () => {
      expectCode(withHeader('-Y 0 +X 16', []), 'SIZE', /16x0 has no pixels/);
      expectCode(withHeader('-Y 1 +X 0', []), 'SIZE', /0x1 has no pixels/);
      expectCode(withHeader('-Y 1 +X 8193', []), 'SIZE', /width 8193 is over the limit of 8192/);
      // 8192 x 999999999 would be 98 GB of floats: refused from the header of a 40-byte file.
      expectCode(withHeader('-Y 999999999 +X 8192', []), 'SIZE', /8192x999999999 is over the limit of 4194304 pixels/);
      expectCode(withHeader('-Y 2049 +X 2048', []), 'SIZE', /over the limit of 4194304 pixels/);
    });

    it('TRUNCATED: too few bytes for the declared scanlines, before any allocation', () => {
      expectCode(withHeader('-Y 2048 +X 2048', [2, 2, 8, 0]), 'TRUNCATED', /4 bytes of pixel data cannot hold 2048/);
    });

    it('TRUNCATED: flat and run-length data ending early', () => {
      const flat = encodeRadianceHdr(sample(), { rle: false });
      expectCode(flat.subarray(0, flat.length - 5), 'TRUNCATED', /scanline 3 ends at byte/);
      const rle = encodeRadianceHdr(sample(16, 40));
      expectCode(rle.subarray(0, rle.length - 3), 'TRUNCATED', /scanline 39 ends at byte/);
    });

    it('RLE: a run past the scanline end, literals past it, a zero count, a width mismatch', () => {
      const marker = [2, 2, 0, 8];
      const plane = [128 + 8, 7];
      expectCode(
        withHeader('-Y 1 +X 8', [...marker, 128 + 9, 7, ...plane, ...plane, ...plane]),
        'RLE',
        /a run past the end of scanline 0/,
      );
      expectCode(
        withHeader('-Y 1 +X 8', [...marker, 9, ...Array<number>(9).fill(1), ...plane, ...plane, ...plane]),
        'RLE',
        /literal bytes past the end of scanline 0/,
      );
      expectCode(
        withHeader('-Y 1 +X 8', [...marker, 0, ...plane, ...plane, ...plane, ...plane]),
        'RLE',
        /a zero count in scanline 0/,
      );
      expectCode(
        withHeader('-Y 1 +X 8', [2, 2, 0, 9, ...plane, ...plane, ...plane, ...plane]),
        'RLE',
        /scanline 0 declares width 9, the image is 8 wide/,
      );
    });

    it('RANGE: a pixel over maxRadiance', () => {
      // Exponent 160: (200 + 0.5) x 2^24 is about 3.4e9.
      expectCode(
        withHeader('-Y 1 +X 2', [128, 128, 128, 129, 200, 10, 10, 160]),
        'RANGE',
        /pixel 1 of scanline 0 is over 1000000/,
      );
      const bright = decodeRadianceHdr(withHeader('-Y 1 +X 1', [200, 10, 10, 148]));
      expect(bright.rgb[0]).toBeCloseTo(200.5 * 4096, 3);
    });
  });

  it('a fixed-seed fuzz of 1 MiB of mutated files only ever throws HdrError, within bounded CPU time', () => {
    const valid = encodeRadianceHdr(sample(64, 16));
    const random = seededRandom(47);
    let mutated = 0;
    let decodedCount = 0;
    expectCpuBelow(1000, () => {
      while (mutated < 1024 * 1024) {
        const bytes = valid.slice(0, random() < 0.1 ? Math.floor(random() * valid.length) : valid.length);
        const flips = 1 + Math.floor(random() * 8);
        for (let i = 0; i < flips; i++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
        mutated += bytes.length;
        try {
          decodeRadianceHdr(bytes);
          decodedCount++;
        } catch (error) {
          if (!(error instanceof HdrError)) throw error;
        }
      }
    });
    expect(decodedCount).toBeGreaterThan(0);
  });
});
