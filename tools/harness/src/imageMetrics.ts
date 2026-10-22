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

type Rgb3 = readonly [number, number, number];

const leansMagenta = ([r, g, b]: Rgb3): boolean => r - g > 24 && b - g > 24;

/** Distance of `p` to the triangle a, b, c (a segment or a point when corners repeat), all in linear light. */
function triangleDistance(p: Rgb3, a: Rgb3, b: Rgb3, c: Rgb3): number {
  const sub = (u: Rgb3, v: Rgb3): Rgb3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: Rgb3, v: Rgb3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const along = (u: Rgb3, v: Rgb3, t: number): Rgb3 => [u[0] + t * v[0], u[1] + t * v[1], u[2] + t * v[2]];
  const segment = (u: Rgb3, v: Rgb3): number => {
    const d = sub(v, u);
    const length2 = dot(d, d);
    const t = length2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, u), d) / length2)) : 0;
    const r = sub(p, along(u, d, t));
    return Math.sqrt(dot(r, r));
  };
  let best = Math.min(segment(a, b), segment(b, c), segment(a, c));
  // Inside the triangle: barycentric coordinates of p's projection onto its plane.
  const [e0, e1, w] = [sub(b, a), sub(c, a), sub(p, a)];
  const [d00, d01, d11, d20, d21] = [dot(e0, e0), dot(e0, e1), dot(e1, e1), dot(w, e0), dot(w, e1)];
  const det = d00 * d11 - d01 * d01;
  if (det > 1e-12) {
    const v = (d11 * d20 - d01 * d21) / det;
    const u = (d00 * d21 - d01 * d20) / det;
    if (v >= 0 && u >= 0 && u + v <= 1) {
      const r = sub(w, [v * e0[0] + u * e1[0], v * e0[1] + u * e1[1], v * e0[2] + u * e1[2]]);
      best = Math.min(best, Math.sqrt(dot(r, r)));
    }
  }
  return best;
}

/**
 * Pixels whose hue leans to the magenta sentinel: red and blue both clearly above green. With `linear` (8-bit display
 * colour to linear light), a pixel within 0.01 in linear light of a blend of up to three of its 8 neighbours that do
 * not lean magenta does not count: an anti-aliased edge where a red texel meets a blue one (MSAA resolves in linear
 * light) is such a blend, a sentinel texel read into a face is not, its colour lies in none of its neighbours.
 */
export function sentinelPixels(image: Image, linear?: (display: Rgb3) => Rgb3): number {
  let count = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const p = pixel(image, x, y);
      if (!leansMagenta(p)) continue;
      if (linear && blendOfNeighbours(image, x, y, linear)) continue;
      count++;
    }
  }
  return count;
}

function blendOfNeighbours(image: Image, x: number, y: number, linear: (display: Rgb3) => Rgb3): boolean {
  const neighbours: Rgb3[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const [nx, ny] = [x + dx, y + dy];
      if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
      const n = pixel(image, nx, ny);
      if (!leansMagenta(n)) neighbours.push(linear(n));
    }
  }
  const p = linear(pixel(image, x, y));
  for (let i = 0; i < neighbours.length; i++) {
    for (let j = i; j < neighbours.length; j++) {
      for (let k = j; k < neighbours.length; k++) {
        const [a, b, c] = [neighbours[i], neighbours[j], neighbours[k]];
        if (a && b && c && triangleDistance(p, a, b, c) <= 0.01) return true;
      }
    }
  }
  return false;
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

/** The backdrop's display colour (0..255) of image row `y` (top 0), for a gradient backdrop. */
export type BackdropRow = (y: number, height: number) => readonly number[];

/**
 * Whether each pixel shows the backdrop, row-major: within 2 levels of `backdropRow` of its row (a look's gradient,
 * `agxToneMap(backdropColor(look, …))`), by default of the top-left pixel (a flat backdrop).
 */
export function backdropMask(image: Image, backdropRow?: BackdropRow): Uint8Array {
  const flat = pixel(image, 0, 0);
  const mask = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y++) {
    const backdrop = backdropRow ? backdropRow(y, image.height) : flat;
    for (let x = 0; x < image.width; x++) mask[y * image.width + x] = near(pixel(image, x, y), backdrop, 2) ? 1 : 0;
  }
  return mask;
}

/**
 * Framing check of a preview and a render of the same view: pixels where one shows the backdrop and the other does
 * not, leaving out silhouette pixels (whose 3 x 3 neighbourhood in `reference` holds both classes), where box-filtered
 * and multisampled coverage may round either way, and pixels both images draw within 2 levels of each other (a dark
 * texel close to the backdrop colour falls on either side of the backdrop test; the two views agree there). `backdropRow`:
 * the backdrop of a gradient (`backdropMask`).
 */
export function silhouetteMismatches(
  reference: Image,
  other: Image,
  backdropRow?: BackdropRow,
): { mismatches: number; silhouette: number } {
  if (reference.width !== other.width || reference.height !== other.height) throw new Error('image sizes differ');
  const a = backdropMask(reference, backdropRow);
  const b = backdropMask(other, backdropRow);
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
      else if (a[y * width + x] !== b[y * width + x] && !near(pixel(reference, x, y), pixel(other, x, y), 2)) {
        mismatches++;
      }
    }
  }
  return { mismatches, silhouette };
}

/** How `silhouettePixels` tells the model from the backdrop and how far from it the silhouette reaches. */
export interface SilhouetteOptions {
  /** A pixel within this many levels per channel of its row's backdrop (column 1) is backdrop. */
  readonly backdropTolerance: number;
  /** A model pixel with a backdrop pixel at most this many pixels away in x and y is on the silhouette. */
  readonly reach: number;
}

/**
 * The model's pixels, split into its silhouette's (the outline band, a backdrop pixel within `reach`) and the interior,
 * as RGB: the backdrop of each row is the colour of its pixel in column 1 (a flat or vertical-gradient backdrop with
 * the model clear of the left edge), and a border of `reach` pixels around the image is left out.
 */
export function silhouettePixels(
  image: Image,
  { backdropTolerance, reach }: SilhouetteOptions,
): {
  model: [number, number, number][];
  silhouette: [number, number, number][];
  interior: [number, number, number][];
} {
  const { width, height } = image;
  const backdrop = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = pixel(image, Math.min(1, width - 1), y);
    for (let x = 0; x < width; x++) backdrop[y * width + x] = near(pixel(image, x, y), row, backdropTolerance) ? 1 : 0;
  }
  const model: [number, number, number][] = [];
  const silhouette: [number, number, number][] = [];
  const interior: [number, number, number][] = [];
  for (let y = reach; y < height - reach; y++) {
    for (let x = reach; x < width - reach; x++) {
      if (backdrop[y * width + x]) continue;
      const rgb = pixel(image, x, y);
      model.push(rgb);
      let edge = false;
      for (let dy = -reach; dy <= reach && !edge; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (backdrop[(y + dy) * width + x + dx]) {
            edge = true;
            break;
          }
        }
      }
      (edge ? silhouette : interior).push(rgb);
    }
  }
  return { model, silhouette, interior };
}

/** Pixels whose every channel is above `level` (near-white at 200, blown out at 249). */
export function whiteCount(pixels: readonly (readonly number[])[], level: number): number {
  let count = 0;
  for (const [r = 0, g = 0, b = 0] of pixels) if (Math.min(r, g, b) > level) count++;
  return count;
}

function sameSize(a: Image, b: Image): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image sizes differ: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  }
}

/**
 * RGB error of `image` against `reference` in 8-bit display levels over the pixels `mask` sets (every pixel without
 * one): root mean square and mean absolute, per channel.
 */
export function imageError(
  image: Image,
  reference: Image,
  mask?: Uint8Array,
): { rmse: number; mae: number; pixels: number } {
  sameSize(image, reference);
  let squares = 0;
  let absolute = 0;
  let pixels = 0;
  for (let p = 0; p < image.width * image.height; p++) {
    if (mask && !mask[p]) continue;
    pixels++;
    for (let c = 0; c < 3; c++) {
      const d = (image.data[p * 4 + c] ?? 0) - (reference.data[p * 4 + c] ?? 0);
      squares += d * d;
      absolute += Math.abs(d);
    }
  }
  const values = Math.max(1, pixels * 3);
  return { rmse: Math.sqrt(squares / values), mae: absolute / values, pixels };
}

const lumaAt = (image: Image, x: number, y: number): number => luminance(pixel(image, x, y));

/**
 * The pixels on either side of a step of at least `levels` in luma between horizontal or vertical neighbours of
 * `image`: texel boundaries, silhouettes and hard shadow edges of a converged render.
 */
export function edgeMask(image: Image, levels: number): Uint8Array {
  const { width, height } = image;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = lumaAt(image, x, y);
      if (x + 1 < width && Math.abs(lumaAt(image, x + 1, y) - here) >= levels) {
        mask[y * width + x] = 1;
        mask[y * width + x + 1] = 1;
      }
      if (y + 1 < height && Math.abs(lumaAt(image, x, y + 1) - here) >= levels) {
        mask[y * width + x] = 1;
        mask[(y + 1) * width + x] = 1;
      }
    }
  }
  return mask;
}

/** The pixels more than `distance` pixels (in x or y) from every pixel `mask` sets. */
export function farFrom(mask: Uint8Array, width: number, height: number, distance: number): Uint8Array {
  const far = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -distance; dy <= distance; dy++) {
        for (let dx = -distance; dx <= distance; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) far[ny * width + nx] = 0;
        }
      }
    }
  }
  return far;
}

/**
 * How much of the reference's edge contrast `image` keeps where `mask` is set: the projection Σ g·r / Σ r·r of the luma
 * steps g of `image` onto those r of `reference`, to the right and downward neighbour of each pixel. 1 for the
 * reference itself, under 1 when edges are blurred or softened; noise uncorrelated with the edges averages out.
 */
export function edgeSharpness(image: Image, reference: Image, mask: Uint8Array): number {
  sameSize(image, reference);
  const { width, height } = image;
  let projected = 0;
  let energy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const g0 = lumaAt(image, x, y);
      const r0 = lumaAt(reference, x, y);
      for (const [nx, ny] of [
        [x + 1, y],
        [x, y + 1],
      ] as const) {
        if (nx >= width || ny >= height) continue;
        const r = lumaAt(reference, nx, ny) - r0;
        projected += (lumaAt(image, nx, ny) - g0) * r;
        energy += r * r;
      }
    }
  }
  return energy > 0 ? projected / energy : 1;
}

/** Mean RGB of each `block` × `block` block, row-major (the edge blocks clipped): a coarse image of `image`. */
export function blockMeans(image: Image, block: number): number[][] {
  const means: number[][] = [];
  for (let by = 0; by < image.height; by += block) {
    for (let bx = 0; bx < image.width; bx += block) {
      const sum = [0, 0, 0];
      let count = 0;
      for (let y = by; y < Math.min(by + block, image.height); y++) {
        for (let x = bx; x < Math.min(bx + block, image.width); x++) {
          pixel(image, x, y).forEach((v, c) => (sum[c] = (sum[c] ?? 0) + v));
          count++;
        }
      }
      means.push(sum.map((v) => v / count));
    }
  }
  return means;
}
