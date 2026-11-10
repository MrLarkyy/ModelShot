import type { SceneDocument } from '@modelshot/scene';
import { quads, texture } from './quadMesh';

/** The floor's texture texels per side, so its lightmap chart's (texel mode): 1 world unit each. */
export const BOUNCE_WALL_FLOOR_TEXELS = 16;
const WALL_TEXELS = 8;
const H = BOUNCE_WALL_FLOOR_TEXELS / 2;
/** The partial wall's texel alpha, as a share: the probability with which a ray stops at it. */
export const BOUNCE_WALL_ALPHA = 128 / 255;

/** Which wall stands at the floor's west edge: its colour and alpha, or none. */
export type BounceWallKind = 'white' | 'black' | 'partial-white' | 'partial-black' | 'cutout' | 'none';

const WALL_TEXEL: Readonly<Record<Exclude<BounceWallKind, 'none'>, readonly number[]>> = {
  white: [255, 255, 255, 255],
  black: [0, 0, 0, 255],
  'partial-white': [255, 255, 255, 128],
  'partial-black': [0, 0, 0, 128],
  cutout: [255, 255, 255, 0],
};

/**
 * The bounce test (MS-57): a 16 x 16 grey floor at y = 0 (texel column 0 at its west edge, x = -8) and an 8-unit
 * single-sided wall standing on that edge, facing east toward the floor and toward Studio's key, in one uniform texel
 * kind: opaque white or black, partial (alpha 128) white or black, cut out, or no triangles at all. Every version has
 * the same layout where the wall has triangles, so the floor's texels draw the same random numbers in each. Textures
 * are generated here (no file, nothing to license).
 */
export function bounceWall(base: SceneDocument, kind: BounceWallKind): SceneDocument {
  const floor = quads(
    'floor',
    [
      {
        corners: [
          [-H, 0, -H],
          [H, 0, -H],
          [H, 0, H],
          [-H, 0, H],
        ],
        outward: [0, 1, 0],
      },
    ],
    0,
    false,
  );
  const wall = quads(
    'wall',
    [
      {
        corners: [
          [-H, H, H],
          [-H, H, -H],
          [-H, 0, -H],
          [-H, 0, H],
        ],
        outward: [1, 0, 0],
      },
    ],
    1,
    false,
  );
  const floorRgba = new Uint8Array(BOUNCE_WALL_FLOOR_TEXELS * BOUNCE_WALL_FLOOR_TEXELS * 4);
  for (let i = 0; i < BOUNCE_WALL_FLOOR_TEXELS ** 2; i++) floorRgba.set([200, 200, 200, 255], i * 4);
  const wallRgba = new Uint8Array(WALL_TEXELS * WALL_TEXELS * 4);
  const texel = kind === 'none' ? [255, 255, 255, 255] : WALL_TEXEL[kind];
  for (let i = 0; i < WALL_TEXELS ** 2; i++) wallRgba.set(texel, i * 4);
  return {
    ...base,
    nodes: [],
    rootNodes: [],
    meshes: [floor, kind === 'none' ? { ...wall, indices: new Uint32Array(0), groups: [] } : wall],
    materials: [
      { name: 'floor', texture: 0 },
      { name: 'wall', texture: 1, alphaMode: 'blend', alphaCutoff: 0.01 },
    ],
    textures: [
      texture('bounce-wall-floor.png', BOUNCE_WALL_FLOOR_TEXELS, floorRgba),
      texture('bounce-wall.png', WALL_TEXELS, wallRgba),
    ],
  };
}
