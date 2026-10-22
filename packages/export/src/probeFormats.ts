import type { ClipFormat } from './ExportOptions';
import { FORMAT_FALLBACKS, type FormatAvailability } from './selectFormat';
import { videoBitrate, videoCodecCandidates, type VideoCodec, type VideoContainer } from './video/videoCodecs';

/** A video codec WebCodecs accepted for the clip, with the configuration it accepted. */
export interface VideoChoice {
  readonly codec: VideoCodec;
  readonly config: VideoEncoderConfig;
}

export interface ProbedFormats {
  readonly availability: FormatAvailability;
  readonly video: Partial<Record<VideoContainer, VideoChoice>>;
}

async function webpAvailable(): Promise<boolean> {
  if (typeof OffscreenCanvas !== 'function') return false;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    canvas.getContext('2d');
    return (await canvas.convertToBlob({ type: 'image/webp', quality: 1 })).type === 'image/webp';
  } catch {
    return false;
  }
}

async function videoChoice(
  container: VideoContainer,
  width: number,
  height: number,
  fps: number,
): Promise<VideoChoice | null> {
  if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') return null;
  for (const codec of videoCodecCandidates(container, width, height, fps)) {
    const config: VideoEncoderConfig = {
      codec: codec.codec,
      width,
      height,
      framerate: fps,
      bitrate: videoBitrate(width, height, fps),
      alpha: 'discard',
      latencyMode: 'quality',
      ...(container === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return { codec, config };
    } catch {
      // A codec string this browser does not parse: the next one.
    }
  }
  return null;
}

/**
 * What this browser can encode of `requested`'s fallback chain at this size and rate, probing only that chain:
 * WebP through OffscreenCanvas, WebM and MP4 through `VideoEncoder.isConfigSupported`. Nothing is fetched.
 */
export async function probeFormats(
  requested: ClipFormat,
  width: number,
  height: number,
  fps: number,
): Promise<ProbedFormats> {
  const chain = FORMAT_FALLBACKS[requested];
  const video: Partial<Record<VideoContainer, VideoChoice>> = {};
  const unavailable = (reason: string) => ({ available: false, reason });
  const availability: Record<ClipFormat, { available: boolean; reason?: string }> = {
    apng: { available: true },
    gif: { available: true },
    webp: unavailable('not probed'),
    webm: unavailable('not probed'),
    mp4: unavailable('not probed'),
  };
  if (chain.includes('webp')) {
    availability.webp = (await webpAvailable()) ? { available: true } : unavailable('this browser cannot encode WebP');
  }
  for (const container of ['mp4', 'webm'] as const) {
    if (!chain.includes(container)) continue;
    const choice = await videoChoice(container, width, height, fps);
    if (choice) {
      video[container] = choice;
      availability[container] = { available: true };
    } else {
      const codecs = container === 'mp4' ? 'H.264' : 'VP9 or VP8';
      availability[container] = unavailable(
        typeof VideoEncoder === 'function'
          ? `this browser cannot encode ${codecs} video at ${width} × ${height}`
          : 'this browser has no WebCodecs video encoder',
      );
    }
  }
  return { availability, video };
}
