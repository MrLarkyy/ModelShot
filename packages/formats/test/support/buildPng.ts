import { deflateSync, type ZlibOptions } from 'node:zlib';
import { crc32 } from '../../src/png/checksums';

export interface PngSpec {
  readonly width: number;
  readonly height: number;
  /** 0 grey, 2 RGB, 3 palette, 4 grey + alpha, 6 RGBA. */
  readonly colourType: number;
  readonly depth: number;
  /** Full-precision samples (0..2^depth − 1), row-major, one per channel of each pixel. */
  readonly samples: ArrayLike<number>;
  readonly palette?: readonly (readonly [number, number, number])[];
  /** `tRNS` chunk data as written. */
  readonly transparency?: readonly number[];
  /** Interlace method as written to IHDR; 1 lays the image data out in the seven Adam7 passes. */
  readonly interlace?: number;
  /** Filter type of each scanline (default 0); types outside 0..4 are written with the bytes unfiltered. */
  readonly filter?: (row: number) => number;
  readonly zlib?: ZlibOptions;
  /** Changes the zlib stream before it is split into IDAT chunks. */
  readonly mapIdat?: (zlib: Uint8Array) => Uint8Array;
  /** Number of IDAT chunks the stream is split into (default 1; 0 writes none). */
  readonly idatChunks?: number;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** A PNG file from samples, compressed by node:zlib, with valid CRCs. A test-side encoder for the decoder's tests. */
export function buildPng(spec: PngSpec): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, spec.width);
  view.setUint32(4, spec.height);
  header.set([spec.depth, spec.colourType, 0, 0, spec.interlace ?? 0], 8);
  const raw = imageData(spec);
  let zlib: Uint8Array = new Uint8Array(deflateSync(raw, spec.zlib));
  if (spec.mapIdat) zlib = spec.mapIdat(zlib);
  const chunks = [pngChunk('IHDR', header)];
  if (spec.palette) chunks.push(pngChunk('PLTE', Uint8Array.from(spec.palette.flat())));
  if (spec.transparency) chunks.push(pngChunk('tRNS', Uint8Array.from(spec.transparency)));
  const parts = spec.idatChunks ?? 1;
  for (let k = 0; k < parts; k++) {
    const from = Math.floor((k * zlib.length) / parts);
    chunks.push(pngChunk('IDAT', zlib.subarray(from, Math.floor(((k + 1) * zlib.length) / parts))));
  }
  chunks.push(pngChunk('IEND', new Uint8Array(0)));
  return concat([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

/** One PNG chunk: length, type, data, CRC. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(
    Uint8Array.from(type, (c) => c.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The filtered scanlines (filter byte first) the zlib stream holds, pass by pass when interlaced. */
export function imageData(spec: PngSpec): Uint8Array {
  const channels = CHANNELS[spec.colourType] ?? 1;
  const passes = spec.interlace === 1 ? ADAM7 : ([[0, 0, 1, 1]] as const);
  const lines: Uint8Array[] = [];
  let row = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const xs: number[] = [];
    for (let x = x0; x < spec.width; x += dx) xs.push(x);
    if (xs.length === 0) continue;
    let previous: Uint8Array | undefined;
    for (let y = y0; y < spec.height; y += dy) {
      const line = packRow(spec, channels, y, xs);
      const type = spec.filter?.(row++) ?? 0;
      lines.push(Uint8Array.of(type), filterRow(type, line, previous ?? new Uint8Array(line.length), channels, spec));
      previous = line;
    }
  }
  return concat(lines);
}

function packRow(spec: PngSpec, channels: number, y: number, xs: readonly number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil((xs.length * channels * spec.depth) / 8));
  let bit = 0;
  for (const x of xs) {
    for (let c = 0; c < channels; c++) {
      const value = spec.samples[(y * spec.width + x) * channels + c] ?? 0;
      if (spec.depth === 16) {
        out[bit >> 3] = value >> 8;
        out[(bit >> 3) + 1] = value & 0xff;
      } else {
        out[bit >> 3] = (out[bit >> 3] ?? 0) | ((value << (8 - spec.depth - (bit & 7))) & 0xff);
      }
      bit += spec.depth;
    }
  }
  return out;
}

function filterRow(type: number, line: Uint8Array, previous: Uint8Array, channels: number, spec: PngSpec) {
  const bpp = Math.max(1, (channels * spec.depth) >> 3);
  const out = new Uint8Array(line.length);
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? (line[i - bpp] ?? 0) : 0;
    const b = previous[i] ?? 0;
    const c = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
    const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type] ?? 0;
    out[i] = ((line[i] ?? 0) - predictor) & 0xff;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
