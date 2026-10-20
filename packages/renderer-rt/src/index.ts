export const packageName = '@modelshot/renderer-rt';

export type { BakedCatcher, BakedLighting } from './BakedLighting';
export { bindOrbitInput, type BindOrbitInputOptions, type MotionQuery, type OrbitInputElement } from './bindOrbitInput';
export { canvasSize, type CanvasCssSize, type CanvasSize, type CanvasSizeLimits } from './canvasSize';
export {
  DEFAULT_MAX_TEXTURE_PIXELS_TOTAL,
  decodeTextures,
  planTextureDecode,
  type DecodedTextures,
  type TextureLimits,
} from './decodeTextures';
export { depthKeyMode, depthStepAtFar, type DepthKeyMode } from './depthKeyMode';
export type { GlLimits } from './glLimits';
export {
  LIGHTMAP_WIDTH,
  MAX_CHART_TRIANGLES,
  MAX_LIGHTMAP_TEXELS,
  lightmapLayout,
  type LightmapChart,
  type LightmapLayout,
} from './lightmapLayout';
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
export { MAX_CATCHER_SIDE, shadowCatcherPlane, type ShadowCatcherPlane } from './shadowCatcherPlane';
export type { RendererWarning, RendererWarningCode } from './RendererWarning';
export { PLACEHOLDER_IMAGE, UNTEXTURED_IMAGE, type RawImage } from './textureUpload';
export { validateScene } from './validateScene';
