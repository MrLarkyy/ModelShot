import { RENDER_ORDER_TIE_DISTANCE, type Mat4, type SceneCamera } from '@modelshot/scene';

/**
 * How a frame realises the render-order key (view depth − order × RENDER_ORDER_TIE_DISTANCE): `raster` pulls each
 * vertex along the view axis and lets the depth buffer compare (early-z, MSAA edges intact); `linear` writes the key
 * as the fragment depth, for frames whose depth buffer cannot resolve the tie distance.
 */
export type DepthKeyMode = 'raster' | 'linear';

/** Model units between two adjacent depth-buffer values at the far plane, the coarsest point of the range. */
export function depthStepAtFar(camera: Pick<SceneCamera, 'near' | 'far' | 'projection'>, depthBits: number): number {
  const { near, far } = camera;
  const levels = 2 ** depthBits;
  if (camera.projection.kind === 'orthographic') return (far - near) / levels;
  return ((far - near) * far) / (near * levels);
}

/**
 * `raster` while the depth step at the far plane stays within a quarter of the tie distance (a framed camera), else
 * `linear` (a camera inside the model's bounding sphere, near = far × 1e-4, or a 16-bit depth buffer). Pure: the same
 * camera and depth bits always pick the same mode.
 */
export function depthKeyMode(
  camera: Pick<SceneCamera, 'near' | 'far' | 'projection'>,
  depthBits: number,
): DepthKeyMode {
  return depthStepAtFar(camera, depthBits) > RENDER_ORDER_TIE_DISTANCE / 4 ? 'linear' : 'raster';
}

/**
 * Clip-space offset that moves a vertex `order × RENDER_ORDER_TIE_DISTANCE` towards the camera along the view axis:
 * that distance times the projection's third column (view z grows towards the camera).
 */
export function depthPull(projection: Mat4, order: number): Float32Array {
  const distance = order * RENDER_ORDER_TIE_DISTANCE;
  return new Float32Array([0, 1, 2, 3].map((row) => distance * (projection[8 + row] ?? 0)));
}
