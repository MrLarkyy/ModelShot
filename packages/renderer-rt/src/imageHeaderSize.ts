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

/** Walks the marker segments by their lengths; every step moves forward, so it ends within `bytes.length` steps. */
function jpegSize(bytes: Uint8Array): ImageHeaderSize | null {
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== MARKER) {
      at++;
      continue;
    }
    while (at < bytes.length && bytes[at] === MARKER) at++;
    if (at >= bytes.length) return null;
    const marker = bytes[at]!;
    if (marker === 0 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at++;
      continue;
    }
    // SOI again, EOI or SOS (scan data) before any frame header.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return null;
    if (at + 2 >= bytes.length) return null;
    const length = (bytes[at + 1]! << 8) | bytes[at + 2]!;
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return jpegFrame(bytes, at, marker, length);
    }
    at += 1 + length;
  }
  return null;
}

function jpegFrame(bytes: Uint8Array, at: number, marker: number, length: number): ImageHeaderSize | null {
  if (marker > 0xc2 || length < 8 || at + 1 + length > bytes.length) return null;
  const components = bytes[at + 8]!;
  if (bytes[at + 3] !== 8 || length < 8 + 3 * components) return null;
  if (components !== 1 && components !== 3 && components !== 4) return null;
  const height = (bytes[at + 4]! << 8) | bytes[at + 5]!;
  const width = (bytes[at + 6]! << 8) | bytes[at + 7]!;
  return { mimeType: 'image/jpeg', width, height };
}
