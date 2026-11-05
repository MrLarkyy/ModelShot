import { HdrError } from './HdrError';
import { DEFAULT_HDR_LIMITS, type HdrLimits } from './HdrLimits';
import type { RadianceImage } from './RadianceImage';

const NEWLINE = 0x0a;
const SIGNATURES = ['#?RADIANCE', '#?RGBE'] as const;
const FORMAT_PREFIX = 'FORMAT=';
const RGBE_FORMAT = '32-bit_rle_rgbe';
/** Longest resolution line read (`-Y 4194304 +X 8192` is 18 bytes). */
const MAX_RESOLUTION_LINE = 64;
const RESOLUTION = /^([-+])([XY]) (\d{1,9}) ([-+])([XY]) (\d{1,9})$/;
/** New-style run-length scanlines exist only for these widths (Radiance's MINELEN .. MAXELEN). */
const MIN_RLE_WIDTH = 8;
const MAX_RLE_WIDTH = 0x7fff;
/** Longest run of one new-style RLE count byte. */
const MAX_RUN = 127;

interface Header {
  readonly width: number;
  readonly height: number;
  /** Offset of the first scanline byte. */
  readonly data: number;
}

/** The line of `bytes` from `start` to the next newline (exclusive), as Latin-1, or null when none ends before `end`. */
function lineAt(
  bytes: Uint8Array,
  start: number,
  end: number,
): { readonly text: string; readonly next: number } | null {
  const stop = Math.min(end, bytes.length);
  for (let i = start; i < stop; i++) {
    if (bytes[i] !== NEWLINE) continue;
    let text = '';
    for (let j = start; j < i; j++) text += String.fromCharCode(bytes[j] ?? 0);
    return { text: text.endsWith('\r') ? text.slice(0, -1) : text, next: i + 1 };
  }
  return null;
}

function readHeader(bytes: Uint8Array, limits: HdrLimits): Header {
  const first = lineAt(bytes, 0, Math.min(limits.maxHeaderBytes, 128));
  if (!first || !SIGNATURES.some((signature) => first.text.startsWith(signature))) {
    throw new HdrError('SIGNATURE', 'the first line must start with #?RADIANCE or #?RGBE');
  }
  let at = first.next;
  for (;;) {
    const start = at;
    const line = lineAt(bytes, at, limits.maxHeaderBytes);
    if (!line) {
      throw new HdrError(
        'HEADER',
        bytes.length < limits.maxHeaderBytes
          ? `no blank line ends the header (file ends at byte ${bytes.length})`
          : `no blank line ends the header within ${limits.maxHeaderBytes} bytes`,
      );
    }
    at = line.next;
    if (line.text === '') break;
    if (line.text.startsWith(FORMAT_PREFIX) && line.text.slice(FORMAT_PREFIX.length).trim() !== RGBE_FORMAT) {
      throw new HdrError('FORMAT', `only FORMAT=${RGBE_FORMAT} is read (line at byte ${start})`);
    }
  }
  const resolution = lineAt(bytes, at, at + MAX_RESOLUTION_LINE);
  const match = resolution ? RESOLUTION.exec(resolution.text) : null;
  if (!resolution || !match) throw new HdrError('HEADER', `no resolution line at byte ${at}`);
  const [, ySign, yAxis, yValue, xSign, xAxis, xValue] = match;
  if (ySign !== '-' || yAxis !== 'Y' || xSign !== '+' || xAxis !== 'X') {
    throw new HdrError('ORIENTATION', `only -Y <height> +X <width> (rows top down) is read (byte ${at})`);
  }
  const height = Number(yValue);
  const width = Number(xValue);
  if (width === 0 || height === 0) throw new HdrError('SIZE', `${width}x${height} has no pixels`);
  if (width > limits.maxWidth) throw new HdrError('SIZE', `width ${width} is over the limit of ${limits.maxWidth}`);
  if (width * height > limits.maxPixels) {
    throw new HdrError('SIZE', `${width}x${height} is over the limit of ${limits.maxPixels} pixels`);
  }
  return { width, height, data: resolution.next };
}

/** Fewest bytes any valid encoding of one scanline of `width` pixels takes. */
function minScanlineBytes(width: number): number {
  const flat = 4 * width;
  if (width < MIN_RLE_WIDTH || width > MAX_RLE_WIDTH) return flat;
  return Math.min(flat, 4 + 4 * 2 * Math.ceil(width / MAX_RUN));
}

/**
 * Reads one new-style run-length scanline (four channel planes of count bytes: over 128 a run of count − 128 copies of
 * the next byte, else that many literal bytes) into `scan` (RGBE per pixel); `at` is past its 4-byte marker. Every
 * iteration consumes at least one byte and fills at least one pixel, so a hostile file ends after its length.
 */
function readRleScanline(bytes: Uint8Array, at: number, scan: Uint8Array, width: number, row: number): number {
  let pos = at;
  for (let channel = 0; channel < 4; channel++) {
    let x = 0;
    while (x < width) {
      if (pos >= bytes.length) throw new HdrError('TRUNCATED', `scanline ${row} ends at byte ${pos}`);
      const count = bytes[pos++] ?? 0;
      if (count > 128) {
        const run = count - 128;
        if (run > width - x) {
          throw new HdrError('RLE', `a run past the end of scanline ${row} (byte ${pos - 1})`);
        }
        if (pos >= bytes.length) throw new HdrError('TRUNCATED', `scanline ${row} ends at byte ${pos}`);
        const value = bytes[pos++] ?? 0;
        for (let i = 0; i < run; i++) scan[(x + i) * 4 + channel] = value;
        x += run;
      } else {
        if (count === 0) throw new HdrError('RLE', `a zero count in scanline ${row} (byte ${pos - 1})`);
        if (count > width - x) {
          throw new HdrError('RLE', `literal bytes past the end of scanline ${row} (byte ${pos - 1})`);
        }
        if (pos + count > bytes.length) throw new HdrError('TRUNCATED', `scanline ${row} ends at byte ${bytes.length}`);
        for (let i = 0; i < count; i++) scan[(x + i) * 4 + channel] = bytes[pos + i] ?? 0;
        pos += count;
        x += count;
      }
    }
  }
  return pos;
}

/** Reads one flat scanline (RGBE per pixel); old-style runs (a 1, 1, 1 pixel) are refused. */
function readFlatScanline(bytes: Uint8Array, at: number, scan: Uint8Array, width: number, row: number): number {
  const end = at + 4 * width;
  if (end > bytes.length) throw new HdrError('TRUNCATED', `scanline ${row} ends at byte ${bytes.length}`);
  for (let x = 0; x < width; x++) {
    const i = at + 4 * x;
    if (bytes[i] === 1 && bytes[i + 1] === 1 && bytes[i + 2] === 1) {
      throw new HdrError('RLE', `old-style run-length data in scanline ${row} (byte ${i}) is not read`);
    }
  }
  scan.set(bytes.subarray(at, end));
  return end;
}

/**
 * Decodes a Radiance RGBE (`.hdr`) file: `#?RADIANCE` or `#?RGBE`, `FORMAT=32-bit_rle_rgbe`, resolution
 * `-Y <height> +X <width>` only, flat or new-style run-length scanlines. Every limit is checked before what it bounds is
 * allocated or decoded: the byte count first, the header within `maxHeaderBytes`, the size against `maxWidth` and
 * `maxPixels`, then whether the bytes left can hold that many scanlines at all. One pass over the bytes; a pixel
 * brighter than `maxRadiance` throws. Channels decode as Radiance does, `(m + 0.5) · 2^(e − 136)`, 0 for exponent 0.
 * Every failure is an `HdrError`.
 */
export function decodeRadianceHdr(bytes: Uint8Array, limits: HdrLimits = DEFAULT_HDR_LIMITS): RadianceImage {
  if (bytes.length > limits.maxBytes) {
    throw new HdrError('TOO_LARGE', `${bytes.length} bytes is over the limit of ${limits.maxBytes}`);
  }
  const { width, height, data } = readHeader(bytes, limits);
  const minBytes = height * minScanlineBytes(width);
  if (bytes.length - data < minBytes) {
    throw new HdrError(
      'TRUNCATED',
      `${bytes.length - data} bytes of pixel data cannot hold ${height} scanlines of ${width} pixels`,
    );
  }
  const scale = new Float64Array(256);
  for (let e = 1; e < 256; e++) scale[e] = 2 ** (e - 136);
  const rgb = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  const rleWidth = width >= MIN_RLE_WIDTH && width <= MAX_RLE_WIDTH;
  let pos = data;
  for (let row = 0; row < height; row++) {
    if (pos + 4 > bytes.length) throw new HdrError('TRUNCATED', `scanline ${row} ends at byte ${bytes.length}`);
    if (rleWidth && bytes[pos] === 2 && bytes[pos + 1] === 2 && ((bytes[pos + 2] ?? 0) & 0x80) === 0) {
      const declared = ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0);
      if (declared !== width) {
        throw new HdrError('RLE', `scanline ${row} declares width ${declared}, the image is ${width} wide`);
      }
      pos = readRleScanline(bytes, pos + 4, scan, width, row);
    } else {
      pos = readFlatScanline(bytes, pos, scan, width, row);
    }
    const base = row * width * 3;
    for (let x = 0; x < width; x++) {
      const f = scale[scan[x * 4 + 3] ?? 0] ?? 0;
      if (f === 0) continue;
      const r = ((scan[x * 4] ?? 0) + 0.5) * f;
      const g = ((scan[x * 4 + 1] ?? 0) + 0.5) * f;
      const b = ((scan[x * 4 + 2] ?? 0) + 0.5) * f;
      if (Math.max(r, g, b) > limits.maxRadiance) {
        throw new HdrError('RANGE', `pixel ${x} of scanline ${row} is over ${limits.maxRadiance}`);
      }
      rgb[base + x * 3] = r;
      rgb[base + x * 3 + 1] = g;
      rgb[base + x * 3 + 2] = b;
    }
  }
  return { width, height, rgb };
}
