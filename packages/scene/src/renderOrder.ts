/**
 * The render-order rule (docs/scene-format.md, renderOrder). Among the surfaces a ray meets, the one with the smallest
 * key is shown:
 *
 *     key = depth − effectiveOrder × RENDER_ORDER_TIE_DISTANCE
 *
 * where depth is the depth along the camera's view axis for camera rays and the distance along the ray for every other
 * ray, and effectiveOrder is `SceneMesh.renderOrder` (absent: 0), plus `BACK_SIDE_RENDER_ORDER` when the ray meets the
 * back of a double-sided face. Occlusion rays (shadow, ambient occlusion) ignore order: any blocking hit blocks. Which
 * of two equal keys is shown is unspecified.
 */
export const RENDER_ORDER_TIE_DISTANCE = 1e-3;

/** Added to the order of the back side of a double-sided face, so of two coincident faces the one facing the viewer wins. */
export const BACK_SIDE_RENDER_ORDER = -1 / 16;

/** `SceneMesh.renderOrder` is an integer with at most this magnitude. */
export const MAX_ABS_RENDER_ORDER = 1024;
