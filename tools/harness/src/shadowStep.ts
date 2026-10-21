import { luminance, pixel, type Image } from './imageMetrics';

export interface ShadowStep {
  /** Luminance under the cut-out texel minus under the opaque one. */
  readonly step: number;
  /** Pixels along the line between them whose luminance lies strictly between 10 % and 90 % of the way. */
  readonly transition: number;
  readonly values: readonly number[];
}

/**
 * How pixel-shaped a shadow edge is: luminance at the shadow of a cut-out texel (`lit`) and of an opaque one (`dark`),
 * sampled every quarter pixel along the image line between them. A shadow that keeps the texel's shape has a large
 * step and a transition of a pixel or two.
 */
export function shadowStep(
  image: Image,
  lit: { readonly x: number; readonly y: number },
  dark: { readonly x: number; readonly y: number },
): ShadowStep {
  const length = Math.hypot(dark.x - lit.x, dark.y - lit.y);
  const steps = Math.ceil(length * 4);
  const values = Array.from({ length: steps + 1 }, (_, i) =>
    luminance(pixel(image, lit.x + ((dark.x - lit.x) * i) / steps, lit.y + ((dark.y - lit.y) * i) / steps)),
  );
  const high = values[0] ?? 0;
  const low = values[steps] ?? 0;
  const between = values.filter((v) => v < high - 0.1 * (high - low) && v > low + 0.1 * (high - low)).length;
  return { step: high - low, transition: (between * length) / steps, values };
}
