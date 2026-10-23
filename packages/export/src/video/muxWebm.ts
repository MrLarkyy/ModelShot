import { ByteWriter } from '../ByteWriter';
import { ExportError } from '../ExportError';
import type { EncodedFrame } from './EncodedFrame';

/** An EBML element: an id (with its length marker bits, as the specification writes it) and its payload. */
interface Element {
  readonly id: number;
  readonly payload: readonly (Element | Uint8Array<ArrayBuffer>)[];
}

const el = (id: number, ...payload: (Element | Uint8Array<ArrayBuffer>)[]): Element => ({ id, payload });

const uint = (id: number, value: number): Element => {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return el(id, new Uint8Array(bytes));
};

const float = (id: number, value: number): Element => el(id, new ByteWriter().f64(value).toBytes());
const text = (id: number, value: string): Element => el(id, new ByteWriter().ascii(value).toBytes());

function payloadSize(element: Element): number {
  let total = 0;
  for (const part of element.payload) total += part instanceof Uint8Array ? part.length : elementSize(part);
  return total;
}

function idBytes(id: number): number[] {
  const bytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return bytes;
}

/** The shortest EBML variable-length size of `size` (all-ones is reserved for "unknown"). */
function sizeBytes(size: number): number[] {
  let length = 1;
  while (size >= 2 ** (7 * length) - 1) length++;
  if (length > 8) throw new ExportError('ENCODER_FAILED', 'a WebM element is too large');
  const bytes: number[] = [];
  let v = size;
  for (let i = 0; i < length; i++) {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  bytes[0] = (bytes[0] as number) | (0x80 >> (length - 1));
  return bytes;
}

function elementSize(element: Element): number {
  const size = payloadSize(element);
  return idBytes(element.id).length + sizeBytes(size).length + size;
}

function write(element: Element, parts: Uint8Array<ArrayBuffer>[]): void {
  parts.push(new Uint8Array([...idBytes(element.id), ...sizeBytes(payloadSize(element))]));
  for (const part of element.payload) {
    if (part instanceof Uint8Array) parts.push(part);
    else write(part, parts);
  }
}

export interface WebmTrack {
  readonly codecId: 'V_VP9' | 'V_VP8';
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

const MS = 1000;

/**
 * A WebM file of one video track: EBML header, Segment with Info (millisecond timecodes, the clip's duration), Tracks
 * and Clusters of SimpleBlocks, a new Cluster at each key frame (and before a block's time would overflow its 16 bits).
 * The frames must come in presentation order, the first a key frame, else `ENCODER_FAILED`. Returns the file as parts.
 */
export function muxWebm(track: WebmTrack, frames: readonly EncodedFrame[]): Uint8Array<ArrayBuffer>[] {
  if (frames.length === 0 || !frames[0]?.key)
    throw new ExportError('ENCODER_FAILED', 'the video has no first key frame');
  const clusters: Element[] = [];
  let cluster: { start: number; blocks: Element[] } | null = null;
  let last = -1;
  const flush = (): void => {
    if (cluster) clusters.push(el(0x1f43b675, uint(0xe7, cluster.start), ...cluster.blocks));
  };
  for (const frame of frames) {
    const time = Math.round(frame.timestamp / MS);
    if (frame.timestamp <= last) throw new ExportError('ENCODER_FAILED', 'video frames came out of order');
    last = frame.timestamp;
    if (!cluster || frame.key || time - cluster.start > 32_767) {
      flush();
      cluster = { start: time, blocks: [] };
    }
    const header = new ByteWriter()
      .u8(0x81)
      .i16(time - cluster.start)
      .u8(frame.key ? 0x80 : 0)
      .toBytes();
    cluster.blocks.push(el(0xa3, header, frame.data));
  }
  flush();
  const header = el(
    0x1a45dfa3,
    uint(0x4286, 1),
    uint(0x42f7, 1),
    uint(0x42f2, 4),
    uint(0x42f3, 8),
    text(0x4282, 'webm'),
    uint(0x4287, 4),
    uint(0x4285, 2),
  );
  const segment = el(
    0x18538067,
    el(
      0x1549a966,
      uint(0x2ad7b1, 1_000_000),
      text(0x4d80, 'ModelShot'),
      text(0x5741, 'ModelShot'),
      float(0x4489, (frames.length * MS) / track.fps),
    ),
    el(
      0x1654ae6b,
      el(
        0xae,
        uint(0xd7, 1),
        uint(0x73c5, 1),
        uint(0x83, 1),
        text(0x86, track.codecId),
        uint(0x23e383, Math.round(1e9 / track.fps)),
        el(0xe0, uint(0xb0, track.width), uint(0xba, track.height)),
      ),
    ),
    ...clusters,
  );
  const parts: Uint8Array<ArrayBuffer>[] = [];
  write(header, parts);
  write(segment, parts);
  return parts;
}
