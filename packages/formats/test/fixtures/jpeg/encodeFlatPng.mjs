// A flat-colour PNG encoder for fixtures: stored (uncompressed) deflate blocks, so the bytes never depend on a zlib
// version. Colour type 2 (RGB, 8-bit); `blocks` are `cols` flat colours of equal width, repeated down every row.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const v of bytes) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

/** A chunk: length, type, data, CRC of type and data. */
export function pngChunk(type, data) {
  const body = [...ascii(type), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** Stored deflate blocks of at most 65535 bytes in a zlib stream. */
function zlibStored(raw) {
  const out = [0x78, 0x01];
  for (let at = 0; at < raw.length || at === 0; at += 65535) {
    const part = raw.slice(at, at + 65535);
    const last = at + 65535 >= raw.length;
    out.push(
      last ? 1 : 0,
      part.length & 0xff,
      part.length >> 8,
      ~part.length & 0xff,
      (~part.length >> 8) & 0xff,
      ...part,
    );
    if (last) break;
  }
  return [...out, ...u32(adler32(raw))];
}

/** An Exif chunk body with one IFD0 entry, Orientation (SHORT), big-endian TIFF (no "Exif" prefix, as in eXIf). */
export function exifOrientationData(value) {
  return [...ascii('MM'), 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, 0, 0, 0, 0];
}

/**
 * A `width` x `height` RGB PNG whose columns are split into `colours.length` equal flat blocks. `options.exifOrientation`
 * adds an eXIf chunk with that Orientation before the image data (the pixels stay in stored order).
 */
export function encodeFlatPng(width, height, colours, options = {}) {
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) raw.push(...colours[Math.floor((x * colours.length) / width)]);
  }
  const chunks = [pngChunk('IHDR', [...u32(width), ...u32(height), 8, 2, 0, 0, 0])];
  if (options.exifOrientation !== undefined)
    chunks.push(pngChunk('eXIf', exifOrientationData(options.exifOrientation)));
  chunks.push(pngChunk('IDAT', zlibStored(Uint8Array.from(raw))), pngChunk('IEND', []));
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunks.flat()]);
}
