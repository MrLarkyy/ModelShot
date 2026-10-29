/**
 * Geometry and colours of the texture-wrap scene (textureWrapScene.ts), without imports so the Playwright spec can read
 * them. Boxes 4 deep (z -2 .. 2) whose south face (z = 2) passes its texture: on the left three 24 x 8 boxes stacked
 * along y showing u -4 .. 20 of a 16 x 16 still texture (one model unit per texel column, rows all alike); on the right
 * two 16 x 14 boxes showing v -3 .. 11 of frame 0 of a two-frame strip (16 x 16 pixels on a 16 x 8 UV space, one unit
 * per texel), whose frame 1 is the sentinel.
 */
export const WRAP_TEXELS = 16;
/** Rows of one frame of the strip texture (its UV height); the image holds two. */
export const STRIP_FRAME_ROWS = 8;

export type WrapCubeName = 'hytale-clamp' | 'free-clamp' | 'free-repeat' | 'strip-clamp' | 'strip-repeat';

export interface WrapCube {
  readonly name: WrapCubeName;
  readonly wrap: 'clamp' | 'repeat';
  /** The box spans x[0] .. x[1], y[0] .. y[1]. */
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  /** The south face's Blockbench uv [u1, v1, u2, v2] in the texture's UV space. */
  readonly uv: readonly [number, number, number, number];
}

const STILL_UV = [-4, 0, 20, 16] as const;
// Three rows past the frame on each side, so the probes stay clear of the rounded box edges.
const STRIP_UV = [0, -3, 16, 11] as const;

/**
 * Left, top to bottom: a Hytale texture without wrap_mode, a free one without wrap_mode, a free one stored as repeat;
 * right, top to bottom: a free strip without wrap_mode and one stored as repeat.
 */
export const WRAP_CUBES: readonly WrapCube[] = [
  { name: 'hytale-clamp', wrap: 'clamp', x: [-24, 0], y: [22, 30], uv: STILL_UV },
  { name: 'free-clamp', wrap: 'clamp', x: [-24, 0], y: [11, 19], uv: STILL_UV },
  { name: 'free-repeat', wrap: 'repeat', x: [-24, 0], y: [0, 8], uv: STILL_UV },
  { name: 'strip-clamp', wrap: 'clamp', x: [4, 20], y: [16, 30], uv: STRIP_UV },
  { name: 'strip-repeat', wrap: 'repeat', x: [4, 20], y: [0, 14], uv: STRIP_UV },
];

export function wrapCube(name: WrapCubeName): WrapCube {
  const cube = WRAP_CUBES.find((c) => c.name === name);
  if (!cube) throw new Error(`no wrap cube ${name}`);
  return cube;
}

/** World point at texel coordinates (u, v) of the south face of `cube`; v defaults to half way up the face. */
export function wrapFacePoint(cube: WrapCube, u: number, v?: number): [number, number, number] {
  const [u1, v1, u2, v2] = cube.uv;
  const along = (u - u1) / (u2 - u1);
  const down = ((v ?? (v1 + v2) / 2) - v1) / (v2 - v1);
  return [cube.x[0] + along * (cube.x[1] - cube.x[0]), cube.y[1] - down * (cube.y[1] - cube.y[0]), 2];
}

type Rgb = readonly [number, number, number];

/**
 * Display sRGB of the still texture's columns: the ones the probes tell apart, every other column green. Column 0 is
 * teal, not blue: the anti-aliased seam where repeat puts it beside orange column 15 would lean magenta (the sentinel).
 */
export const WRAP_COLUMN_COLORS: Readonly<Record<0 | 12 | 15 | 'other', Rgb>> = {
  0: [30, 170, 170],
  12: [235, 235, 235],
  15: [240, 140, 30],
  other: [70, 160, 70],
};

/** The sentinel image beside every still wrap texture, and frame 1 of the strip: a pixel of it means a lookup left. */
export const WRAP_SENTINEL: Rgb = [255, 0, 255];

export function wrapColumnColor(column: number): Rgb {
  return column === 0 || column === 12 || column === 15 ? WRAP_COLUMN_COLORS[column] : WRAP_COLUMN_COLORS.other;
}

/** Frame 0 of the strip, by row: row 0 white, the last row orange, every other green (all columns alike). */
export function stripRowColor(row: number): Rgb {
  if (row === 0) return WRAP_COLUMN_COLORS[12];
  return row === STRIP_FRAME_ROWS - 1 ? WRAP_COLUMN_COLORS[15] : WRAP_COLUMN_COLORS.other;
}
