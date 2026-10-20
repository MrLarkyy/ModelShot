import { orbitDirection, type SceneCamera, type SceneProjection } from './SceneCamera';
import type { SceneBounds } from './sceneBounds';
import type { Vec3 } from './Vec3';

export interface FrameToFitOptions {
  /** Kind and field of view to keep; an orthographic height is replaced by the fitted one. */
  readonly projection: SceneProjection;
  /** Viewport width / height. */
  readonly aspect: number;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  /** Room around the bounding sphere: 1 touches the frame edges. Default `DEFAULT_FIT_MARGIN`. */
  readonly margin?: number;
}

export interface ClipPlanes {
  readonly near: number;
  readonly far: number;
}

export const DEFAULT_FIT_MARGIN = 1.1;
/** A point-sized or empty model is framed as a sphere of this radius (model units) so the camera stays defined. */
export const MIN_FIT_RADIUS = 0.5;
/** The near plane never comes closer than this fraction of the far plane (keeps 24-bit depth usable). */
const MIN_NEAR_FRACTION = 1e-4;

export function fitRadius(bounds: SceneBounds): number {
  return Math.max(bounds.radius, MIN_FIT_RADIUS);
}

/** Distance from the sphere centre at which a perspective camera sees the whole sphere, for either image axis. */
export function fitDistance(radius: number, fovYDeg: number, aspect: number, margin = DEFAULT_FIT_MARGIN): number {
  const halfY = (fovYDeg * Math.PI) / 360;
  const halfX = Math.atan(Math.tan(halfY) * aspect);
  return (radius * margin) / Math.sin(Math.min(halfX, halfY));
}

/** Orthographic height that shows the whole sphere, for either image axis. */
export function fitOrthoHeight(radius: number, aspect: number, margin = DEFAULT_FIT_MARGIN): number {
  return (2 * radius * margin) / Math.min(1, aspect);
}

/**
 * Near and far planes that enclose the bounding sphere seen from `position` along the unit vector `forward`, so
 * zooming never clips the model. A camera inside the sphere gets a near plane of `far × 1e-4`.
 */
export function fitClipPlanes(position: Vec3, forward: Vec3, bounds: SceneBounds): ClipPlanes {
  const r = fitRadius(bounds);
  const c = bounds.center;
  const along =
    (c[0] - position[0]) * forward[0] + (c[1] - position[1]) * forward[1] + (c[2] - position[2]) * forward[2];
  const far = Math.max(along + r, r) * 1.01;
  const near = Math.max((along - r) * 0.99, far * MIN_NEAR_FRACTION);
  return { near, far };
}

/**
 * A camera looking at the centre of `bounds` from the orbit angles that shows the whole bounding sphere (and so every
 * corner of the box). Orthographic cameras stand at twice the radius, outside the sphere.
 */
export function frameToFit(bounds: SceneBounds, options: FrameToFitOptions): SceneCamera {
  const r = fitRadius(bounds);
  const margin = options.margin ?? DEFAULT_FIT_MARGIN;
  const toCamera = orbitDirection(options.yawDeg, options.pitchDeg);
  const perspective = options.projection.kind === 'perspective';
  const distance = perspective ? fitDistance(r, options.projection.fovYDeg, options.aspect, margin) : 2 * r;
  const projection: SceneProjection = perspective
    ? options.projection
    : { kind: 'orthographic', height: fitOrthoHeight(r, options.aspect, margin) };
  const c = bounds.center;
  const position: Vec3 = [c[0] + toCamera[0] * distance, c[1] + toCamera[1] * distance, c[2] + toCamera[2] * distance];
  const forward: Vec3 = [-toCamera[0], -toCamera[1], -toCamera[2]];
  return { position, target: c, up: [0, 1, 0], projection, ...fitClipPlanes(position, forward, bounds) };
}
