/**
 * Light baked for one lightmap layout (`lightmapLayout`), as `LightBaker` of `@modelshot/pathtracer` produces it and
 * `RealtimeRenderer.setLighting` takes it. Texel (x, y) is element `(y × width + x) × 4` of `data`, RGBA as IEEE half
 * floats: rgb 1 less the fill the texel's ray lost over the unoccluded fill `hemisphereFill(n)` (the path tracer's
 * control variate: exactly 1 where nothing blocks the sky; a ray under a smooth face's geometric side counts as the
 * trace mirrors it), where a blocked ray loses the environment along it less what the blocker sends back (one diffuse
 * bounce: its emission and its albedo times the key and its unshadowed fill). Unclamped, so values can lie below 0
 * where fully blocked by dark faces and above 1 beside a bright one. a is the key light's visibility 0..1. Texels of
 * no chart hold 1; a channel the look's dome leaves at 0 holds 1, its bounce not baked. Valid only under looks of the
 * same `lightingKey`; the bounce's key share follows the key colour of the look baked under, which the key leaves out.
 */
export interface BakedLighting {
  /** `LightmapLayout.layoutKey` of the document it was baked for. */
  readonly layoutKey: string;
  /** `lightingKey` (@modelshot/looks) of the look it was baked under: its key light and dome. */
  readonly lightingKey: string;
  readonly width: number;
  readonly height: number;
  readonly data: Uint16Array;
  /** Samples per texel behind these values. */
  readonly samples: number;
  /** The shadow catcher's own lightmap, `null` when the bake had none. */
  readonly catcher: BakedCatcher | null;
}

/**
 * The shadow catcher's lightmap (`shadowCatcherPlane`): texel (x, z) covers
 * `[rect[0] + x × dx, rect[0] + (x + 1) × dx] × [rect[1] + z × dz, …]` with `dx = (rect[2] − rect[0]) / width`; data as
 * `BakedLighting.data` but rgb is 1 less the fill the texel's rays lost to blockers, as a multiple of the sky fill
 * `hemisphereFill(up)` (the path tracer's control variate): exactly 1 where nothing blocks, and a fully blocked texel's
 * mean may dip below 0 (unclamped). The preview shades it with `catcherShadeOfLoss`.
 */
export interface BakedCatcher {
  readonly y: number;
  readonly rect: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly data: Uint16Array;
}
