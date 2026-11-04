export interface JpegSegment {
  readonly marker: number;
  /** Index of the first payload byte (after the 2 length bytes). */
  readonly start: number;
  /** One past the last payload byte, cut to the bytes available. */
  readonly end: number;
  /** The segment's declared length (payload + 2), its length bytes included. */
  readonly length: number;
  /** Whether the declared length reaches past the bytes. */
  readonly truncated: boolean;
}

const MARKER = 0xff;

/**
 * Calls `visit` for each marker segment of JPEG bytes (after SOI) in order, by libjpeg's rules: any byte that is not
 * FF between segments is skipped, runs of FF are fill, FF00, TEM and RSTn carry no length. The walk stops, never
 * past the bytes, at a second SOI, EOI, SOS (scan data), a length below 2, a cut length field, or when `visit`
 * returns true. Every step moves forward, so it ends within `bytes.length` steps.
 */
export function walkJpegSegments(bytes: Uint8Array, visit: (segment: JpegSegment) => boolean | void): void {
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== MARKER) {
      at++;
      continue;
    }
    while (at < bytes.length && bytes[at] === MARKER) at++;
    if (at >= bytes.length) return;
    const marker = bytes[at]!;
    if (marker === 0 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at++;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return;
    if (at + 2 >= bytes.length) return;
    const length = (bytes[at + 1]! << 8) | bytes[at + 2]!;
    if (length < 2) return;
    const after = at + 1 + length;
    if (visit({ marker, start: at + 3, end: Math.min(bytes.length, after), length, truncated: after > bytes.length }))
      return;
    at = after;
  }
}
