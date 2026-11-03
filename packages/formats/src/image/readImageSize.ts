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
      /** Why the image is not drawn, for a warning: e.g. `JPEG UNSUPPORTED_CODING arithmetic`, `a WebP image`. */
      readonly reason: string;
    };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
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
      : { ok: false, reason: `PNG ${png.reason}` };
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    const jpeg = readJpegSize(bytes);
    if (jpeg.ok) return { ok: true, mimeType: 'image/jpeg', width: jpeg.width, height: jpeg.height };
    return {
      ok: false,
      reason: jpeg.reason === 'UNSUPPORTED_CODING' ? `JPEG ${jpeg.reason} ${jpeg.coding}` : `JPEG ${jpeg.reason}`,
    };
  }
  if (isWebp(bytes)) return { ok: false, reason: 'a WebP image' };
  if (startsWith(bytes, KTX2_SIGNATURE)) return { ok: false, reason: 'a KTX2 image' };
  return { ok: false, reason: 'neither a PNG nor a JPEG signature' };
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

function isWebp(bytes: Uint8Array): boolean {
  const ascii = (from: number, text: string) => [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  return bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP');
}
