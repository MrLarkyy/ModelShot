import type { RenderedImage } from '@modelshot/pathtracer';
import type { ClipEncoder, ClipEncoderSettings } from '../ClipEncoder';
import { ExportError } from '../ExportError';
import { OutputParts } from '../OutputParts';
import { yieldToEventLoop } from '../yieldToEventLoop';
import type { EncodedFrame } from './EncodedFrame';
import { muxMp4 } from './muxMp4';
import { muxWebm } from './muxWebm';
import type { VideoCodec, VideoContainer } from './videoCodecs';

/** Frames waiting in the browser's encoder before addFrame waits for it. */
const MAX_QUEUE = 4;

function failure(error: unknown): ExportError {
  if (error instanceof ExportError) return error;
  return new ExportError(
    'ENCODER_FAILED',
    `the browser's video encoder failed: ${error instanceof Error ? error.message : String(error)}`,
    undefined,
    { cause: error },
  );
}

/**
 * WebM or MP4 through WebCodecs' VideoEncoder with a configuration `probeFormats` found supported: opaque frames (the
 * export renders video opaque), a key frame every second, the encoded frames muxed by our own `muxWebm` or `muxMp4`.
 */
export class VideoClipEncoder implements ClipEncoder {
  private readonly encoder: VideoEncoder;
  private readonly frames: EncodedFrame[] = [];
  private readonly budget = new OutputParts();
  private avcC: Uint8Array<ArrayBuffer> | null = null;
  private error: ExportError | null = null;
  private frame = 0;

  constructor(
    private readonly settings: ClipEncoderSettings,
    private readonly container: VideoContainer,
    private readonly codec: VideoCodec,
    config: VideoEncoderConfig,
  ) {
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => this.take(chunk, metadata),
      error: (error) => {
        this.error ??= failure(error);
      },
    });
    try {
      this.encoder.configure(config);
    } catch (error) {
      this.close();
      throw failure(error);
    }
  }

  async addFrame(image: RenderedImage): Promise<void> {
    const { width, height, fps, frames } = this.settings;
    if (image.width !== width || image.height !== height || this.frame >= frames) {
      throw new ExportError('ENCODER_FAILED', `video frame ${this.frame} does not fit the clip`);
    }
    this.check();
    const timestamp = Math.round((this.frame * 1e6) / fps);
    const next = Math.round(((this.frame + 1) * 1e6) / fps);
    const frame = new VideoFrame(new Uint8Array(image.data), {
      format: 'RGBX',
      codedWidth: width,
      codedHeight: height,
      timestamp,
      duration: next - timestamp,
    });
    try {
      this.encoder.encode(frame, { keyFrame: this.frame % fps === 0 });
    } catch (error) {
      throw failure(error);
    } finally {
      frame.close();
    }
    this.frame++;
    while (this.encoder.encodeQueueSize > MAX_QUEUE && this.encoder.state === 'configured') await yieldToEventLoop();
    this.check();
  }

  async finish(): Promise<Blob> {
    try {
      await this.encoder.flush();
    } catch (error) {
      throw failure(this.error ?? error);
    }
    this.check();
    this.encoder.close();
    const { width, height, fps, frames } = this.settings;
    if (this.frames.length !== frames) {
      throw new ExportError('ENCODER_FAILED', `the video encoder gave ${this.frames.length} of ${frames} frames`);
    }
    if (this.container === 'webm') {
      const codecId = this.codec.containerCodec === 'V_VP8' ? 'V_VP8' : 'V_VP9';
      return new Blob(muxWebm({ codecId, width, height, fps }, this.frames), { type: 'video/webm' });
    }
    if (!this.avcC) throw new ExportError('ENCODER_FAILED', 'the H.264 encoder gave no decoder configuration');
    return new Blob(muxMp4({ width, height, fps, avcC: this.avcC }, this.frames), { type: 'video/mp4' });
  }

  close(): void {
    if (this.encoder.state !== 'closed') this.encoder.close();
    this.frames.length = 0;
    this.budget.clear();
  }

  private check(): void {
    if (this.error) throw this.error;
  }

  private take(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    try {
      this.budget.reserve(chunk.byteLength);
    } catch (error) {
      this.error ??= failure(error);
      return;
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.budget.push(data);
    this.frames.push({ data, timestamp: chunk.timestamp, key: chunk.type === 'key' });
    const description = metadata?.decoderConfig?.description;
    if (description && !this.avcC) {
      const bytes = ArrayBuffer.isView(description)
        ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
        : new Uint8Array(description);
      this.avcC = new Uint8Array(bytes);
    }
  }
}
