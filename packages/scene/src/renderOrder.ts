/**
 * Each render-order step pulls a surface this many model units (1/16 000 of a block) nearer along the ray: every
 * renderer shows the smallest `distance − renderOrder × RENDER_ORDER_TIE_DISTANCE`, so for orders one step apart the
 * higher one wins within this distance and the nearer one beyond it. Ray tracers apply it to the hit distance,
 * rasterisers to a per-fragment ray distance written as depth (see docs/scene-format.md).
 */
export const RENDER_ORDER_TIE_DISTANCE = 1e-3;
