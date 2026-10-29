export const packageName = '@modelshot/scene';

export {
  DEFAULT_ALPHA_CUTOFF,
  resolveMaterialAlpha,
  texelCoverage,
  type MaterialAlpha,
  type TexelCoverage,
} from './materialAlpha';
export { MAX_MATERIAL_LAYERS, resolveMaterialRenderMode, type MaterialRenderMode } from './materialRenderMode';
export {
  mat4Identity,
  mat4Multiply,
  mat4NodeLocal,
  mat4NormalMatrix,
  mat4Rotation,
  mat4TransformDirection,
  mat4TransformPoint,
  type Mat4,
} from './Mat4';
export { normalMatrixTransform } from './normalMatrixTransform';
export { BACK_SIDE_RENDER_ORDER, MAX_ABS_RENDER_ORDER, RENDER_ORDER_TIE_DISTANCE } from './renderOrder';
export { SCENE_FORMAT_VERSION, type SceneDocument, type SceneSource, type SceneSourceFormat } from './SceneDocument';
export type { SceneAlphaMode, SceneBlending, SceneMaterial } from './SceneMaterial';
export type { SceneMesh, SceneMeshGroup } from './SceneMesh';
export type { SceneNode } from './SceneNode';
export type { SceneTexture } from './SceneTexture';
export { DEFAULT_TEXTURE_FRAME_TIME, type SceneTextureFrames } from './SceneTextureFrames';
export {
  DEFAULT_TEXTURE_FILTER,
  DEFAULT_TEXTURE_WRAP,
  SCENE_TEXTURE_FILTERS,
  SCENE_TEXTURE_WRAPS,
  textureSampling,
  type SceneTextureFilter,
  type SceneTextureWrap,
  type TextureSampling,
} from './SceneTextureSampling';
export type { Vec3 } from './Vec3';
export { worldMatrices } from './worldMatrices';
export { cameraBasis, cameraProjection, cameraView, checkCameraProjection, type CameraBasis } from './cameraMatrices';
export { cameraRay, type CameraRay } from './cameraRay';
export {
  DEFAULT_FIT_MARGIN,
  MIN_FIT_RADIUS,
  fitClipPlanes,
  fitDistance,
  fitOrthoHeight,
  fitRadius,
  frameToFit,
  type ClipPlanes,
  type FrameToFitOptions,
} from './frameToFit';
export {
  ISOMETRIC_PITCH_DEG,
  ISOMETRIC_YAW_DEG,
  orbitDirection,
  type SceneCamera,
  type SceneProjection,
} from './SceneCamera';
export { sceneBounds, type SceneBounds } from './sceneBounds';
export {
  EDGE_SLOTS,
  EDGE_WELD_DISTANCE,
  MAX_EDGE_WORK,
  MAX_SHARP_ANGLE_DEG,
  NO_EDGE,
  PARALLEL_EDGE_DEG,
  sceneSharpEdges,
  sharpEdges,
  type EdgeWork,
  type SharpEdgeAttributes,
  type SharpEdgeOptions,
} from './sharpEdges';
export { meshVisible, nodeVisibility } from './nodeVisibility';
export { PLAYER_BONES, type PlayerBoneName } from './PlayerBones';
export type { ScenePose, ScenePoseBone } from './ScenePose';
export { MAX_POSE_BONES, MAX_POSE_ROTATION_DEG, MAX_POSE_TRANSLATION, poseScene, type PoseResult } from './poseScene';
export { PLAYER_POSE_PRESETS, playerPosePreset, type PlayerPosePresetName } from './playerPosePresets';
export type { SceneAttachment } from './SceneAttachment';
export { MAX_ATTACH_SCALE, attachModel, type AttachOptions } from './attachModel';
export type {
  SceneAnimation,
  SceneAnimationChannel,
  SceneAnimationLoop,
  SceneAnimationProperty,
  SceneInterpolation,
  SceneKeyframe,
  ScenePlayback,
} from './SceneAnimation';
export type { AnimationPlaybackOptions } from './AnimationPlaybackOptions';
export {
  MAX_ANIMATION_FRAMES,
  MAX_PLAYBACK_FPS,
  animationFrameCount,
  animationFrameTimes,
  animationTime,
} from './animationTime';
export {
  MAX_ANIMATION_SCALE,
  MAX_ANIMATION_VALUE,
  MIN_ANIMATION_SCALE,
  animateScene,
  type AnimateResult,
} from './animateScene';
