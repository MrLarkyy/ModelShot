import type { Mat4 } from './Mat4';
import type { SceneCamera } from './SceneCamera';
import type { Vec3 } from './Vec3';

/** Orthonormal camera frame: `forward` from position to target, `right` and `up` spanning the image plane. */
export interface CameraBasis {
  readonly forward: [number, number, number];
  readonly right: [number, number, number];
  readonly up: [number, number, number];
}

const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalize(v: Vec3): [number, number, number] | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 && Number.isFinite(length) ? [v[0] / length, v[1] / length, v[2] / length] : null;
}

/**
 * The camera frame. An `up` parallel to the view direction (or zero) falls back to +z, then +x, so the frame is
 * always defined; a camera whose position equals its target throws.
 */
export function cameraBasis(camera: SceneCamera): CameraBasis {
  const forward = normalize(sub(camera.target, camera.position));
  if (!forward) throw new RangeError('camera position and target must differ and be finite');
  const candidates: Vec3[] = [camera.up, [0, 0, 1], [1, 0, 0]];
  for (const candidate of candidates) {
    const right = normalize(cross(forward, candidate));
    if (right && Math.abs(dot(forward, normalize(candidate) ?? forward)) < 1 - 1e-9) {
      return { forward, right, up: cross(right, forward) };
    }
  }
  throw new RangeError('camera basis is undefined');
}

/** World to view matrix (column-major, OpenGL convention: the camera looks down −z). */
export function cameraView(camera: SceneCamera): Mat4 {
  const { forward, right, up } = cameraBasis(camera);
  const p = camera.position;
  const m = new Float64Array(16);
  m[0] = right[0];
  m[4] = right[1];
  m[8] = right[2];
  m[1] = up[0];
  m[5] = up[1];
  m[9] = up[2];
  m[2] = -forward[0];
  m[6] = -forward[1];
  m[10] = -forward[2];
  m[12] = -dot(right, p);
  m[13] = -dot(up, p);
  m[14] = dot(forward, p);
  m[15] = 1;
  return m;
}

/**
 * View to clip matrix for a viewport of `aspect` = width / height (OpenGL clip space, z in −1..1). Orthographic:
 * `projection.height` tall, `height × aspect` wide.
 */
export function cameraProjection(camera: SceneCamera, aspect: number): Mat4 {
  if (!(aspect > 0) || !Number.isFinite(aspect)) throw new RangeError(`aspect must be positive, got ${aspect}`);
  const { near, far, projection } = camera;
  if (!(near > 0 && far > near)) throw new RangeError(`camera needs 0 < near < far, got ${near}, ${far}`);
  const m = new Float64Array(16);
  if (projection.kind === 'perspective') {
    const f = 1 / Math.tan((projection.fovYDeg * Math.PI) / 360);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
  } else {
    const halfHeight = projection.height / 2;
    m[0] = 1 / (halfHeight * aspect);
    m[5] = 1 / halfHeight;
    m[10] = -2 / (far - near);
    m[14] = -(far + near) / (far - near);
    m[15] = 1;
  }
  return m;
}
