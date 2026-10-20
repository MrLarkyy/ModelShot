import { cameraBasis, checkCameraProjection, type SceneCamera } from '@modelshot/scene';

/**
 * The shared camera (`SceneCamera`) as primaryRay.glsl takes it. A ray through normalised device coordinates
 * (x, y) is `cameraRay`'s: perspective from `position` along normalize(forward + x·scale.x·right + y·scale.y·up),
 * orthographic from position + x·scale.x·right + y·scale.y·up along `forward`; `scale` is tan(fovY / 2) or half the
 * height, times the aspect for x.
 */
export interface CameraUniforms {
  readonly orthographic: boolean;
  readonly position: [number, number, number];
  readonly forward: [number, number, number];
  readonly right: [number, number, number];
  readonly up: [number, number, number];
  readonly scale: [number, number];
  /** Clip distances along the view axis, as in the preview. */
  readonly near: number;
  readonly far: number;
}

/** Throws a `RangeError` for an unusable projection, aspect or clip range, like `cameraProjection`. */
export function cameraUniforms(camera: SceneCamera, aspect: number): CameraUniforms {
  checkCameraProjection(camera.projection, aspect);
  const { near, far } = camera;
  if (!(near > 0 && far > near && Number.isFinite(far))) {
    throw new RangeError(`camera needs 0 < near < far, both finite, got ${near}, ${far}`);
  }
  const { forward, right, up } = cameraBasis(camera);
  const half =
    camera.projection.kind === 'perspective'
      ? Math.tan((camera.projection.fovYDeg * Math.PI) / 360)
      : camera.projection.height / 2;
  return {
    orthographic: camera.projection.kind === 'orthographic',
    position: [camera.position[0], camera.position[1], camera.position[2]],
    forward,
    right,
    up,
    scale: [half * aspect, half],
    near,
    far,
  };
}

/** The ray primaryRay.glsl shoots through (ndcX, ndcY), in double precision: what the tests hold against `cameraRay`. */
export function uniformRay(
  u: CameraUniforms,
  ndcX: number,
  ndcY: number,
): { origin: [number, number, number]; direction: [number, number, number] } {
  const x = ndcX * u.scale[0];
  const y = ndcY * u.scale[1];
  const offset = [0, 1, 2].map((k) => x * u.right[k]! + y * u.up[k]!);
  if (u.orthographic) {
    return {
      origin: [u.position[0] + offset[0]!, u.position[1] + offset[1]!, u.position[2] + offset[2]!],
      direction: [...u.forward],
    };
  }
  const d = [u.forward[0] + offset[0]!, u.forward[1] + offset[1]!, u.forward[2] + offset[2]!];
  const length = Math.hypot(d[0]!, d[1]!, d[2]!);
  return { origin: [...u.position], direction: [d[0]! / length, d[1]! / length, d[2]! / length] };
}
