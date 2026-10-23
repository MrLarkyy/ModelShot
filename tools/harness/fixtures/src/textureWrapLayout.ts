/**
 * Geometry and colours of the texture-wrap scene (textureWrapScene.ts), without imports so the Playwright spec can read
 * them. Three 24 x 8 x 4 boxes stacked along y; the south face (z = 2) of each shows u -4 .. 20 of a 16 x 16 texture,
 * one model unit per texel column, so it passes the image by 4 texels on both sides. Texel rows are all alike.
 */
export const WRAP_TEXELS = 16;

export type WrapCubeName = 'hytale-clamp' | 'free-clamp' | 'free-repeat';

export interface WrapCube {
  readonly name: WrapCubeName;
  readonly wrap: 'clamp' | 'repeat';
  /** Bottom of the box; it spans y .. y + 8. */
  readonly y: number;
}

/** Top to bottom: a Hytale texture without wrap_mode, a free one without wrap_mode, a free one stored as repeat. */
export const WRAP_CUBES: readonly WrapCube[] = [
  { name: 'hytale-clamp', wrap: 'clamp', y: 22 },
  { name: 'free-clamp', wrap: 'clamp', y: 11 },
  { name: 'free-repeat', wrap: 'repeat', y: 0 },
];

export const WRAP_FACE_UV = [-4, 0, 20, 16] as const;

/** World point at texel coordinate u (u -4 .. 20) half way up the south face of `cube`. */
export function wrapFacePoint(cube: WrapCube, u: number): [number, number, number] {
  return [u - 12 - WRAP_FACE_UV[0], cube.y + 4, 2];
}

type Rgb = readonly [number, number, number];

/**
 * Display sRGB of the wrap texture's columns: the ones the probes tell apart, every other column green. Column 0 is
 * teal, not blue: the anti-aliased seam where repeat puts it beside orange column 15 would lean magenta (the sentinel).
 */
export const WRAP_COLUMN_COLORS: Readonly<Record<0 | 12 | 15 | 'other', Rgb>> = {
  0: [30, 170, 170],
  12: [235, 235, 235],
  15: [240, 140, 30],
  other: [70, 160, 70],
};

/** The sentinel image beside every wrap texture: a pixel of it in a face means a lookup left its image. */
export const WRAP_SENTINEL: Rgb = [255, 0, 255];

export function wrapColumnColor(column: number): Rgb {
  return column === 0 || column === 12 || column === 15 ? WRAP_COLUMN_COLORS[column] : WRAP_COLUMN_COLORS.other;
}
