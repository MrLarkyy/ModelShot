const SIGNATURE_LENGTH = 8;
const CHUNK_OVERHEAD = 12;

/**
 * A copy of PNG bytes without their eXIf chunks, so the image decodes in stored order: browsers apply an eXIf
 * Orientation like a JPEG's, which would turn a texture against its UVs. Whole chunks are dropped, so every kept chunk
 * keeps its CRC. Walks the chunks by their lengths and ends at IEND or at the first chunk that does not fit the bytes
 * (the rest is copied unread for the decoder to judge); every step moves forward and nothing is read outside `bytes`.
 */
export function pngWithoutExif(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const kept: Uint8Array[] = [];
  let from = 0;
  let at = SIGNATURE_LENGTH;
  while (at + CHUNK_OVERHEAD <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
    const end = at + CHUNK_OVERHEAD + length;
    if (end > bytes.length) break;
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    if (type === 'eXIf') {
      kept.push(bytes.subarray(from, at));
      from = end;
    }
    at = end;
    if (type === 'IEND') break;
  }
  kept.push(bytes.subarray(from));
  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
