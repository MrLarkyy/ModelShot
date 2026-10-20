export const packageName = '@modelshot/formats';

export { BbmodelError, type BbmodelErrorCode } from './bbmodel/BbmodelError';
export { DEFAULT_BBMODEL_LIMITS, type BbmodelLimits, type BbmodelLoadOptions } from './bbmodel/BbmodelLoadOptions';
export type { BbmodelLoadResult } from './bbmodel/BbmodelLoadResult';
export { MAX_BBMODEL_WARNINGS, type BbmodelWarning, type BbmodelWarningCode } from './bbmodel/BbmodelWarning';
export { loadBbmodel } from './bbmodel/loadBbmodel';
export { GltfError, type GltfErrorCode } from './gltf/GltfError';
export {
  DEFAULT_GLTF_LIMITS,
  DEFAULT_GLTF_UNIT_SCALE,
  type GltfLimits,
  type GltfLoadOptions,
} from './gltf/GltfLoadOptions';
export type { GltfLoadResult } from './gltf/GltfLoadResult';
export { MAX_GLTF_WARNINGS, type GltfWarning, type GltfWarningCode } from './gltf/GltfWarning';
export { loadGltf } from './gltf/loadGltf';
export { ObjError, type ObjErrorCode } from './obj/ObjError';
export { DEFAULT_OBJ_LIMITS, DEFAULT_OBJ_UNIT_SCALE, type ObjLimits, type ObjLoadOptions } from './obj/ObjLoadOptions';
export type { ObjLoadResult } from './obj/ObjLoadResult';
export { MAX_OBJ_WARNINGS, type ObjWarning, type ObjWarningCode } from './obj/ObjWarning';
export { loadObj } from './obj/loadObj';
export { BLEND_ALPHA_CUTOFF } from './alpha/blendAlphaCutoff';
export {
  ACCEPTED_MODEL_EXTENSIONS,
  ACCEPTED_RESOURCE_EXTENSIONS,
  detectModelFormat,
  type ModelFormat,
} from './detectModelFormat';
