export const packageName = '@modelshot/renderer-rt';

export { bindOrbitInput, type BindOrbitInputOptions, type OrbitInputElement } from './bindOrbitInput';
export { canvasSize, type CanvasCssSize, type CanvasSize, type CanvasSizeLimits } from './canvasSize';
export { DEFAULT_MAX_TEXTURE_PIXELS_TOTAL, planTextureDecode, type TextureLimits } from './decodeTextures';
export type { GlLimits } from './glLimits';
export { observeCanvasSize } from './observeCanvasSize';
export {
  MAX_FOV_DEG,
  MAX_ORTHO_ZOOM_IN,
  MAX_PITCH_DEG,
  MAX_ZOOM_OUT,
  MIN_DISTANCE_RADII,
  MIN_FOV_DEG,
  MIN_PITCH_DEG,
  OrbitController,
  type OrbitControllerOptions,
} from './OrbitController';
export { orbitKeyAction, type OrbitKeyAction } from './orbitKeys';
export {
  RealtimeRenderer,
  type RendererCapabilities,
  type RendererOptions,
  type SetSceneResult,
} from './RealtimeRenderer';
export { RendererError, type RendererErrorCode } from './RendererError';
export type { RendererWarning, RendererWarningCode } from './RendererWarning';
export { validateScene } from './validateScene';
