export type PngSizeResult =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: 'NOT_PNG' | 'TRUNCATED' | 'NO_IHDR' | 'ZERO_SIZE' };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Signature (8) + IHDR chunk: length (4), type (4), data (13), CRC (4).
const MIN_LENGTH = 33;

/** Pixel size from the PNG header, without decoding any image data. The PNG spec requires IHDR as the first chunk. */
export function readPngSize(bytes: Uint8Array): PngSizeResult {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((b, i) => bytes[i] !== b)) {
    return { ok: false, reason: bytes.length === 0 ? 'TRUNCATED' : 'NOT_PNG' };
  }
  if (bytes.length < MIN_LENGTH) return { ok: false, reason: 'TRUNCATED' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isIhdr = view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452;
  if (!isIhdr) return { ok: false, reason: 'NO_IHDR' };
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return { ok: false, reason: 'ZERO_SIZE' };
  return { ok: true, width, height };
}
