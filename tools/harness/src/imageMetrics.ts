import { PNG } from 'pngjs';

/** A decoded RGBA image, rows top to bottom (PNG order). */
export interface Image {
  width: number;
  height: number;
  data: Buffer;
}

export function decodePng(png: Buffer): Image {
  return PNG.sync.read(png);
}

/** RGB at (x, y), floored to the pixel grid. */
export function pixel(image: Image, x: number, y: number): [number, number, number] {
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0];
}

export const near = (a: readonly number[], b: readonly number[], levels: number): boolean =>
  a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= levels);

/** Rec. 709 luma of display-encoded RGB. */
export const luminance = ([r, g, b]: readonly number[]): number =>
  0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);

/** Pixels whose hue leans to the magenta sentinel: red and blue both clearly above green. */
export function sentinelPixels(image: Image): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const [r = 0, g = 0, b = 0] = image.data.subarray(i, i + 3);
    if (r - g > 24 && b - g > 24) count++;
  }
  return count;
}

/** Bounding box of the pixels that differ from the backdrop (the top-left pixel). */
export function modelBox(image: Image): { x0: number; y0: number; x1: number; y1: number } {
  const backdrop = pixel(image, 0, 0);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (near(pixel(image, x, y), backdrop, 2)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

/** Cosine between two RGB colours (lighting and tone mapping scale a texel's colour but keep its direction). */
export function hueMatch(a: readonly number[], b: readonly number[]): number {
  const dot = [0, 1, 2].reduce((sum, k) => sum + (a[k] ?? 0) * (b[k] ?? 0), 0);
  return dot / (Math.hypot(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0) * Math.hypot(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0));
}

/** Whether each pixel shows the backdrop (within 2 levels of the top-left pixel), row-major. */
export function backdropMask(image: Image): Uint8Array {
  const backdrop = pixel(image, 0, 0);
  const mask = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) mask[y * image.width + x] = near(pixel(image, x, y), backdrop, 2) ? 1 : 0;
  }
  return mask;
}

/**
 * Framing check of a preview and a render of the same view: pixels where one shows the backdrop and the other does
 * not, leaving out silhouette pixels (whose 3 x 3 neighbourhood in `reference` holds both classes), where box-filtered
 * and multisampled coverage may round either way.
 */
export function silhouetteMismatches(reference: Image, other: Image): { mismatches: number; silhouette: number } {
  if (reference.width !== other.width || reference.height !== other.height) throw new Error('image sizes differ');
  const a = backdropMask(reference);
  const b = backdropMask(other);
  const { width, height } = reference;
  let mismatches = 0;
  let silhouette = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let mixed = false;
      for (let dy = -1; dy <= 1 && !mixed; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          if (a[ny * width + nx] !== a[y * width + x]) {
            mixed = true;
            break;
          }
        }
      }
      if (mixed) silhouette++;
      else if (a[y * width + x] !== b[y * width + x]) mismatches++;
    }
  }
  return { mismatches, silhouette };
}
