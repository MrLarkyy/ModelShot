import { readJpegSize } from '../jpeg/readJpegSize';
import { readPngSize } from '../png/readPngSize';

export type ImageSizeResult =
  | {
      readonly ok: true;
      readonly mimeType: 'image/png' | 'image/jpeg';
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly ok: false;
      /** What the image is and why it is not drawn, in plain words after "is": `an arithmetic JPEG`, `a JPEG whose header is cut short`. */
      readonly reason: string;
    };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
// The sniff browsers use before decoding: SOI and the first marker's FF.
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const KTX2_SIGNATURE = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb];

/**
 * The kind and pixel size of an image from its header, without decoding: PNG or JPEG decided by the bytes, never by a
 * declared MIME type or file extension. Anything else, WebP and KTX2 named, is not drawn.
 */
export function readImageSize(bytes: Uint8Array): ImageSizeResult {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (startsWith(bytes, PNG_SIGNATURE)) {
    const png = readPngSize(bytes);
    return png.ok
      ? { ok: true, mimeType: 'image/png', width: png.width, height: png.height }
      : { ok: false, reason: PNG_REASONS[png.reason] };
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    const jpeg = readJpegSize(bytes);
    if (jpeg.ok) return { ok: true, mimeType: 'image/jpeg', width: jpeg.width, height: jpeg.height };
    return { ok: false, reason: jpegReason(jpeg) };
  }
  if (isWebp(bytes)) return { ok: false, reason: 'not a PNG or JPEG image (WebP is not supported)' };
  if (startsWith(bytes, KTX2_SIGNATURE))
    return { ok: false, reason: 'not a PNG or JPEG image (KTX2 is not supported)' };
  return { ok: false, reason: 'not a PNG or JPEG image' };
}

const PNG_REASONS = {
  NOT_PNG: 'not a PNG image',
  TRUNCATED: 'a PNG whose header is cut short',
  NO_IHDR: 'a PNG that does not start with its IHDR header',
  ZERO_SIZE: 'a PNG with a width or height of 0',
} as const;

function jpegReason(jpeg: Extract<ReturnType<typeof readJpegSize>, { ok: false }>): string {
  switch (jpeg.reason) {
    case 'TRUNCATED':
      return 'a JPEG whose header is cut short';
    case 'NO_SOF':
      return 'a JPEG with no frame header before its image data';
    case 'ZERO_SIZE':
      return 'a JPEG with a width or height of 0';
    case 'NOT_JPEG':
      return 'a JPEG with a second start marker in its header';
    case 'UNSUPPORTED_CODING':
      return jpeg.coding.endsWith('components')
        ? `a JPEG with ${jpeg.coding} (1, 3 or 4 are drawn)`
        : `a JPEG that is ${jpeg.coding} (only 8-bit Huffman JPEG is drawn)`;
  }
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

function isWebp(bytes: Uint8Array): boolean {
  const ascii = (from: number, text: string) => [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  return bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP');
}
