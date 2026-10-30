import { pixel, type Image } from './imageMetrics';

type Point2 = readonly [number, number];
type Rgb = readonly [number, number, number];

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

/** Per image row of a region: the covered area of an image and of the hard shape it is compared with. */
export interface RowCoverage {
  /** Image row → summed coverage of the region's pixels in that row. */
  readonly area: ReadonlyMap<number, number>;
  /** Image row → the hard shape's covered pixels in that row. */
  readonly hardArea: ReadonlyMap<number, number>;
  /** Rows with a boundary pixel (a 4-neighbour of the other class). */
  readonly boundaryRows: readonly number[];
}

/**
 * Covered area per row inside `region`, for images whose light differs (a preview and a render of the same view):
 * `covered[y * width + x]` is 1 where the hard shape covers the pixel and 0 where it shows what lies behind. A pixel
 * within 2 px of the hard boundary projects in linear light (`linear`, 8-bit display colour to linear) onto the segment
 * from what lies behind to the texel colour, both taken from the image itself: the mean of that class's pixels at least
 * 2 px from the boundary within 4 px (texel interiors), so the reference follows the image's own light and the
 * backdrop's gradient. Every other pixel, and one without both references nearby, counts as the hard shape, so a
 * render's noise inside texels does not add up.
 */
export function rowCoverage(
  image: Image,
  covered: Uint8Array,
  region: readonly Point2[],
  linear: (display: Rgb) => Rgb,
): RowCoverage {
  const { width, height } = image;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : (covered[y * width + x] ?? 0);
  const interior = (x: number, y: number): boolean => {
    const self = at(x, y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (at(x + dx, y + dy) !== self) return false;
    return true;
  };
  // The mean linear colour of the class's interior pixels within 4 px: a render's noise averages out.
  const reference = (x: number, y: number, kind: number): Rgb | null => {
    const sum = [0, 0, 0];
    let count = 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (at(x + dx, y + dy) !== kind || !interior(x + dx, y + dy)) continue;
        linear(pixel(image, x + dx, y + dy)).forEach((v, c) => (sum[c] = (sum[c] ?? 0) + v));
        count++;
      }
    }
    return count === 0 ? null : [(sum[0] ?? 0) / count, (sum[1] ?? 0) / count, (sum[2] ?? 0) / count];
  };
  const area = new Map<number, number>();
  const hardArea = new Map<number, number>();
  const boundaryRows: number[] = [];
  for (let y = 0; y < height; y++) {
    let rowArea = 0;
    let rowHard = 0;
    let rowBoundary = false;
    let any = false;
    for (let x = 0; x < width; x++) {
      if (!inside(region, x, y)) continue;
      any = true;
      const self = at(x, y);
      rowHard += self;
      if ([at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n !== -1 && n !== self)) {
        rowBoundary = true;
      }
      const tl = interior(x, y) ? null : reference(x, y, 1);
      const bl = tl ? reference(x, y, 0) : null;
      if (!tl || !bl) {
        rowArea += self;
        continue;
      }
      const pl = linear(pixel(image, x, y));
      let dot = 0;
      let length2 = 0;
      for (let c = 0; c < 3; c++) {
        const span = (tl[c] ?? 0) - (bl[c] ?? 0);
        length2 += span * span;
        dot += ((pl[c] ?? 0) - (bl[c] ?? 0)) * span;
      }
      rowArea += length2 > 0 ? Math.min(1, Math.max(0, dot / length2)) : self;
    }
    if (!any) continue;
    area.set(y, rowArea);
    hardArea.set(y, rowHard);
    if (rowBoundary) boundaryRows.push(y);
  }
  return { area, hardArea, boundaryRows };
}
