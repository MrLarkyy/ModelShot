export type HdrErrorCode =
  /** More bytes than `HdrLimits.maxBytes`; checked before anything is read. */
  | 'TOO_LARGE'
  /** The file does not start with `#?RADIANCE` or `#?RGBE`. */
  | 'SIGNATURE'
  /** No blank line ending the header within `HdrLimits.maxHeaderBytes`, or a resolution line that is not one. */
  | 'HEADER'
  /** A `FORMAT=` other than `32-bit_rle_rgbe` (such as `32-bit_rle_xyze`). */
  | 'FORMAT'
  /** A resolution line other than `-Y <height> +X <width>` (rows top down, columns left to right). */
  | 'ORIENTATION'
  /** A width or height of 0, a width over `HdrLimits.maxWidth` or more pixels than `HdrLimits.maxPixels`. */
  | 'SIZE'
  /** The pixel data ends before the last scanline. */
  | 'TRUNCATED'
  /** A malformed run-length scanline: old-style runs, a run or literal past the scanline's end, a zero count. */
  | 'RLE'
  /** A pixel brighter than `HdrLimits.maxRadiance`. */
  | 'RANGE';

const TITLES: Readonly<Record<HdrErrorCode, string>> = {
  TOO_LARGE: 'HDR file too large',
  SIGNATURE: 'Not a Radiance HDR file',
  HEADER: 'Invalid HDR header',
  FORMAT: 'Unsupported HDR pixel format',
  ORIENTATION: 'Unsupported HDR orientation',
  SIZE: 'Unsupported HDR size',
  TRUNCATED: 'HDR file truncated',
  RLE: 'Invalid HDR run-length data',
  RANGE: 'HDR radiance out of range',
};

/**
 * The only error `decodeRadianceHdr` throws for bad bytes. The message names the limit or rule and the byte offset or
 * scanline, never file content.
 */
export class HdrError extends Error {
  override readonly name = 'HdrError';
  readonly code: HdrErrorCode;

  constructor(code: HdrErrorCode, detail: string) {
    super(`${TITLES[code]}: ${detail}`);
    this.code = code;
  }
}
