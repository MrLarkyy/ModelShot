import type { RenderedImage } from '@modelshot/pathtracer';
import { ByteWriter } from '../ByteWriter';
import type { ClipEncoder, ClipEncoderSettings } from '../ClipEncoder';
import { ExportError } from '../ExportError';
import { frameDurations } from '../frameDurations';
import { OutputParts } from '../OutputParts';
import { lzwEncode } from './lzwEncode';
import { quantizePalette, TRANSPARENT_INDEX } from './quantizePalette';

/** Browsers play a GIF delay under 2 centiseconds as 10: no frame is shorter (above 50 fps the clip plays at 50). */
export const MIN_GIF_DELAY_CS = 2;

/**
 * GIF89a looping forever (NETSCAPE2.0, count 0). Each frame has its own palette (`quantizePalette`), so frames stream
 * without a first pass over the clip; delays in centiseconds without drift (`frameDurations`); every frame is disposed
 * to the (transparent) background before the next, so nothing of it shows through the next one's transparent pixels.
 */
export class GifEncoder implements ClipEncoder {
  private readonly output = new OutputParts();
  private readonly delays: number[];
  private frame = 0;

  constructor(private readonly settings: ClipEncoderSettings) {
    const { width, height, fps, frames } = settings;
    this.delays = frameDurations(frames, fps, 100).map((d) => Math.max(MIN_GIF_DELAY_CS, d));
    const header = new ByteWriter()
      .ascii('GIF89a')
      .u16(width, true)
      .u16(height, true)
      // No global colour table, colour resolution 8 bits.
      .u8(0x70)
      .u8(0)
      .u8(0)
      .u8(0x21)
      .u8(0xff)
      .u8(11)
      .ascii('NETSCAPE2.0')
      .u8(3)
      .u8(1)
      .u16(0, true)
      .u8(0);
    this.output.push(header.toBytes());
  }

  addFrame(image: RenderedImage): Promise<void> {
    const { width, height, frames } = this.settings;
    if (image.width !== width || image.height !== height || this.frame >= frames) {
      return Promise.reject(new ExportError('ENCODER_FAILED', `GIF frame ${this.frame} does not fit the clip`));
    }
    const { palette, indices, transparent } = quantizePalette(image);
    const head = new ByteWriter()
      .u8(0x21)
      .u8(0xf9)
      .u8(4)
      // Disposal 2 (restore to background) for every frame: a later frame's transparent pixels never show this one.
      .u8((2 << 2) | (transparent ? 1 : 0))
      .u16(this.delays[this.frame] as number, true)
      .u8(transparent ? TRANSPARENT_INDEX : 0)
      .u8(0)
      .u8(0x2c)
      .u16(0, true)
      .u16(0, true)
      .u16(width, true)
      .u16(height, true)
      // A local colour table of 256 entries.
      .u8(0x80 | 7)
      .bytes(palette)
      .u8(8);
    const data = lzwEncode(indices, 8);
    const body = new Uint8Array(data.length + Math.ceil(data.length / 255) + 1);
    let at = 0;
    for (let start = 0; start < data.length; start += 255) {
      const block = data.subarray(start, Math.min(start + 255, data.length));
      body[at++] = block.length;
      body.set(block, at);
      at += block.length;
    }
    body[at] = 0;
    this.output.push(head.toBytes());
    this.output.push(body);
    this.frame++;
    return Promise.resolve();
  }

  finish(): Promise<Blob> {
    if (this.frame !== this.settings.frames) {
      return Promise.reject(
        new ExportError('ENCODER_FAILED', `GIF has ${this.frame} of ${this.settings.frames} frames`),
      );
    }
    this.output.push(new Uint8Array([0x3b]));
    return Promise.resolve(this.output.blob('image/gif'));
  }

  close(): void {
    this.output.clear();
  }
}
