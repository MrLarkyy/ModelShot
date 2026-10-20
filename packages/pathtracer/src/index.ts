export const packageName = '@modelshot/pathtracer';

export { buildBvh, bvhSahCost, MAX_BVH_DEPTH, MAX_LEAF_TRIANGLES, type Bvh, type BuildBvhOptions } from './buildBvh';
export { cameraUniforms, uniformRay, type CameraUniforms } from './cameraUniforms';
export { DEFAULT_MAX_TRIANGLES, flattenScene, type FlatScene } from './flattenScene';
export {
  LightBaker,
  MAX_BAKE_SAMPLES,
  type BakeOptions,
  type BakeProgress,
  type BakeResult,
  type LightBakerOptions,
} from './LightBaker';
export { pcgHash, sampleHash, unitRandom } from './pcgHash';
export { MAX_SAMPLES, MAX_SEED, PathTracer, type PathTracerCapabilities } from './PathTracer';
export { PathTracerError, type PathTracerErrorCode } from './PathTracerError';
export type { PathTracerOptions, RenderRequest, SetSceneOptions, SetSceneResult } from './PathTracerOptions';
export type { PathTracerWarning, PathTracerWarningCode } from './PathTracerWarning';
