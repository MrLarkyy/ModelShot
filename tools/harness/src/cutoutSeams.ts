import { near, pixel, type Image } from './imageMetrics';

type Point2 = readonly [number, number];

/** Pixel measures of an anti-aliased cutout frame against the same view drawn with hard per-texel cutouts (aa=0). */
export interface CutoutSeams {
  /** Pixels differing by more than 2 levels in some channel that lie more than 1 px from a hard-frame boundary. */
  readonly farChanges: number;
  /** Hard-frame model/backdrop boundary pixels inside the region. */
  readonly boundary: number;
  /** Of those, the strict mixes: neither within 2 levels of the backdrop nor of the texel colour. */
  readonly mixes: number;
  /** Pairs of 4-neighbours inside the region that are model and backdrop in the hard frame. */
  readonly transitions: number;
  /** Of those, the pairs with a strict mix on either side. */
  readonly mixedTransitions: number;
  /**
   * Covered area inside the region: the hard frame's model pixels, and the frame's summed coverage (each pixel's
   * position between backdrop and texel colour in linear light, where the MSAA resolve averaged its samples).
   */
  readonly hardArea: number;
  readonly area: number;
  /** Rows of the region with a boundary pixel. */
  readonly boundaryRows: number;
}

const model = (image: Image, backdrop: Image, x: number, y: number): boolean =>
  !near(pixel(image, x, y), pixel(backdrop, x, y), 2);

/** Inside the convex polygon `region` (image pixels, either winding), at the pixel centre. */
function inside(region: readonly Point2[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < region.length; i++) {
    const [ax, ay] = region[i] ?? [0, 0];
    const [bx, by] = region[(i + 1) % region.length] ?? [0, 0];
    const cross = (bx - ax) * (y + 0.5 - ay) - (by - ay) * (x + 0.5 - ax);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * Compares `frame` with `hard`, the same view with hard cutouts, over `backdrop` (the view with nothing drawn). The
 * texel colour at a pixel is the hard frame's colour of the nearest model pixel in its 3 x 3 neighbourhood; coverage
 * projects a pixel onto the backdrop-to-texel segment after `linear` (8-bit display colour to linear light). Mixes,
 * transitions and area count inside `region` only.
 */
export function cutoutSeams(
  frame: Image,
  hard: Image,
  backdrop: Image,
  region: readonly Point2[],
  linear: (display: readonly [number, number, number]) => readonly [number, number, number],
): CutoutSeams {
  const linearCache = new Map<number, readonly [number, number, number]>();
  const toLinear = (rgb: [number, number, number]): readonly [number, number, number] => {
    const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    let value = linearCache.get(key);
    if (!value) {
      value = linear(rgb);
      linearCache.set(key, value);
    }
    return value;
  };
  const { width, height } = hard;
  const isModel = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) isModel[y * width + x] = model(hard, backdrop, x, y) ? 1 : 0;
  }
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : (isModel[y * width + x] ?? 0);
  const isBoundary = (x: number, y: number): boolean => {
    const self = at(x, y);
    return [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n !== -1 && n !== self);
  };
  const nearBoundary = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isBoundary(x + dx, y + dy)) return true;
    return false;
  };
  const texel = (x: number, y: number): [number, number, number] | null => {
    let best: [number, number, number] | null = null;
    let bestDistance = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const d = dx * dx + dy * dy;
        if (at(x + dx, y + dy) === 1 && d < bestDistance) {
          best = pixel(hard, x + dx, y + dy);
          bestDistance = d;
        }
      }
    }
    return best;
  };

  let farChanges = 0;
  let boundary = 0;
  let mixes = 0;
  let hardArea = 0;
  let area = 0;
  let boundaryRows = 0;
  const mixed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let rowHasBoundary = false;
    for (let x = 0; x < width; x++) {
      const p = pixel(frame, x, y);
      if (!near(p, pixel(hard, x, y), 2) && !nearBoundary(x, y)) farChanges++;
      if (!inside(region, x, y)) continue;
      const b = pixel(backdrop, x, y);
      if (at(x, y) === 1) hardArea++;
      const t = texel(x, y);
      if (t && near(p, t, 0)) {
        area++;
      } else if (t && !near(p, b, 0)) {
        const [pl, bl, tl] = [toLinear(p), toLinear(b), toLinear(t)];
        const span = [0, 1, 2].map((c) => (tl[c] ?? 0) - (bl[c] ?? 0));
        const length2 = span.reduce((sum, v) => sum + v * v, 0);
        const dot = [0, 1, 2].reduce((sum, c) => sum + ((pl[c] ?? 0) - (bl[c] ?? 0)) * (span[c] ?? 0), 0);
        if (length2 > 0) area += Math.min(1, Math.max(0, dot / length2));
      }
      if (!isBoundary(x, y)) continue;
      rowHasBoundary = true;
      boundary++;
      if (t && !near(p, b, 2) && !near(p, t, 2)) {
        mixes++;
        mixed[y * width + x] = 1;
      }
    }
    if (rowHasBoundary) boundaryRows++;
  }
  let transitions = 0;
  let mixedTransitions = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(region, x, y)) continue;
      for (const [nx, ny] of [
        [x + 1, y],
        [x, y + 1],
      ] as const) {
        const other = at(nx, ny);
        if (other === -1 || other === at(x, y) || !inside(region, nx, ny)) continue;
        transitions++;
        if (mixed[y * width + x] || mixed[ny * width + nx]) mixedTransitions++;
      }
    }
  }
  return { farChanges, boundary, mixes, transitions, mixedTransitions, hardArea, area, boundaryRows };
}
