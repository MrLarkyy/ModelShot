export type VideoContainer = 'webm' | 'mp4';

/** A codec string of WebCodecs and the container's name for it. */
export interface VideoCodec {
  readonly codec: string;
  /** Matroska CodecID (webm), or `avc1` (mp4). */
  readonly containerCodec: 'V_VP9' | 'V_VP8' | 'avc1';
}

// VP9 levels (VP9 specification, Annex A): the largest picture and the largest rate, in luma samples.
const VP9_LEVELS: readonly [level: string, picture: number, rate: number][] = [
  ['10', 36_864, 829_440],
  ['11', 73_728, 2_764_800],
  ['20', 122_880, 4_608_000],
  ['21', 245_760, 9_216_000],
  ['30', 552_960, 20_736_000],
  ['31', 983_040, 36_864_000],
  ['40', 2_228_224, 83_558_400],
  ['41', 2_228_224, 160_432_128],
  ['50', 8_912_896, 311_951_360],
  ['51', 8_912_896, 588_251_136],
  ['52', 8_912_896, 1_176_502_272],
  ['60', 35_651_584, 1_176_502_272],
  ['61', 35_651_584, 2_353_004_544],
  ['62', 35_651_584, 4_706_009_088],
];

// H.264 levels (Table A-1): the largest frame (MaxFS) and rate (MaxMBPS), in 16 x 16 macroblocks.
const AVC_LEVELS: readonly [level: string, frame: number, rate: number][] = [
  ['1f', 3_600, 108_000],
  ['20', 5_120, 216_000],
  ['28', 8_192, 245_760],
  ['2a', 8_704, 522_240],
  ['32', 22_080, 589_824],
  ['33', 36_864, 983_040],
  ['34', 36_864, 2_073_600],
  ['3c', 139_264, 4_177_920],
  ['3d', 139_264, 8_355_840],
  ['3e', 139_264, 16_711_680],
];

// High, Main, then Constrained Baseline: an encoder offers some of them.
const AVC_PROFILES = ['6400', '4d00', '42e0'];

/**
 * Codecs to try for `container` at this size and frame rate, best first: VP9 at the smallest level whose picture size
 * and luma sample rate hold the clip (and the next), then VP8, for webm; H.264 High, Main and Constrained Baseline at
 * the smallest level whose frame size (also per side), and macroblock rate hold it, for mp4.
 */
export function videoCodecCandidates(
  container: VideoContainer,
  width: number,
  height: number,
  fps: number,
): VideoCodec[] {
  if (container === 'webm') {
    const picture = width * height;
    const found = VP9_LEVELS.findIndex(([, size, rate]) => picture <= size && picture * fps <= rate);
    const at = found < 0 ? VP9_LEVELS.length - 1 : found;
    const levels = VP9_LEVELS.slice(at, at + 2).map(([level]) => level);
    return [
      ...levels.map((level): VideoCodec => ({ codec: `vp09.00.${level}.08`, containerCodec: 'V_VP9' })),
      { codec: 'vp8', containerCodec: 'V_VP8' },
    ];
  }
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const side = Math.max(Math.ceil(width / 16), Math.ceil(height / 16));
  const level =
    AVC_LEVELS.find(
      ([, frame, rate]) => macroblocks <= frame && side * side <= frame * 8 && macroblocks * fps <= rate,
    ) ?? AVC_LEVELS.at(-1);
  const hex = level?.[0] ?? '3e';
  return AVC_PROFILES.map((profile): VideoCodec => ({ codec: `avc1.${profile}${hex}`, containerCodec: 'avc1' }));
}

/**
 * About 0.25 bit per pixel and frame, within what encoders accept. Video stays lossy all the same: 4:2:0 chroma and the
 * codec's blocks move colours at texel edges (tens of levels); APNG and lossless WebP keep pixel art exact.
 */
export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(40_000_000, Math.max(250_000, width * height * fps * 0.25)));
}
