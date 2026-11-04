// A baseline JPEG encoder for test fixtures, no dependencies. Every 8x8 block is one flat YCbCr colour: 4:4:4 (no
// chroma subsampling), every quantiser 1, DC coefficients only. A DC-only block decodes to a constant through any
// IDCT and 4:4:4 needs no upsampling, so every browser decoder reproduces the samples exactly: deterministic goldens.

/** JFIF YCbCr of an RGB colour, rounded: what the fixtures store. */
export function rgbToYcc([r, g, b]) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [y, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b].map((v) =>
    Math.min(255, Math.max(0, Math.round(v))),
  );
}

/** JFIF RGB of a stored YCbCr colour, rounded and clamped: what a decoder gives back, within its integer rounding. */
export function yccToRgb([y, cb, cr]) {
  return [y + 1.402 * (cr - 128), y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128), y + 1.772 * (cb - 128)].map((v) =>
    Math.min(255, Math.max(0, Math.round(v))),
  );
}

function segment(marker, payload) {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

/** APP1 Exif with one IFD0 entry, Orientation (0x0112, SHORT), big-endian TIFF. */
function exifOrientation(value) {
  const tiff = [...ascii('MM'), 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, 0, 0, 0, 0];
  return segment(0xe1, [...ascii('Exif'), 0, 0, ...tiff]);
}

function frameHeader(width, height) {
  const components = [1, 2, 3].flatMap((id) => [id, 0x11, 0]);
  return segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, ...components]);
}

/**
 * The JPEG bytes of a `width` x `height` image (multiples of 8) whose blocks, row by row, are `blocks[i]` = [Y, Cb, Cr].
 * `options.exifOrientation` adds an Exif Orientation tag (the pixels stay in stored order); `options.headerOnly` writes
 * only the headers up to the frame header, then EOI: a file whose size is read but that never decodes.
 */
export function encodeFlatJpeg(width, height, blocks, options = {}) {
  const out = [0xff, 0xd8];
  out.push(...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (options.exifOrientation !== undefined) out.push(...exifOrientation(options.exifOrientation));
  if (options.headerOnly) {
    out.push(...frameHeader(width, height), 0xff, 0xd9);
    return Uint8Array.from(out);
  }
  if (width % 8 !== 0 || height % 8 !== 0) throw new RangeError('width and height must be multiples of 8');
  if (blocks.length !== (width / 8) * (height / 8)) throw new RangeError('one colour per 8x8 block');
  out.push(...segment(0xdb, [0, ...new Array(64).fill(1)]));
  out.push(...frameHeader(width, height));
  // DC: categories 0..11, each a 4-bit code equal to the category. AC: only EOB, the 1-bit code 0.
  const dcBits = [0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  out.push(...segment(0xc4, [0x00, ...dcBits, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  out.push(...segment(0xc4, [0x10, 1, ...new Array(15).fill(0), 0x00]));
  out.push(...segment(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]));
  out.push(...entropyData(blocks));
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}

function entropyData(blocks) {
  const bytes = [];
  let buffer = 0;
  let count = 0;
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) {
      buffer = (buffer << 1) | ((value >> i) & 1);
      if (++count === 8) {
        bytes.push(buffer);
        if (buffer === 0xff) bytes.push(0x00);
        buffer = 0;
        count = 0;
      }
    }
  };
  const previous = [0, 0, 0];
  for (const block of blocks) {
    for (let c = 0; c < 3; c++) {
      // A flat block of level s - 128 has the DC coefficient 8 (s - 128) under the JPEG DCT's scaling.
      const dc = 8 * (block[c] - 128);
      const diff = dc - previous[c];
      previous[c] = dc;
      const magnitude = Math.abs(diff);
      const category = 32 - Math.clz32(magnitude);
      put(category, 4);
      if (category > 0) put(diff > 0 ? diff : diff + (1 << category) - 1, category);
      put(0, 1);
    }
  }
  if (count > 0) put((1 << (8 - count)) - 1, 8 - count);
  return bytes;
}
