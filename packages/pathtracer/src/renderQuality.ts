/** Largest `RenderRequest.supersample`. */
export const MAX_SUPERSAMPLE = 4;
/**
 * Accumulation pixels (supersampled width × height) a render may use: about 72 bytes each with denoising, so 2^22 keeps
 * the targets near 300 MB. A larger request falls back to a smaller scale.
 */
export const MAX_SUPERSAMPLED_PIXELS = 2 ** 22;

/** The quality fields of a `RenderRequest`, checked and with their defaults. */
export interface RenderQuality {
  readonly supersample: number;
  readonly denoise: boolean;
  /** `null`: no convergence stop, exactly `samples` samples. */
  readonly noiseThreshold: number | null;
}

/** The fields `checkRenderQuality` reads; `undefined` takes the default. */
export interface RenderQualityFields {
  readonly supersample?: number | undefined;
  readonly denoise?: boolean | undefined;
  readonly noiseThreshold?: number | undefined;
}

/** Throws a `RangeError` naming the first field out of range: `supersample`, `denoise` or `noiseThreshold`. */
export function checkRenderQuality(fields: RenderQualityFields): RenderQuality {
  const { supersample = 1, denoise = false, noiseThreshold } = fields;
  if (
    typeof supersample !== 'number' ||
    !Number.isInteger(supersample) ||
    supersample < 1 ||
    supersample > MAX_SUPERSAMPLE
  ) {
    throw new RangeError(`supersample must be an integer in 1..${MAX_SUPERSAMPLE}, got ${String(supersample)}`);
  }
  if (typeof denoise !== 'boolean') throw new RangeError(`denoise must be a boolean, got ${String(denoise)}`);
  if (
    noiseThreshold !== undefined &&
    (typeof noiseThreshold !== 'number' || !Number.isFinite(noiseThreshold) || noiseThreshold <= 0 || noiseThreshold > 1)
  ) {
    throw new RangeError(`noiseThreshold must be a finite number in (0, 1], got ${String(noiseThreshold)}`);
  }
  return { supersample, denoise, noiseThreshold: noiseThreshold ?? null };
}

/** The GPU's caps on one render target side: min of MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE and MAX_VIEWPORT_DIMS. */
export interface TargetLimits {
  readonly maxWidth: number;
  readonly maxHeight: number;
}

/**
 * The largest integer scale s ≤ `requested` whose s·`width` × s·`height` targets fit `limits` and hold at most
 * `MAX_SUPERSAMPLED_PIXELS` pixels; 1 when no larger one does (the frame itself was sized within the limits).
 */
export function supersampledScale(requested: number, width: number, height: number, limits: TargetLimits): number {
  for (let s = Math.min(Math.floor(requested), MAX_SUPERSAMPLE); s > 1; s--) {
    const fits = s * width <= limits.maxWidth && s * height <= limits.maxHeight;
    if (fits && s * s * width * height <= MAX_SUPERSAMPLED_PIXELS) return s;
  }
  return 1;
}
