export const packageName = '@modelshot/export';

export {
  checkExportOptions,
  type CheckedAnimationOptions,
  type CheckedClipOptions,
  type CheckedExportOptions,
  type CheckedRenderSettings,
  type CheckedStillOptions,
  type CheckedTurntableOptions,
} from './checkExportOptions';
export { ExportError, type ExportErrorCode } from './ExportError';
export {
  MAX_CLIP_FPS,
  MAX_CLIP_FRAMES,
  MAX_CLIP_RAW_BYTES,
  MAX_CLIP_SECONDS,
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
  MAX_OUTPUT_BYTES,
} from './exportLimits';
export type {
  AnimationExportOptions,
  ClipExportOptions,
  ClipFormat,
  ClipFraming,
  ExportFormat,
  ExportOptions,
  ExportProgress,
  ExportResult,
  ExportRunOptions,
  ExportWarning,
  ExportWarningCode,
  RenderSettings,
  StillExportOptions,
  TurntableExportOptions,
} from './ExportOptions';
export { exportClip } from './exportClip';
export { exportStill } from './exportStill';
export type { FrameRenderer } from './FrameRenderer';
export { framePose } from './framePose';
export { planFrames, type FramePlan, type PlannedFrame } from './planFrames';
export {
  FORMAT_FALLBACKS,
  FORMAT_NAMES,
  selectFormat,
  type FormatAvailability,
  type FormatSelection,
} from './selectFormat';
