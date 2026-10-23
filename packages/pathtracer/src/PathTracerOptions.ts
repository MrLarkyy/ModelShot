import type { EdgeLook, LookPreset } from '@modelshot/looks';
import type { SceneBounds } from '@modelshot/scene';
import type { PathTracerWarning } from './PathTracerWarning';

export interface PathTracerOptions {
  /**
   * The look, the preview's (`RendererOptions.look`): lights, environment, backdrop, catcher strength, edges, tone
   * mapping. Default `DEFAULT_LOOK` (Studio). Checked like `setLook`.
   */
  readonly look?: LookPreset;
  /**
   * Scene-linear colour of camera rays that leave the scene: overrides the initial look's backdrop, flat. A channel
   * not finite or outside 0..16 throws a `RangeError`.
   */
  readonly background?: readonly [number, number, number];
  /** Indirect bounces after the camera hit, 1..16. Default 4; Russian roulette from bounce 3. */
  readonly maxBounces?: number;
  /** Triangles of visible meshes accepted by `setScene`. Default 200 000 (the loaders' limit). */
  readonly maxTriangles?: number;
  /**
   * `setScene` flattens the scene, builds the BVH and packs the data in a module Worker, so a large model does not
   * block the page. Default `true`; `false` does that work on the main thread (for hosts that forbid workers). Without
   * Worker support, or when the worker cannot start or fails, the main thread does it too: the same bytes either way. The worker compares meshes by object identity and
   * posts a `SceneMesh` it holds again never, so a mesh changed in place is not rebuilt: pass a new `SceneMesh`.
   */
  readonly geometryWorker?: boolean;
  /** Largest texture side accepted (further capped by MAX_TEXTURE_SIZE and 4096). Default 4096. */
  readonly maxTextureSide?: number;
  /** Total decoded texture pixels per scene. Default 64 Mi. */
  readonly maxTexturePixelsTotal?: number;
  /** Side of the square tiles one sample is drawn in, one draw call each, 16..4096. Default 256. */
  readonly tileSize?: number;
  /** Cap on the backing store's width × height. */
  readonly maxPixels?: number;
  /** Keep the drawn image readable after the frame (screenshots, tests). Default `false`. */
  readonly preserveDrawingBuffer?: boolean;
  /**
   * Rounded sharp edges, the preview's (`RendererOptions.edges`): overrides the initial look's edges, fields left out
   * keeping the look's. A value out of range throws a `RangeError` naming `edges.width` or `edges.sharpAngleDeg`.
   */
  readonly edges?: Partial<EdgeLook>;
}

export interface SetSceneOptions {
  /**
   * Linear RGB radiance emitted by each material, indexed like `SceneDocument.materials`; absent entries emit nothing,
   * a negative or non-finite channel counts as 0. The scene format's own emission field maps here (MS-32).
   */
  readonly emission?: readonly (readonly [number, number, number] | undefined)[];
  /**
   * Camera rays from above see a shadow catcher under the model (`shadowCatcherPlane` of the realtime renderer): the
   * backdrop darkened where the model takes key and fill light from the plane. Invisible to every other ray. Default
   * `true`, as in the baked preview.
   */
  readonly shadowCatcher?: boolean;
  /**
   * Where the catcher goes instead of under this document's own bounds: its height is `min[1]`, its rectangle covers
   * the box and the box's shadow. An animation export passes the union of every pose, so the floor stays put while a
   * pose jumps or crouches. `min` and `max` must be finite with `min ≤ max` on each axis, else a `RangeError` naming
   * `catcherBounds`.
   */
  readonly catcherBounds?: SceneBounds;
}

export interface SetSceneResult {
  /** `false` when a later `setScene` or `dispose` superseded this call; nothing of it was kept. */
  readonly applied: boolean;
  readonly warnings: readonly PathTracerWarning[];
  /** Triangles traced (visible, finite, with area). */
  readonly triangles: number;
}

/**
 * One progressive render: exactly `samples` samples per pixel from `seed` (with `noiseThreshold`, at most). The quality
 * fields left out render as without them, byte for byte; a field out of range throws a `RangeError` naming it.
 */
export interface RenderRequest {
  /** Integer 0..2^32 − 1. */
  readonly seed: number;
  /** Integer 1..65536; the maximum with `noiseThreshold`. */
  readonly samples: number;
  /**
   * Integer 1..4, default 1: traces s × s samples per canvas pixel (each `samples` counts per traced pixel) and
   * box-downsamples them. Lowered to fit the GPU's target size and `MAX_SUPERSAMPLED_PIXELS`; `progress.supersample`
   * reports the scale used.
   */
  readonly supersample?: number;
  /** Default `false`: filters the noise, guided by albedo and normal, stopping at their edges (pixel-art texels). */
  readonly denoise?: boolean;
  /**
   * In (0, 1]: stops at a checkpoint (samples 1, 2, 4, 8, 16, then every 16) once the 0.99 quantile of the noise
   * estimate (relative standard error of each pixel's luminance, the worst of each 4 × 4 block) is at or under it.
   */
  readonly noiseThreshold?: number;
  /**
   * Default `false`. `true` renders with an alpha channel: per pixel the share of camera rays that met a visible texel
   * (per texel, so a cut-out texel shows through and a partial one by its alpha, whatever the draw order), 0 where they
   * left the scene; the shadow catcher becomes a black shadow-only layer of alpha 1 − shade, which over the backdrop
   * gives back the opaque catcher. The canvas still shows the image over the backdrop; `readImage()` returns the
   * alpha. A request without the field renders byte for byte as before.
   */
  readonly transparent?: boolean;
}

/** An 8-bit sRGB image as `ImageData` holds one: straight (not premultiplied) alpha, rows top to bottom. */
export interface RenderedImage {
  readonly width: number;
  readonly height: number;
  /** `width × height × 4` bytes, RGBA. */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}
