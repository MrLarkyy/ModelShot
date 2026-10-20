import type { PathTracerWarning } from './PathTracerWarning';

export interface PathTracerOptions {
  /** Scene-linear colour of camera rays that leave the scene; default the look's backdrop, as in the preview. */
  readonly background?: readonly [number, number, number];
  /** Indirect bounces after the camera hit, 1..16. Default 4; Russian roulette from bounce 3. */
  readonly maxBounces?: number;
  /** Triangles of visible meshes accepted by `setScene`. Default 200 000 (the loaders' limit). */
  readonly maxTriangles?: number;
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
}

export interface SetSceneOptions {
  /**
   * Linear RGB radiance emitted by each material, indexed like `SceneDocument.materials`; absent entries emit nothing,
   * a negative or non-finite channel counts as 0. The scene format's own emission field maps here (MS-32).
   */
  readonly emission?: readonly (readonly [number, number, number] | undefined)[];
}

export interface SetSceneResult {
  /** `false` when a later `setScene` or `dispose` superseded this call; nothing of it was kept. */
  readonly applied: boolean;
  readonly warnings: readonly PathTracerWarning[];
  /** Triangles traced (visible, finite, with area). */
  readonly triangles: number;
}

/** One progressive render: exactly `samples` samples per pixel from `seed`. */
export interface RenderRequest {
  /** Integer 0..2^32 − 1. */
  readonly seed: number;
  /** Integer 1..65536. */
  readonly samples: number;
}
