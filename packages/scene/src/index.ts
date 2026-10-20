export const packageName = '@modelshot/scene';

export {
  DEFAULT_ALPHA_CUTOFF,
  resolveMaterialAlpha,
  texelCoverage,
  type MaterialAlpha,
  type TexelCoverage,
} from './materialAlpha';
export {
  mat4Identity,
  mat4Multiply,
  mat4NodeLocal,
  mat4Rotation,
  mat4TransformDirection,
  mat4TransformPoint,
  type Mat4,
} from './Mat4';
export { RENDER_ORDER_TIE_DISTANCE } from './renderOrder';
export { SCENE_FORMAT_VERSION, type SceneDocument, type SceneSource } from './SceneDocument';
export type { SceneAlphaMode, SceneMaterial } from './SceneMaterial';
export type { SceneMesh, SceneMeshGroup } from './SceneMesh';
export type { SceneNode } from './SceneNode';
export type { SceneTexture } from './SceneTexture';
export type { Vec3 } from './Vec3';
export { worldMatrices } from './worldMatrices';
