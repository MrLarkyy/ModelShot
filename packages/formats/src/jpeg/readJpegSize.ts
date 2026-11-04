export type JpegSizeResult =
  | {
      readonly ok: true;
      readonly width: number;
      readonly height: number;
      readonly components: number;
      readonly progressive: boolean;
    }
  | { readonly ok: false; readonly reason: 'NOT_JPEG' | 'TRUNCATED' | 'NO_SOF' | 'ZERO_SIZE' }
  | { readonly ok: false; readonly reason: 'UNSUPPORTED_CODING'; readonly coding: string };

const MARKER = 0xff;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const TEM = 0x01;
const SOF_PROGRESSIVE = 0xc2;

// Every SOFn the standard defines except the three Huffman sequential and progressive ones, which browsers decode.
const UNSUPPORTED_SOF: Readonly<Record<number, string>> = {
  0xc3: 'lossless',
  0xc5: 'hierarchical',
  0xc6: 'hierarchical progressive',
  0xc7: 'hierarchical lossless',
  0xc9: 'arithmetic',
  0xca: 'arithmetic progressive',
  0xcb: 'arithmetic lossless',
  0xcd: 'arithmetic hierarchical',
  0xce: 'arithmetic hierarchical progressive',
  0xcf: 'arithmetic hierarchical lossless',
};

/**
 * Pixel size from the JPEG frame header (the first SOFn), without decoding any image data. Walks the marker segments by
 * their lengths: each step moves forward, so the walk ends within `bytes.length` steps and never reads past the end.
 * Only 8-bit Huffman baseline, extended and progressive frames with 1, 3 or 4 components are accepted, the codings
 * browsers decode; any other is `UNSUPPORTED_CODING` naming it. Bytes between segments are skipped, as libjpeg does.
 */
export function readJpegSize(bytes: Uint8Array): JpegSizeResult {
  if (bytes.length === 0) return { ok: false, reason: 'TRUNCATED' };
  if (bytes.length < 2 || bytes[0] !== MARKER || bytes[1] !== SOI) return { ok: false, reason: 'NOT_JPEG' };
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== MARKER) {
      at++;
      continue;
    }
    while (at < bytes.length && bytes[at] === MARKER) at++;
    if (at >= bytes.length) break;
    const marker = bytes[at]!;
    if (marker === 0 || marker === TEM || (marker >= 0xd0 && marker <= 0xd7)) {
      at++;
      continue;
    }
    if (marker === SOI) return { ok: false, reason: 'NOT_JPEG' };
    if (marker === EOI || marker === SOS) return { ok: false, reason: 'NO_SOF' };
    if (at + 2 >= bytes.length) break;
    const length = (bytes[at + 1]! << 8) | bytes[at + 2]!;
    if (length < 2) return { ok: false, reason: 'TRUNCATED' };
    if (isFrameMarker(marker)) return readFrame(bytes, at, marker, length);
    at += 1 + length;
  }
  return { ok: false, reason: 'TRUNCATED' };
}

function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** `at` is the marker byte; the segment holds length (2), precision (1), height (2), width (2), components (1) + 3 each. */
function readFrame(bytes: Uint8Array, at: number, marker: number, length: number): JpegSizeResult {
  const coding = UNSUPPORTED_SOF[marker];
  if (coding !== undefined) return { ok: false, reason: 'UNSUPPORTED_CODING', coding };
  if (length < 8 || at + 1 + length > bytes.length) return { ok: false, reason: 'TRUNCATED' };
  const precision = bytes[at + 3]!;
  const height = (bytes[at + 4]! << 8) | bytes[at + 5]!;
  const width = (bytes[at + 6]! << 8) | bytes[at + 7]!;
  const components = bytes[at + 8]!;
  if (length < 8 + 3 * components) return { ok: false, reason: 'TRUNCATED' };
  if (precision !== 8) return { ok: false, reason: 'UNSUPPORTED_CODING', coding: `${precision}-bit` };
  if (components !== 1 && components !== 3 && components !== 4) {
    return { ok: false, reason: 'UNSUPPORTED_CODING', coding: `${components} components` };
  }
  // Height 0 defers the height to a DNL marker after the first scan, unknown before decoding.
  if (width === 0 || height === 0) return { ok: false, reason: 'ZERO_SIZE' };
  return { ok: true, width, height, components, progressive: marker === SOF_PROGRESSIVE };
}
