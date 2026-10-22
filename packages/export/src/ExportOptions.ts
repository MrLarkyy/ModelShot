import type { SetSceneOptions } from '@modelshot/pathtracer';
import type { SceneCamera, SceneAnimationLoop } from '@modelshot/scene';

/** File formats of an export: `png` for a still, every other one for a clip. */
export type ExportFormat = 'png' | 'apng' | 'gif' | 'webp' | 'webm' | 'mp4';

/** Formats a clip can be encoded in. */
export type ClipFormat = Exclude<ExportFormat, 'png'>;

/** What every export renders with: the path tracer's request and the scene options of its `setScene`. */
export interface RenderSettings {
  /** Output size in pixels, integers 1..`MAX_EXPORT_SIDE`, at most `MAX_EXPORT_PIXELS` together. */
  readonly width: number;
  readonly height: number;
  /** The view; a turntable and an animation take its angles and projection and frame the model themselves. */
  readonly camera: SceneCamera;
  /** Samples per pixel, integer 1..65536 (`MAX_SAMPLES` of the path tracer). */
  readonly samples: number;
  /** Integer 0..2^32 − 1; every frame of a clip uses it, so the noise stands still instead of shimmering. */
  readonly seed: number;
  /** Integer 1..4, default 1 (`RenderRequest.supersample`). */
  readonly supersample?: number;
  /** Default `false` (`RenderRequest.denoise`). */
  readonly denoise?: boolean;
  /**
   * Default `false`: alpha 0 where camera rays leave the scene and through cut-out texels, the shadow catcher as black
   * with alpha 1 − shade (`RenderRequest.transparent`). Video formats are opaque: there it renders opaque, with an
   * `ALPHA_DROPPED` warning.
   */
  readonly transparent?: boolean;
  /** Passed to `setScene` (emission, shadow catcher). */
  readonly scene?: SetSceneOptions;
}

export interface StillExportOptions extends RenderSettings {
  readonly kind: 'still';
  /** Default `png`, the only still format. */
  readonly format?: 'png';
}

/** How a clip's camera is placed. */
export type ClipFraming =
  /** The given camera's angles and projection, the distance fitted to the model (default). */
  | 'fit'
  /** The given camera as it is: a turntable orbits its position around its target. */
  | 'camera';

interface ClipSettings extends RenderSettings {
  readonly format: ClipFormat;
  /** Frames per second, integer 1..`MAX_CLIP_FPS`. */
  readonly fps: number;
  /** Default `fit`. */
  readonly framing?: ClipFraming;
}

/** A full turn around the model's vertical axis, seamless when looped. */
export interface TurntableExportOptions extends ClipSettings {
  readonly kind: 'turntable';
  /** Integer 2..`MAX_CLIP_FRAMES`, covering 360° in equal steps; the last frame is one step before the first. */
  readonly frames: number;
}

/** One animation of the document, played from its start. */
export interface AnimationExportOptions extends ClipSettings {
  readonly kind: 'animation';
  /** Index into `SceneDocument.animations`, or the name of the first one with that name. */
  readonly animation: number | string;
  /** Seconds of playback, in (0, `MAX_CLIP_SECONDS`]; default the animation's length. */
  readonly seconds?: number;
  /** Overrides the animation's loop mode. */
  readonly loop?: SceneAnimationLoop;
}

export type ClipExportOptions = TurntableExportOptions | AnimationExportOptions;

export type ExportOptions = StillExportOptions | ClipExportOptions;

/** Where an export stands; `fraction` only grows and ends at 1. */
export interface ExportProgress {
  readonly phase: 'render' | 'encode';
  /** The frame being rendered or encoded, from 0. */
  readonly frame: number;
  readonly frames: number;
  /** Samples done of the current frame. */
  readonly samplesDone: number;
  readonly samples: number;
  /** 0..1 of the whole export. */
  readonly fraction: number;
}

export interface ExportRunOptions {
  /** Aborting rejects with `ExportError` `CANCELLED` and stops the path tracer within one step. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExportProgress) => void;
}

export type ExportWarningCode = 'FORMAT_FALLBACK' | 'ALPHA_DROPPED';

export interface ExportWarning {
  readonly code: ExportWarningCode;
  /** An English sentence for the user. */
  readonly message: string;
  /** `FORMAT_FALLBACK`: the format asked for and the one the file has. */
  readonly requested?: ExportFormat;
  readonly used?: ExportFormat;
}

/** The encoded file: the Blob stays in the page; downloading or sharing it is the caller's. */
export interface ExportResult {
  readonly blob: Blob;
  readonly format: ExportFormat;
  readonly mimeType: string;
  /** Without the dot. */
  readonly extension: string;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly warnings: readonly ExportWarning[];
}
