import { MAX_ABS_RENDER_ORDER, RENDER_ORDER_TIE_DISTANCE, type Mat4, type SceneCamera } from '@modelshot/scene';

/**
 * How a frame realises the scene format's render-order key (view depth − order × RENDER_ORDER_TIE_DISTANCE):
 * `raster` pulls each vertex along the view axis and lets the depth buffer compare (early depth testing and per-sample
 * MSAA depth intact, but only as exact as the rasteriser's depth interpolation); `exact` computes the key per fragment
 * from the pixel's ray and the triangle's plane and writes it as the fragment depth.
 */
export type DepthKeyMode = 'raster' | 'exact';

/** Model units between two adjacent depth-buffer values at the far plane, the coarsest point of the range. */
export function depthStepAtFar(camera: Pick<SceneCamera, 'near' | 'far' | 'projection'>, depthBits: number): number {
  const { near, far } = camera;
  const levels = 2 ** depthBits;
  if (camera.projection.kind === 'orthographic') return (far - near) / levels;
  return ((far - near) * far) / (near * levels);
}

/**
 * `exact` when the scene has a mesh with a non-zero render order (decided once per scene upload: interpolated depth
 * cannot hold the tie between coincident surfaces of different triangulation), or when the depth buffer cannot
 * resolve the tie distance at the far plane in the raster variant (step above a quarter of it: a camera inside the
 * model's bounding sphere, near = far × 1e-4, or a 16-bit depth buffer); else `raster`. A 16-bit buffer does not hold
 * the tie in the exact variant either (step about far / 65536), see docs/realtime-renderer.md. Pure: the same inputs
 * always pick the same mode.
 */
export function depthKeyMode(
  camera: Pick<SceneCamera, 'near' | 'far' | 'projection'>,
  depthBits: number,
  sceneHasRenderOrder = false,
): DepthKeyMode {
  if (sceneHasRenderOrder) return 'exact';
  return depthStepAtFar(camera, depthBits) > RENDER_ORDER_TIE_DISTANCE / 4 ? 'exact' : 'raster';
}

/** Largest pull of the exact key in model units: `MAX_ABS_RENDER_ORDER + 1` steps (a back side adds 1/16 of one). */
export const MAX_ORDER_PULL = (MAX_ABS_RENDER_ORDER + 1) * RENDER_ORDER_TIE_DISTANCE;

/**
 * `[offset, scale]` with `depth = (key + offset) × scale`, mapping every exact key of a frame,
 * `[−MAX_ORDER_PULL, far + MAX_ORDER_PULL]`, into `[0, 1]`, so no render order is clamped at the near or far plane.
 */
export function exactDepthRange(far: number): [number, number] {
  return [MAX_ORDER_PULL, 1 / (far + 2 * MAX_ORDER_PULL)];
}

/**
 * Clip-space offset that moves a vertex `order × RENDER_ORDER_TIE_DISTANCE` towards the camera along the view axis:
 * that distance times the projection's third column (view z grows towards the camera).
 */
export function depthPull(projection: Mat4, order: number): Float32Array {
  const distance = order * RENDER_ORDER_TIE_DISTANCE;
  return new Float32Array([0, 1, 2, 3].map((row) => distance * (projection[8 + row] ?? 0)));
}
