export type VideoContainer = 'webm' | 'mp4';

/** A codec string of WebCodecs and the container's name for it. */
export interface VideoCodec {
  readonly codec: string;
  /** Matroska CodecID (webm), or `avc1` (mp4). */
  readonly containerCodec: 'V_VP9' | 'V_VP8' | 'avc1';
}

// VP9 levels by their largest picture in luma samples (VP9 specification, Annex A).
const VP9_LEVELS: readonly [string, number][] = [
  ['10', 36_864],
  ['11', 73_728],
  ['20', 122_880],
  ['21', 245_760],
  ['30', 552_960],
  ['31', 983_040],
  ['40', 2_228_224],
  ['50', 8_912_896],
  ['60', 35_651_584],
];

// H.264 levels by their largest frame in 16 x 16 macroblocks (Table A-1).
const AVC_LEVELS: readonly [string, number][] = [
  ['1f', 3_600],
  ['20', 5_120],
  ['28', 8_192],
  ['2a', 8_704],
  ['32', 22_080],
  ['33', 36_864],
  ['3c', 139_264],
];

// High, Main, then Constrained Baseline: an encoder offers some of them.
const AVC_PROFILES = ['6400', '4d00', '42e0'];

/**
 * Codecs to try for `container` at this size, best first: VP9 at the smallest level that holds the picture (and the
 * next), then VP8, for webm; H.264 High, Main and Constrained Baseline at the smallest level that holds it, for mp4.
 */
export function videoCodecCandidates(container: VideoContainer, width: number, height: number): VideoCodec[] {
  if (container === 'webm') {
    const at = Math.max(
      0,
      VP9_LEVELS.findIndex(([, size]) => width * height <= size),
    );
    const levels = VP9_LEVELS.slice(at, at + 2).map(([level]) => level);
    return [
      ...levels.map((level): VideoCodec => ({ codec: `vp09.00.${level}.08`, containerCodec: 'V_VP9' })),
      { codec: 'vp8', containerCodec: 'V_VP8' },
    ];
  }
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const side = Math.max(Math.ceil(width / 16), Math.ceil(height / 16));
  const level = AVC_LEVELS.find(([, frame]) => macroblocks <= frame && side * side <= frame * 8) ?? AVC_LEVELS.at(-1);
  const hex = level?.[0] ?? '3c';
  return AVC_PROFILES.map((profile): VideoCodec => ({ codec: `avc1.${profile}${hex}`, containerCodec: 'avc1' }));
}

/** About 0.25 bit per pixel and frame, so flat texels stay crisp, within what encoders accept. */
export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(40_000_000, Math.max(250_000, width * height * fps * 0.25)));
}
