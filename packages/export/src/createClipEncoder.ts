import type { ClipEncoder, ClipEncoderSettings } from './ClipEncoder';
import { ExportError } from './ExportError';
import type { ClipFormat } from './ExportOptions';
import type { VideoChoice } from './probeFormats';

/**
 * The encoder of `format`, loaded on demand: the encoders stay out of the entry chunk, so a page that imports the
 * export API but never exports pays only for this switch. `video` is the probed codec of a webm or mp4.
 */
export async function createClipEncoder(
  format: ClipFormat,
  settings: ClipEncoderSettings,
  video?: VideoChoice,
): Promise<ClipEncoder> {
  switch (format) {
    case 'apng': {
      const { ApngEncoder } = await import('./png/ApngEncoder');
      return new ApngEncoder(settings);
    }
    case 'gif': {
      const { GifEncoder } = await import('./gif/GifEncoder');
      return new GifEncoder(settings);
    }
    case 'webp': {
      const { WebpEncoder } = await import('./webp/WebpEncoder');
      return new WebpEncoder(settings);
    }
    case 'webm':
    case 'mp4': {
      if (!video) throw new ExportError('UNSUPPORTED_FORMAT', `no ${format} codec was found`, 'format');
      const { VideoClipEncoder } = await import('./video/VideoClipEncoder');
      return new VideoClipEncoder(settings, format, video.codec, video.config);
    }
  }
}
