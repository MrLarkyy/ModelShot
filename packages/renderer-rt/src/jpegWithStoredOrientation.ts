import { walkJpegSegments } from './walkJpegSegments';

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];
const ORIENTATION_TAG = 0x0112;

/**
 * A copy of JPEG bytes whose Exif Orientation tags (IFD0 of every APP1 Exif segment before the first scan) read 1, so
 * the image decodes in stored order. Browsers now apply the orientation even under `imageOrientation: 'none'`, which
 * would turn a texture against its UVs (a non-square one would fail the decoded-size check). Walks the marker
 * segments with libjpeg's rules (`walkJpegSegments`: stray bytes and fill between segments are skipped), the same the
 * decoder follows, so an Exif segment the decoder reads is found; it never reads or writes outside a segment.
 */
export function jpegWithStoredOrientation(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes);
  walkJpegSegments(copy, (segment) => {
    if (segment.marker === 0xe1) resetOrientation(copy, segment.start, segment.end);
  });
  return copy;
}

/** Sets IFD0's Orientation to 1 in the Exif payload [start, end): a TIFF header, then IFD0's 12-byte entries. */
function resetOrientation(bytes: Uint8Array, start: number, end: number): void {
  if (end - start < EXIF_HEADER.length + 8 || EXIF_HEADER.some((b, i) => bytes[start + i] !== b)) return;
  const tiff = start + EXIF_HEADER.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return;
  const little = order === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 42) return;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd < tiff + 8 || ifd + 2 > end) return;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + 12 * i;
    if (entry + 12 > end) return;
    // A SHORT value sits in the first two bytes of the entry's 4-byte value field.
    if (view.getUint16(entry, little) === ORIENTATION_TAG && view.getUint16(entry + 2, little) === 3) {
      view.setUint16(entry + 8, 1, little);
    }
  }
}
