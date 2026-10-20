import { cameraBasis } from './cameraMatrices';
import type { SceneCamera } from './SceneCamera';

export interface CameraRay {
  readonly origin: [number, number, number];
  /** Unit length. */
  readonly direction: [number, number, number];
}

/**
 * The primary ray through normalised device coordinates (`ndcX`, `ndcY` in −1..1, y up) of a viewport with
 * `aspect` = width / height. Every point on it projects back to the same ndc through `cameraProjection` ×
 * `cameraView`; a path tracer that shoots these rays frames exactly like the preview. Perspective rays start at the
 * camera position, orthographic rays on the plane through it.
 */
export function cameraRay(camera: SceneCamera, aspect: number, ndcX: number, ndcY: number): CameraRay {
  const { forward, right, up } = cameraBasis(camera);
  const p = camera.position;
  if (camera.projection.kind === 'perspective') {
    const t = Math.tan((camera.projection.fovYDeg * Math.PI) / 360);
    const x = ndcX * t * aspect;
    const y = ndcY * t;
    const d: [number, number, number] = [
      forward[0] + x * right[0] + y * up[0],
      forward[1] + x * right[1] + y * up[1],
      forward[2] + x * right[2] + y * up[2],
    ];
    const length = Math.hypot(d[0], d[1], d[2]);
    return { origin: [p[0], p[1], p[2]], direction: [d[0] / length, d[1] / length, d[2] / length] };
  }
  const halfHeight = camera.projection.height / 2;
  const x = ndcX * halfHeight * aspect;
  const y = ndcY * halfHeight;
  return {
    origin: [p[0] + x * right[0] + y * up[0], p[1] + x * right[1] + y * up[1], p[2] + x * right[2] + y * up[2]],
    direction: forward,
  };
}
