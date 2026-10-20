export const packageName = '@modelshot/scene';

export {
  mat4Identity,
  mat4Multiply,
  mat4NodeLocal,
  mat4Rotation,
  mat4TransformDirection,
  mat4TransformPoint,
  type Mat4,
} from './Mat4';
export { SCENE_FORMAT_VERSION, type SceneDocument, type SceneSource } from './SceneDocument';
export type { SceneMaterial } from './SceneMaterial';
export type { SceneMesh, SceneMeshGroup } from './SceneMesh';
export type { SceneNode } from './SceneNode';
export type { SceneTexture } from './SceneTexture';
export type { Vec3 } from './Vec3';
export { worldMatrices } from './worldMatrices';
