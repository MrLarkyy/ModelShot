/**
 * Light baked for one lightmap layout (`lightmapLayout`), as `LightBaker` of `@modelshot/pathtracer` produces it and
 * `RealtimeRenderer.setLighting` takes it. Texel (x, y) is element `(y × width + x) × 4` of `data`, RGBA as IEEE half
 * floats: rgb the fill light as a multiple of the unoccluded fill `hemisphereFill(n)` (1 where nothing blocks the sky),
 * a the key light's visibility 0..1. Texels of no chart hold 1.
 */
export interface BakedLighting {
  /** `LightmapLayout.layoutKey` of the document it was baked for. */
  readonly layoutKey: string;
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
 * `BakedLighting.data`, fill as a multiple of the sky fill.
 */
export interface BakedCatcher {
  readonly y: number;
  readonly rect: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly data: Uint16Array;
}
