import type { SceneBounds } from '@modelshot/scene';

/** Largest side, in texels, of the shadow catcher's lightmap. */
export const MAX_CATCHER_SIDE = 512;

/** Catcher texels per finest model texel along each axis. */
const CATCHER_TEXELS_PER_MODEL_TEXEL = 4;

/** The rectangle an empty scene's catcher covers, around the origin. */
const EMPTY_HALF_SIDE = 8;

/** The shadow catcher: a horizontal plane under the model, one-sided from above, and its lightmap size. */
export interface ShadowCatcherPlane {
  /** Height of the plane: the lowest point of the visible geometry. */
  readonly y: number;
  /** `[minX, minZ, maxX, maxZ]`. */
  readonly rect: readonly [number, number, number, number];
  /** Lightmap texels across x and z (1..MAX_CATCHER_SIDE). */
  readonly width: number;
  readonly height: number;
}

/**
 * The catcher under a scene of `bounds` (`sceneBounds`; `null` for an empty scene, which gets a 16 × 16 plane at the
 * origin): at the bounds' lowest y, covering the footprint and the bounds' shadow along −`keyDirection` (the unit
 * vector towards the key, pointing up) plus a margin of half the largest extent. Its lightmap has
 * `CATCHER_TEXELS_PER_MODEL_TEXEL` texels per `finestTexel` (world size of the finest model texel), at most
 * `MAX_CATCHER_SIDE` per side (without a finite `finestTexel`: `MAX_CATCHER_SIDE` along the longer side). `y` and `rect`
 * do not depend on `finestTexel`.
 */
export function shadowCatcherPlane(
  bounds: SceneBounds | null,
  keyDirection: readonly [number, number, number],
  finestTexel: number,
): ShadowCatcherPlane {
  let y = 0;
  let rect: [number, number, number, number] = [-EMPTY_HALF_SIDE, -EMPTY_HALF_SIDE, EMPTY_HALF_SIDE, EMPTY_HALF_SIDE];
  if (bounds) {
    y = bounds.min[1];
    rect = [bounds.min[0], bounds.min[2], bounds.max[0], bounds.max[2]];
    const up = Math.max(keyDirection[1], 1e-3);
    for (const cx of [bounds.min[0], bounds.max[0]]) {
      for (const cz of [bounds.min[2], bounds.max[2]]) {
        const drop = (bounds.max[1] - y) / up;
        const x = cx - keyDirection[0] * drop;
        const z = cz - keyDirection[2] * drop;
        rect = [Math.min(rect[0], x), Math.min(rect[1], z), Math.max(rect[2], x), Math.max(rect[3], z)];
      }
    }
    const extent = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
      1e-3,
    );
    const margin = 0.5 * extent;
    rect = [rect[0] - margin, rect[1] - margin, rect[2] + margin, rect[3] + margin];
  }
  const largest = Math.max(rect[2] - rect[0], rect[3] - rect[1]);
  const texel =
    Number.isFinite(finestTexel) && finestTexel > 0
      ? finestTexel / CATCHER_TEXELS_PER_MODEL_TEXEL
      : largest / MAX_CATCHER_SIDE;
  const side = (length: number) => Math.min(MAX_CATCHER_SIDE, Math.max(1, Math.ceil(length / texel)));
  return { y, rect, width: side(rect[2] - rect[0]), height: side(rect[3] - rect[1]) };
}
