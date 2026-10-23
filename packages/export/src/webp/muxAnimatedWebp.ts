import { ByteWriter } from '../ByteWriter';
import { ExportError } from '../ExportError';
import type { WebpFrameData } from './readWebpFrame';

/**
 * An animated WebP of `frames`, `durations` in milliseconds: VP8X (animation, and alpha when a frame has it), ANIM
 * (transparent background, looping forever), then one ANMF per frame over the whole canvas, not blended with the one
 * before, so each frame shows exactly its own pixels. Returns the file as parts.
 */
export function muxAnimatedWebp(
  width: number,
  height: number,
  frames: readonly WebpFrameData[],
  durations: readonly number[],
): Uint8Array<ArrayBuffer>[] {
  const alpha = frames.some((f) => f.alpha);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let body = 4;
  const vp8x = new ByteWriter()
    .ascii('VP8X')
    .u32(10, true)
    .u8((alpha ? 0x10 : 0) | 0x02)
    .u24(0)
    .u24(width - 1, true)
    .u24(height - 1, true)
    .toBytes();
  const anim = new ByteWriter().ascii('ANIM').u32(6, true).u32(0, true).u16(0, true).toBytes();
  parts.push(vp8x, anim);
  body += vp8x.length + anim.length;
  frames.forEach((frame, i) => {
    if (frame.width !== width || frame.height !== height)
      throw new ExportError('ENCODER_FAILED', `WebP frame ${i} is ${frame.width} × ${frame.height}`);
    const header = new ByteWriter()
      .ascii('ANMF')
      .u32(16 + frame.chunks.length, true)
      .u24(0, true)
      .u24(0, true)
      .u24(width - 1, true)
      .u24(height - 1, true)
      .u24(durations[i] ?? 0, true)
      // Blending bit set: do not blend; disposal none.
      .u8(0x02)
      .toBytes();
    parts.push(header, frame.chunks);
    body += header.length + frame.chunks.length;
  });
  parts.unshift(new ByteWriter().ascii('RIFF').u32(body, true).ascii('WEBP').toBytes());
  return parts;
}
