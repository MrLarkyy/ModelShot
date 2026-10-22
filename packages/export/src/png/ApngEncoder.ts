import type { RenderedImage } from '@modelshot/pathtracer';
import { ByteWriter } from '../ByteWriter';
import type { ClipEncoder, ClipEncoderSettings } from '../ClipEncoder';
import { ExportError } from '../ExportError';
import { OutputParts } from '../OutputParts';
import { deflateZlib } from './deflateZlib';
import { filterScanlines } from './filterScanlines';
import { ihdr, PNG_SIGNATURE, pngChunk } from './pngChunks';

/**
 * Animated PNG, lossless with full alpha: acTL (the frame count, looping forever), then per frame an fcTL (the whole
 * canvas, 1 / fps seconds, no dispose, blend SOURCE so a transparent pixel replaces the one before) and its image,
 * IDAT for the first frame (what a viewer without APNG shows) and fdAT after.
 */
export class ApngEncoder implements ClipEncoder {
  private readonly output = new OutputParts();
  private sequence = 0;
  private frame = 0;

  constructor(
    private readonly settings: ClipEncoderSettings,
    private readonly deflate: (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>> = deflateZlib,
  ) {
    const { width, height, frames } = settings;
    this.output.push(PNG_SIGNATURE.slice());
    this.output.push(ihdr(width, height));
    this.output.push(pngChunk('acTL', new ByteWriter().u32(frames).u32(0).toBytes()));
  }

  async addFrame(image: RenderedImage): Promise<void> {
    const { width, height, fps, frames } = this.settings;
    if (image.width !== width || image.height !== height || this.frame >= frames) {
      throw new ExportError('ENCODER_FAILED', `APNG frame ${this.frame} does not fit the clip`);
    }
    const compressed = await this.deflate(filterScanlines(image));
    const control = new ByteWriter()
      .u32(this.sequence++)
      .u32(width)
      .u32(height)
      .u32(0)
      .u32(0)
      .u16(1)
      .u16(fps)
      .u8(0)
      .u8(0)
      .toBytes();
    this.output.push(pngChunk('fcTL', control));
    if (this.frame === 0) {
      this.output.push(pngChunk('IDAT', compressed));
    } else {
      this.output.push(pngChunk('fdAT', new ByteWriter().u32(this.sequence++).toBytes(), compressed));
    }
    this.frame++;
  }

  finish(): Promise<Blob> {
    if (this.frame !== this.settings.frames) {
      return Promise.reject(
        new ExportError('ENCODER_FAILED', `APNG has ${this.frame} of ${this.settings.frames} frames`),
      );
    }
    this.output.push(pngChunk('IEND', new Uint8Array(0)));
    return Promise.resolve(this.output.blob('image/apng'));
  }

  close(): void {
    this.output.clear();
  }
}
