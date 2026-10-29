/**
 * Geometry and colours of the texture-filter scene (textureFilterScene.ts), without imports so the Playwright spec can
 * read them. Quads in the plane z = 0 facing +z, each showing an 8 x 8 texture: top row, left to right, the checker
 * filtered linearly, the same image nearest (a second sampler) and a linear mask with a cut-out 2 x 2 block; bottom row
 * a linear texture repeated past its image (u -2 .. 10) and the checker linear, repeated and minified (eight texels per
 * model unit).
 */
export const FILTER_TEXELS = 8;

export type FilterQuadName = 'linear' | 'nearest' | 'cutout' | 'repeat' | 'minified';

export interface FilterQuad {
  readonly name: FilterQuadName;
  readonly filter: 'nearest' | 'linear';
  readonly wrap: 'clamp' | 'repeat';
  /** The quad spans x[0] .. x[1], y[0] .. y[1] at z = 0. */
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  /** UVs [u0, v0, u1, v1] in texels of the image: (u0, v0) at the top left corner, (u1, v1) at the bottom right. */
  readonly uv: readonly [number, number, number, number];
}

export const FILTER_QUADS: readonly FilterQuad[] = [
  { name: 'linear', filter: 'linear', wrap: 'clamp', x: [-14, -6], y: [10, 18], uv: [0, 0, 8, 8] },
  { name: 'nearest', filter: 'nearest', wrap: 'clamp', x: [-4, 4], y: [10, 18], uv: [0, 0, 8, 8] },
  { name: 'cutout', filter: 'linear', wrap: 'clamp', x: [6, 14], y: [10, 18], uv: [0, 0, 8, 8] },
  { name: 'repeat', filter: 'linear', wrap: 'repeat', x: [-14, -2], y: [0, 8], uv: [-2, 0, 10, 8] },
  { name: 'minified', filter: 'linear', wrap: 'repeat', x: [2, 14], y: [0, 8], uv: [0, 0, 96, 64] },
];

export function filterQuad(name: FilterQuadName): FilterQuad {
  const quad = FILTER_QUADS.find((q) => q.name === name);
  if (!quad) throw new Error(`no filter quad ${name}`);
  return quad;
}

/** World point at texel coordinates (u, v) of the image on `quad` (v down the image). */
export function filterQuadPoint(quad: FilterQuad, u: number, v: number): [number, number, number] {
  const [u0, v0, u1, v1] = quad.uv;
  const across = (u - u0) / (u1 - u0);
  const down = (v - v0) / (v1 - v0);
  return [quad.x[0] + across * (quad.x[1] - quad.x[0]), quad.y[1] - down * (quad.y[1] - quad.y[0]), 0];
}

type Rgb = readonly [number, number, number];

/**
 * Display sRGB of the checker's two texels ((x + y) even: yellow) and of the cut-out mask. No blend of them, nor with
 * the backdrop, leans magenta, the sentinel's hue.
 */
export const FILTER_COLORS: Readonly<Record<'even' | 'odd' | 'mask', Rgb>> = {
  even: [235, 200, 60],
  odd: [40, 150, 190],
  mask: [240, 225, 130],
};

/** Columns of the repeat texture: column 0 white, the last orange, every other green (rows all alike). */
export const REPEAT_COLUMN_COLORS: Readonly<Record<'first' | 'last' | 'other', Rgb>> = {
  first: [235, 235, 235],
  last: [240, 140, 30],
  other: [70, 160, 70],
};

/** The cut-out block of the mask texture: texels 3 .. 4 in x and y, alpha 0 and black, as exporters often leave them. */
export const CUTOUT_BLOCK = { from: 3, to: 4 } as const;

/** The sentinel image right of every linear texture in the path tracer's texture layers. */
export const FILTER_SENTINEL: Rgb = [255, 0, 255];

export function checkerColor(x: number, y: number): Rgb {
  return (x + y) % 2 === 0 ? FILTER_COLORS.even : FILTER_COLORS.odd;
}

export function repeatColumnColor(column: number): Rgb {
  if (column === 0) return REPEAT_COLUMN_COLORS.first;
  return column === FILTER_TEXELS - 1 ? REPEAT_COLUMN_COLORS.last : REPEAT_COLUMN_COLORS.other;
}

export function inCutoutBlock(x: number, y: number): boolean {
  return x >= CUTOUT_BLOCK.from && x <= CUTOUT_BLOCK.to && y >= CUTOUT_BLOCK.from && y <= CUTOUT_BLOCK.to;
}
