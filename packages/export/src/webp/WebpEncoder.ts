import type { RenderedImage } from '@modelshot/pathtracer';
import type { ClipEncoder, ClipEncoderSettings } from '../ClipEncoder';
import { ExportError } from '../ExportError';
import { frameDurations } from '../frameDurations';
import { OutputParts } from '../OutputParts';
import { encodeWebpFrame } from './encodeWebpFrame';
import { muxAnimatedWebp, readWebpFrame, type WebpFrameData } from './muxAnimatedWebp';

/** Animated WebP: each frame encoded by the browser (`encodeWebpFrame`), muxed with durations in milliseconds. */
export class WebpEncoder implements ClipEncoder {
  private readonly frames: WebpFrameData[] = [];
  private readonly budget = new OutputParts();

  constructor(
    private readonly settings: ClipEncoderSettings,
    private readonly encodeFrame: (image: RenderedImage) => Promise<Uint8Array<ArrayBuffer>> = encodeWebpFrame,
  ) {}

  async addFrame(image: RenderedImage): Promise<void> {
    const { width, height, frames } = this.settings;
    if (image.width !== width || image.height !== height || this.frames.length >= frames) {
      throw new ExportError('ENCODER_FAILED', `WebP frame ${this.frames.length} does not fit the clip`);
    }
    const frame = readWebpFrame(await this.encodeFrame(image));
    this.budget.reserve(frame.chunks.length + 24);
    this.budget.push(frame.chunks);
    this.frames.push(frame);
  }

  finish(): Promise<Blob> {
    const { width, height, fps, frames } = this.settings;
    if (this.frames.length !== frames) {
      return Promise.reject(new ExportError('ENCODER_FAILED', `WebP has ${this.frames.length} of ${frames} frames`));
    }
    const parts = muxAnimatedWebp(width, height, this.frames, frameDurations(frames, fps, 1000));
    return Promise.resolve(new Blob(parts, { type: 'image/webp' }));
  }

  close(): void {
    this.frames.length = 0;
    this.budget.clear();
  }
}
