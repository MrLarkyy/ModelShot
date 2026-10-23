import { ExportError } from '../ExportError';

/** The image chunks of one still WebP (ALPH and VP8, or VP8L), as an ANMF frame carries them. */
export interface WebpFrameData {
  /** The chunks, each with its header and padding. */
  readonly chunks: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  /** An ALPH chunk, or VP8L (whose header flags alpha). */
  readonly alpha: boolean;
}

const fourCC = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);

function failed(why: string): ExportError {
  return new ExportError('ENCODER_FAILED', `the browser's WebP is unusable: ${why}`);
}

/** Size of a lossy VP8 or lossless VP8L bitstream, from its frame header. */
function bitstreamSize(type: string, data: Uint8Array): { width: number; height: number } {
  if (type === 'VP8L') {
    if (data[0] !== 0x2f || data.length < 5) throw failed('a VP8L chunk without its signature');
    const bits = (data[1] ?? 0) | ((data[2] ?? 0) << 8) | ((data[3] ?? 0) << 16) | ((data[4] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
    throw failed('a VP8 chunk without its start code');
  }
  return {
    width: ((data[6] ?? 0) | ((data[7] ?? 0) << 8)) & 0x3fff,
    height: ((data[8] ?? 0) | ((data[9] ?? 0) << 8)) & 0x3fff,
  };
}

/** The image chunks of a still WebP file (simple or VP8X); anything else throws `ENCODER_FAILED`. */
export function readWebpFrame(file: Uint8Array): WebpFrameData {
  if (file.length < 20 || fourCC(file, 0) !== 'RIFF' || fourCC(file, 8) !== 'WEBP') throw failed('no RIFF WEBP header');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const end = Math.min(file.length, 8 + view.getUint32(4, true));
  const kept: Uint8Array[] = [];
  let alpha = false;
  let size: { width: number; height: number } | null = null;
  for (let at = 12; at + 8 <= end;) {
    const type = fourCC(file, at);
    const length = view.getUint32(at + 4, true);
    const padded = 8 + length + (length & 1);
    if (at + 8 + length > end) throw failed(`a ${type} chunk runs past the file`);
    if (type === 'ALPH' || type === 'VP8 ' || type === 'VP8L') {
      kept.push(file.subarray(at, Math.min(at + padded, end)));
      if (type === 'ALPH' || type === 'VP8L') alpha = true;
      if (type !== 'ALPH') size = bitstreamSize(type, file.subarray(at + 8, at + 8 + length));
    }
    at += padded;
  }
  if (!size) throw failed('no VP8 or VP8L image');
  const chunks = new Uint8Array(kept.reduce((n, c) => n + c.length + (c.length & 1), 0));
  let at = 0;
  for (const chunk of kept) {
    chunks.set(chunk, at);
    at += chunk.length + (chunk.length & 1);
  }
  return { chunks, alpha, ...size };
}
