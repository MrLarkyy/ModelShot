// JPEG header vectors shared by readJpegSize (formats) and imageHeaderSize (renderer-rt): both readers must agree.
import { encodeFlatJpeg } from '../fixtures/jpeg/encodeFlatJpeg.mjs';

/** A marker segment: FF, the marker, the big-endian length (payload + 2), the payload. */
export function jpegSegment(marker: number, payload: readonly number[] = []): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

/** A frame header SOFn of `components` components (id, sampling 1x1, table 0). */
export function jpegFrame(marker: number, width: number, height: number, components = 3, precision = 8): number[] {
  const specs = Array.from({ length: components }, (_, i) => [i + 1, 0x11, 0]).flat();
  return jpegSegment(marker, [precision, height >> 8, height & 0xff, width >> 8, width & 0xff, components, ...specs]);
}

export const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const SOS = jpegSegment(0xda, [1, 1, 0, 0, 63, 0]);

/** A minimal JPEG whose first frame is `frame`, after `before` (APPn, DQT, ...), then EOI. */
export function jpegWith(frame: readonly number[], before: readonly number[] = []): Uint8Array {
  return Uint8Array.from([...SOI, ...before, ...frame, ...EOI]);
}

export type JpegHeaderCase =
  | { readonly name: string; readonly bytes: Uint8Array; readonly width: number; readonly height: number }
  | { readonly name: string; readonly bytes: Uint8Array; readonly reason: string; readonly coding?: string };

const flat = encodeFlatJpeg(16, 8, [
  [100, 120, 140],
  [30, 200, 60],
]);
const sofAt = flat.findIndex((b, i) => b === 0xff && flat[i + 1] === 0xc0);

/** Readable headers with their size, and broken or unsupported ones with the `readJpegSize` reason. */
export const JPEG_HEADER_CASES: readonly JpegHeaderCase[] = [
  { name: 'a flat baseline file', bytes: flat, width: 16, height: 8 },
  { name: 'baseline', bytes: jpegWith(jpegFrame(0xc0, 640, 480)), width: 640, height: 480 },
  { name: 'extended sequential', bytes: jpegWith(jpegFrame(0xc1, 3, 5)), width: 3, height: 5 },
  { name: 'progressive', bytes: jpegWith(jpegFrame(0xc2, 65535, 1)), width: 65535, height: 1 },
  { name: 'greyscale', bytes: jpegWith(jpegFrame(0xc0, 7, 9, 1)), width: 7, height: 9 },
  { name: 'CMYK', bytes: jpegWith(jpegFrame(0xc0, 4, 4, 4)), width: 4, height: 4 },
  {
    name: 'APPn, COM, DQT and DHT before the frame',
    bytes: jpegWith(jpegFrame(0xc0, 20, 10), [
      ...jpegSegment(0xe0, [1, 2, 3]),
      ...jpegSegment(0xe1, new Array<number>(300).fill(0xff)),
      ...jpegSegment(0xfe, [0x68, 0x69]),
      ...jpegSegment(0xdb, new Array<number>(65).fill(1)),
      ...jpegSegment(0xc4, new Array<number>(17).fill(0)),
      ...jpegSegment(0xdd, [0, 4]),
    ]),
    width: 20,
    height: 10,
  },
  {
    name: 'fill bytes and RSTn between segments',
    bytes: jpegWith([0xff, 0xff, 0xff, ...jpegFrame(0xc0, 2, 3)], [0xff, 0xd3, 0xff, 0x01]),
    width: 2,
    height: 3,
  },
  {
    name: 'stray bytes and FF00 between segments',
    bytes: jpegWith(
      [0x12, 0xff, 0x00, 0x34, 0xff, 0xff, ...jpegFrame(0xc0, 6, 7)],
      [...jpegSegment(0xe0, [1]), 0x00, 0x00, 0xff, 0x00, 0x99],
    ),
    width: 6,
    height: 7,
  },
  { name: 'empty', bytes: new Uint8Array(0), reason: 'TRUNCATED' },
  { name: 'SOI only', bytes: Uint8Array.from(SOI), reason: 'TRUNCATED' },
  { name: 'not a JPEG', bytes: new TextEncoder().encode('GIF89a and more'), reason: 'NOT_JPEG' },
  { name: 'a second SOI', bytes: jpegWith(jpegFrame(0xc0, 1, 1), SOI), reason: 'NOT_JPEG' },
  {
    name: 'cut mid-segment',
    bytes: Uint8Array.from([...SOI, ...jpegSegment(0xe0, [1, 2, 3, 4]).slice(0, 5)]),
    reason: 'TRUNCATED',
  },
  { name: 'cut in a segment length', bytes: Uint8Array.from([...SOI, 0xff, 0xe0, 0x00]), reason: 'TRUNCATED' },
  { name: 'cut mid-frame', bytes: flat.slice(0, sofAt + 7), reason: 'TRUNCATED' },
  { name: 'cut before the frame components', bytes: flat.slice(0, sofAt + 12), reason: 'TRUNCATED' },
  {
    name: 'a frame shorter than its components',
    bytes: jpegWith(jpegSegment(0xc0, [8, 0, 1, 0, 1, 3, 1, 0x11, 0])),
    reason: 'TRUNCATED',
  },
  {
    name: 'a segment length below 2',
    bytes: Uint8Array.from([...SOI, 0xff, 0xe0, 0x00, 0x01, 0, 0]),
    reason: 'TRUNCATED',
  },
  { name: 'SOS before any frame', bytes: Uint8Array.from([...SOI, ...SOS, 0x12, 0x34, ...EOI]), reason: 'NO_SOF' },
  {
    name: 'EOI before any frame',
    bytes: Uint8Array.from([...SOI, ...jpegSegment(0xe0, [1]), ...EOI]),
    reason: 'NO_SOF',
  },
  { name: 'height 0 (DNL)', bytes: jpegWith(jpegFrame(0xc0, 16, 0)), reason: 'ZERO_SIZE' },
  { name: 'width 0', bytes: jpegWith(jpegFrame(0xc2, 0, 16)), reason: 'ZERO_SIZE' },
  {
    name: 'lossless (SOF3)',
    bytes: jpegWith(jpegFrame(0xc3, 8, 8)),
    reason: 'UNSUPPORTED_CODING',
    coding: 'lossless',
  },
  {
    name: 'hierarchical (SOF5)',
    bytes: jpegWith(jpegFrame(0xc5, 8, 8)),
    reason: 'UNSUPPORTED_CODING',
    coding: 'hierarchical',
  },
  {
    name: 'arithmetic (SOF9)',
    bytes: jpegWith(jpegFrame(0xc9, 8, 8)),
    reason: 'UNSUPPORTED_CODING',
    coding: 'arithmetic',
  },
  {
    name: 'arithmetic progressive (SOF10)',
    bytes: jpegWith(jpegFrame(0xca, 8, 8)),
    reason: 'UNSUPPORTED_CODING',
    coding: 'arithmetic progressive',
  },
  {
    name: '12-bit samples',
    bytes: jpegWith(jpegFrame(0xc1, 8, 8, 3, 12)),
    reason: 'UNSUPPORTED_CODING',
    coding: '12-bit',
  },
  {
    name: 'two components',
    bytes: jpegWith(jpegFrame(0xc0, 8, 8, 2)),
    reason: 'UNSUPPORTED_CODING',
    coding: '2 components',
  },
];
