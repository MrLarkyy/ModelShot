import type { Vec3 } from './Vec3';

/** Perspective with a vertical field of view, or orthographic with the visible height in model units. */
export type SceneProjection =
  | { readonly kind: 'perspective'; readonly fovYDeg: number }
  | { readonly kind: 'orthographic'; readonly height: number };

/**
 * The one camera definition both the realtime preview and the path tracer read, so they frame a model identically.
 * World space of the scene format (model units, y up, right-handed). The view looks from `position` towards `target`;
 * `up` need not be orthogonal to the view direction. The horizontal extent follows from the viewport aspect
 * (`cameraProjection`, `cameraRay`). `0 < near < far`, distances along the view direction.
 */
export interface SceneCamera {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly projection: SceneProjection;
  readonly near: number;
  readonly far: number;
}

/** Blockbench-style isometric view: 45° around y, looking down by atan(1/√2) ≈ 35.264°. */
export const ISOMETRIC_YAW_DEG = 45;
export const ISOMETRIC_PITCH_DEG = (Math.atan(Math.SQRT1_2) * 180) / Math.PI;

/**
 * Unit vector from an orbit target towards the camera. Yaw 0 puts the camera on +z (the south side), yaw 90 on +x;
 * positive pitch raises it above the target.
 */
export function orbitDirection(yawDeg: number, pitchDeg: number): [number, number, number] {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const flat = Math.cos(pitch);
  return [flat * Math.sin(yaw), Math.sin(pitch), flat * Math.cos(yaw)];
}
