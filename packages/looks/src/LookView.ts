import type { Direction } from './LookPreset';

/**
 * The camera as the look sees it, to turn the view-space rim (`LookRimLight.direction`) into world space and to know
 * where the eye is. World unit vectors `right`, `up` and `back` (toward the viewer, minus the view direction).
 */
export interface LookView {
  readonly right: Direction;
  readonly up: Direction;
  readonly back: Direction;
  /** Perspective: the eye position, w 1. Orthographic: `back`, w 0 (every point sees the eye along it). */
  readonly eye: readonly [number, number, number, number];
}

/** No camera (the light bake, which has no rim): view space is world space, the eye infinitely far along +z. */
export const LOOK_VIEW_NONE: LookView = Object.freeze({
  right: Object.freeze([1, 0, 0] as const),
  up: Object.freeze([0, 1, 0] as const),
  back: Object.freeze([0, 0, 1] as const),
  eye: Object.freeze([0, 0, 1, 0] as const),
});

/**
 * The look view of a camera with world unit vectors `right`, `up`, `forward` (the view direction) at `position`, as
 * `cameraBasis` of @modelshot/scene gives them.
 */
export function lookView(camera: {
  readonly position: Direction;
  readonly right: Direction;
  readonly up: Direction;
  readonly forward: Direction;
  readonly orthographic: boolean;
}): LookView {
  const { position: p, right, up, forward: f } = camera;
  const back: Direction = [-f[0], -f[1], -f[2]];
  return {
    right: [right[0], right[1], right[2]],
    up: [up[0], up[1], up[2]],
    back,
    eye: camera.orthographic ? [back[0], back[1], back[2], 0] : [p[0], p[1], p[2], 1],
  };
}

/** Unit vector from the world point `p` toward the eye of `view` (towardEye of the lightRig chunk). */
export function towardEye(view: LookView, p: Direction): Direction {
  const [x, y, z, w] = view.eye;
  if (w === 0) return [x, y, z];
  const d = [x - p[0], y - p[1], z - p[2]] as const;
  const length = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / length, d[1] / length, d[2] / length];
}
