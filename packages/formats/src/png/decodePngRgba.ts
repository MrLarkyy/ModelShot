import { inflateZlib } from './inflateZlib';

/** Straight-alpha RGBA, 8 bits per channel, rows top to bottom. */
export interface PngRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = 0x49484452;
const PLTE = 0x504c5445;
const TRNS = 0x74524e53;
const IDAT = 0x49444154;
const IEND = 0x49454e44;
const MAX_CHUNK_LENGTH = 0x7fffffff;

/** Legal bit depths per colour type (PNG spec table 11.1) and samples per pixel. */
const COLOUR_TYPES: ReadonlyMap<number, { readonly depths: readonly number[]; readonly channels: number }> = new Map([
  [0, { depths: [1, 2, 4, 8, 16], channels: 1 }],
  [2, { depths: [8, 16], channels: 3 }],
  [3, { depths: [1, 2, 4, 8], channels: 1 }],
  [4, { depths: [8, 16], channels: 2 }],
  [6, { depths: [8, 16], channels: 4 }],
]);

/** Adam7 passes: first column, first row, column step, row step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface Header {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly colourType: number;
  readonly channels: number;
  readonly interlaced: boolean;
}

interface Chunks {
  readonly header: Header;
  readonly idat: Uint8Array;
  readonly palette: Uint8Array | undefined;
  readonly transparency: Uint8Array | undefined;
}

/** One pass of the image: where its pixels go and how its scanlines are laid out. */
interface Pass {
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
  readonly rowBytes: number;
}

/**
 * The pixels of a PNG (every standard colour type, bit depth and filter, Adam7 too) as 8-bit RGBA; 16-bit samples keep
 * their high byte, `tRNS` gives grey, RGB and palette images their alpha. Returns `undefined`, never throws, for a file
 * it cannot read: a chunk running past the end, an illegal header, more than `maxPixels` pixels (checked before
 * anything is allocated), a missing palette or a palette index past it, no image data, image data that does not inflate
 * to exactly the size the header implies, or an unknown filter. CRCs are not checked; unknown chunks are skipped.
 */
export function decodePngRgba(bytes: Uint8Array, maxPixels: number): PngRgbaImage | undefined {
  const chunks = readChunks(bytes, maxPixels);
  if (!chunks) return undefined;
  const { header } = chunks;
  if (header.colourType === 3 && !chunks.palette) return undefined;
  const bitsPerPixel = header.depth * header.channels;
  const passes = header.interlaced
    ? ADAM7.map(([x0, y0, dx, dy]) => pass(header, bitsPerPixel, x0, y0, dx, dy))
    : [pass(header, bitsPerPixel, 0, 0, 1, 1)];
  const expected = passes.reduce((sum, p) => sum + (p.width && p.height ? p.height * (p.rowBytes + 1) : 0), 0);
  const raw = inflateZlib(chunks.idat, expected);
  if (!raw) return undefined;

  const rgba = new Uint8Array(header.width * header.height * 4);
  const toRgba = pixelReader(chunks);
  const filterBytes = Math.max(1, bitsPerPixel >> 3);
  let at = 0;
  for (const p of passes) {
    if (!p.width || !p.height) continue;
    let previous: Uint8Array = new Uint8Array(p.rowBytes);
    for (let row = 0; row < p.height; row++) {
      const line = raw.subarray(at + 1, at + 1 + p.rowBytes);
      if (!unfilter(raw[at] ?? 0, line, previous, filterBytes)) return undefined;
      at += p.rowBytes + 1;
      const y = p.y0 + row * p.dy;
      for (let column = 0; column < p.width; column++) {
        const target = (y * header.width + p.x0 + column * p.dx) * 4;
        if (!toRgba(line, column, rgba, target)) return undefined;
      }
      previous = line;
    }
  }
  return { width: header.width, height: header.height, rgba };
}

function readChunks(bytes: Uint8Array, maxPixels: number): Chunks | undefined {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((b, i) => bytes[i] !== b)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  let at = SIGNATURE.length;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) return undefined;
    const length = view.getUint32(at);
    const type = view.getUint32(at + 4);
    if (length > MAX_CHUNK_LENGTH || at + 12 + length > bytes.length) return undefined;
    const data = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (!header) {
      if (type !== IHDR) return undefined;
      header = readHeader(data, maxPixels);
      if (!header) return undefined;
    } else if (type === IDAT) {
      idat.push(data);
    } else if (type === PLTE) {
      if (length === 0 || length % 3 !== 0 || length > 256 * 3) return undefined;
      palette = data;
    } else if (type === TRNS) {
      transparency = data;
    } else if (type === IEND) {
      break;
    }
  }
  if (!header || idat.length === 0) return undefined;
  return { header, idat: concat(idat), palette, transparency };
}

function readHeader(data: Uint8Array, maxPixels: number): Header | undefined {
  if (data.length !== 13) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const [depth = 0, colourType = 0, compression, filter, interlace] = data.subarray(8);
  const colour = COLOUR_TYPES.get(colourType);
  if (!colour || !colour.depths.includes(depth) || compression !== 0 || filter !== 0) return undefined;
  if (interlace !== 0 && interlace !== 1) return undefined;
  if (width === 0 || height === 0 || width * height > maxPixels) return undefined;
  return { width, height, depth, colourType, channels: colour.channels, interlaced: interlace === 1 };
}

function pass(header: Header, bitsPerPixel: number, x0: number, y0: number, dx: number, dy: number): Pass {
  const width = header.width > x0 ? Math.ceil((header.width - x0) / dx) : 0;
  const height = header.height > y0 ? Math.ceil((header.height - y0) / dy) : 0;
  return { x0, y0, dx, dy, width, height, rowBytes: Math.ceil((width * bitsPerPixel) / 8) };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0]) return parts[0];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Undoes one scanline's filter in place; `false` for an unknown filter type. */
function unfilter(type: number, line: Uint8Array, previous: Uint8Array, bpp: number): boolean {
  const n = line.length;
  switch (type) {
    case 0:
      return true;
    case 1:
      for (let i = bpp; i < n; i++) line[i] = ((line[i] ?? 0) + (line[i - bpp] ?? 0)) & 0xff;
      return true;
    case 2:
      for (let i = 0; i < n; i++) line[i] = ((line[i] ?? 0) + (previous[i] ?? 0)) & 0xff;
      return true;
    case 3:
      for (let i = 0; i < n; i++) {
        const left = i >= bpp ? (line[i - bpp] ?? 0) : 0;
        line[i] = ((line[i] ?? 0) + ((left + (previous[i] ?? 0)) >> 1)) & 0xff;
      }
      return true;
    case 4:
      for (let i = 0; i < n; i++) {
        const left = i >= bpp ? (line[i - bpp] ?? 0) : 0;
        const upLeft = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
        line[i] = ((line[i] ?? 0) + paeth(left, previous[i] ?? 0, upLeft)) & 0xff;
      }
      return true;
    default:
      return false;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

type PixelReader = (line: Uint8Array, column: number, rgba: Uint8Array, target: number) => boolean;

/** Writes pixel `column` of an unfiltered scanline as RGBA8; `false` for a palette index past the palette. */
function pixelReader({ header, palette, transparency }: Chunks): PixelReader {
  const { depth, channels, colourType } = header;
  const sample = sampleReader(depth, channels);
  if (colourType === 3) {
    const entries = (palette?.length ?? 0) / 3;
    return (line, column, rgba, target) => {
      const index = sample(line, column, 0);
      if (index >= entries) return false;
      rgba[target] = palette?.[index * 3] ?? 0;
      rgba[target + 1] = palette?.[index * 3 + 1] ?? 0;
      rgba[target + 2] = palette?.[index * 3 + 2] ?? 0;
      rgba[target + 3] = transparency?.[index] ?? 255;
      return true;
    };
  }
  const max = 2 ** depth - 1;
  const to8 = depth === 16 ? (v: number) => v >> 8 : (v: number) => Math.round((v * 255) / max);
  const key = transparentKey(colourType, transparency);
  const grey = colourType === 0 || colourType === 4;
  const hasAlpha = colourType === 4 || colourType === 6;
  return (line, column, rgba, target) => {
    const r = sample(line, column, 0);
    const g = grey ? r : sample(line, column, 1);
    const b = grey ? r : sample(line, column, 2);
    rgba[target] = to8(r);
    rgba[target + 1] = to8(g);
    rgba[target + 2] = to8(b);
    if (hasAlpha) rgba[target + 3] = to8(sample(line, column, channels - 1));
    else rgba[target + 3] = key && key[0] === r && key[1] === g && key[2] === b ? 0 : 255;
    return true;
  };
}

/** The full-precision sample value `channel` of pixel `column`. */
function sampleReader(depth: number, channels: number): (line: Uint8Array, column: number, channel: number) => number {
  if (depth === 16) {
    return (line, column, channel) => {
      const i = (column * channels + channel) * 2;
      return ((line[i] ?? 0) << 8) | (line[i + 1] ?? 0);
    };
  }
  if (depth === 8) return (line, column, channel) => line[column * channels + channel] ?? 0;
  // Sub-byte depths only occur with one channel; pixels are packed most significant bits first.
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  return (line, column) => {
    const shift = 8 - depth * ((column % perByte) + 1);
    return ((line[Math.floor(column / perByte)] ?? 0) >> shift) & mask;
  };
}

/** The `tRNS` colour of a grey or RGB image as [r, g, b] samples, or `undefined` (none, or the wrong length). */
function transparentKey(colourType: number, transparency: Uint8Array | undefined): number[] | undefined {
  if (!transparency) return undefined;
  const value = (i: number) => ((transparency[i * 2] ?? 0) << 8) | (transparency[i * 2 + 1] ?? 0);
  if (colourType === 0 && transparency.length === 2) return [value(0), value(0), value(0)];
  if (colourType === 2 && transparency.length === 6) return [value(0), value(1), value(2)];
  return undefined;
}
