import type { RenderedImage } from '@modelshot/pathtracer';

/** What a clip encoder knows before the first frame. */
export interface ClipEncoderSettings {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
}

/**
 * Encodes a clip one frame at a time, keeping only compressed output, so a clip's frames are never all in memory.
 * `close` releases what an unfinished encoder holds (an abort or an error).
 */
export interface ClipEncoder {
  addFrame(image: RenderedImage): Promise<void>;
  finish(): Promise<Blob>;
  close(): void;
}
