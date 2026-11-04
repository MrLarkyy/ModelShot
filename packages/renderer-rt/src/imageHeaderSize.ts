import { walkJpegSegments, type JpegSegment } from './walkJpegSegments';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const IHDR = [73, 72, 68, 82];
const MARKER = 0xff;

export interface ImageHeaderSize {
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

/**
 * The kind and pixel size from an image header, read without decoding anything: a PNG's IHDR chunk, or a JPEG's first
 * frame header (SOF0, SOF1 or SOF2: 8-bit Huffman baseline, extended or progressive, 1, 3 or 4 components, the codings
 * browsers decode). `null` for anything else, a truncated header included. Mirrors `readPngSize` / `readJpegSize` of
 * the formats package, so a scene from any producer is checked the same way the loaders check a file.
 */
export function imageHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  if (PNG_SIGNATURE.every((value, i) => bytes[i] === value)) return pngSize(bytes);
  if (bytes[0] === MARKER && bytes[1] === 0xd8 && bytes[2] === MARKER) return jpegSize(bytes);
  return null;
}

function pngSize(bytes: Uint8Array): ImageHeaderSize | null {
  if (bytes.length < 24) return null;
  if (IHDR.some((value, i) => bytes[12 + i] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, 24);
  return { mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegSize(bytes: Uint8Array): ImageHeaderSize | null {
  const found: (ImageHeaderSize | null)[] = [];
  walkJpegSegments(bytes, (segment) => {
    const { marker } = segment;
    if (marker < 0xc0 || marker > 0xcf || marker === 0xc4 || marker === 0xc8 || marker === 0xcc) return false;
    found.push(jpegFrame(bytes, segment));
    return true;
  });
  return found[0] ?? null;
}

function jpegFrame(bytes: Uint8Array, segment: JpegSegment): ImageHeaderSize | null {
  const { marker, length, start } = segment;
  if (marker > 0xc2 || length < 8 || segment.truncated) return null;
  const components = bytes[start + 5]!;
  if (bytes[start] !== 8 || length < 8 + 3 * components) return null;
  if (components !== 1 && components !== 3 && components !== 4) return null;
  const height = (bytes[start + 1]! << 8) | bytes[start + 2]!;
  const width = (bytes[start + 3]! << 8) | bytes[start + 4]!;
  return { mimeType: 'image/jpeg', width, height };
}
