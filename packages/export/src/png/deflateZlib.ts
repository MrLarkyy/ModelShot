import { adler32 } from './checksums';

const STORED_BLOCK = 65535;

/** A zlib stream of `data` in stored (uncompressed) blocks: valid everywhere, as large as the input. */
export function storedZlib(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const blocks = Math.max(1, Math.ceil(data.length / STORED_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  const view = new DataView(out.buffer);
  // CMF 0x78 (deflate, 32 KiB window), FLG 0x01: no dictionary, fastest level, (0x7801 % 31) === 0.
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let block = 0; block < blocks; block++) {
    const start = block * STORED_BLOCK;
    const length = Math.min(STORED_BLOCK, data.length - start);
    out[at] = block === blocks - 1 ? 1 : 0;
    view.setUint16(at + 1, length, true);
    view.setUint16(at + 3, ~length & 0xffff, true);
    out.set(data.subarray(start, start + length), at + 5);
    at += 5 + length;
  }
  view.setUint32(at, adler32(data));
  return out;
}

/**
 * A zlib stream (RFC 1950) of `data`: the browser's CompressionStream('deflate') where there is one, else stored
 * blocks. Nothing is loaded from anywhere: both are local.
 */
export async function deflateZlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream !== 'function') return storedZlib(data);
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
