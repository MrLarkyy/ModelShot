/**
 * Two surfaces whose distances along a ray differ by at most this many model units (1/16 000 of a block) are
 * coincident: the one with the higher `SceneMesh.renderOrder` wins; at equal order the nearer one. Farther apart, the
 * nearer surface always wins. A rasteriser realises the same rule with a per-order polygon offset, which separates
 * coincident surfaces by far less than this distance.
 */
export const RENDER_ORDER_TIE_DISTANCE = 1e-3;
