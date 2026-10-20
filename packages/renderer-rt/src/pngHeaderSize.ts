const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const IHDR = [73, 72, 68, 82];

/**
 * Width and height from a PNG's IHDR chunk (bytes 16..23 after the signature and the chunk header), read without
 * decoding anything; `null` when the bytes do not start with a PNG signature and an IHDR chunk.
 */
export function pngHeaderSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (SIGNATURE.some((value, i) => bytes[i] !== value)) return null;
  if (IHDR.some((value, i) => bytes[12 + i] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, 24);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
