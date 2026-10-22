import { luminance, pixel, type Image } from './imageMetrics';

export interface OutlineHullProbe {
  /** Luminance (3 x 3 mean) at the image centre, which shows the board, with the hull and without it. */
  readonly boardWithHull: number;
  readonly boardAlone: number;
  /** Pixels the hull darkens by over 40 levels to below 50: its rim around the board's silhouette. */
  readonly rimPixels: number;
}

const centreLuminance = (image: Image): number => {
  const cx = Math.floor(image.width / 2);
  const cy = Math.floor(image.height / 2);
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += luminance(pixel(image, cx + dx, cy + dy));
  return sum / 9;
};

/**
 * The outline-hull scene (`withHull`) against the same view of the board alone: an inverted hull drawn as Blockbench
 * outlines intend leaves the board's colour and adds a dark rim; drawn as an outward box it would cover the board.
 */
export function outlineHullProbe(withHull: Image, boardAlone: Image): OutlineHullProbe {
  if (withHull.width !== boardAlone.width || withHull.height !== boardAlone.height)
    throw new Error('image sizes differ');
  let rimPixels = 0;
  for (let y = 0; y < withHull.height; y++) {
    for (let x = 0; x < withHull.width; x++) {
      const hull = luminance(pixel(withHull, x, y));
      if (hull < 50 && hull < luminance(pixel(boardAlone, x, y)) - 40) rimPixels++;
    }
  }
  return { boardWithHull: centreLuminance(withHull), boardAlone: centreLuminance(boardAlone), rimPixels };
}
