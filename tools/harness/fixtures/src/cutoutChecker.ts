import { LIGHT_RIG_V0 } from '@modelshot/looks';
import type { SceneDocument, SceneMesh, SceneTexture } from '@modelshot/scene';
import { encodeRgbaPng } from './encodeRgbaPng';

type Point = [number, number, number];

const KEY = LIGHT_RIG_V0.lights.key.direction;
const KEY_XZ = Math.hypot(KEY[0], KEY[2]);
/** The plane faces the key's horizontal direction, so its texel columns cast straight-back shadows. */
export const CHECKER_NORMAL: Point = [KEY[0] / KEY_XZ, 0, KEY[2] / KEY_XZ];
/** Along the plane, to its right seen from the light. */
export const CHECKER_TANGENT: Point = [CHECKER_NORMAL[2], 0, -CHECKER_NORMAL[0]];
/** The plane's texels are 1 unit; its bottom row starts 1 unit above the ground (the catcher's height, y 0). */
export const CHECKER_BOTTOM = 1;
const CUBE_TEXELS = 64;
/** The box's top: the checker rows above it shadow it from about a unit away, so their shadows keep the texel shape. */
export const BOX_HEIGHT = 4.5;

/** World point of (s along the tangent, d behind the plane, y up). */
export function checkerPoint(s: number, d: number, y: number): Point {
  return [s * CHECKER_TANGENT[0] - d * CHECKER_NORMAL[0], y, s * CHECKER_TANGENT[2] - d * CHECKER_NORMAL[2]];
}

function texture(name: string, width: number, rgba: Uint8Array): SceneTexture {
  return {
    name,
    mimeType: 'image/png',
    bytes: encodeRgbaPng(width, width, rgba),
    width,
    height: width,
    uvWidth: width,
    uvHeight: width,
    missing: false,
  };
}

/** 8 x 8 texels: (column + row) even opaque orange, odd cut out (alpha 0). */
function checkerTexture(): SceneTexture {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) {
    if (((i % 8) + Math.floor(i / 8)) % 2 === 0) rgba.set([224, 120, 56, 255], i * 4);
  }
  return texture('cutout-checker.png', 8, rgba);
}

function greyTexture(): SceneTexture {
  return texture('cutout-checker-grey.png', CUBE_TEXELS, new Uint8Array(CUBE_TEXELS * CUBE_TEXELS * 4).fill(200));
}

interface Face {
  readonly corners: readonly Point[];
  readonly outward: Point;
}

/** Quads (corners top-left, top-right, bottom-right, bottom-left as seen from outside) as one mesh with own vertices. */
function quads(name: string, faces: readonly Face[], material: number, doubleSided: boolean): SceneMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const { corners, outward } of faces) {
    const base = positions.length / 3;
    corners.forEach((corner, i) => {
      positions.push(...corner);
      normals.push(...outward);
      uvs.push(
        ...([
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ][i] ?? [0, 0]),
      );
    });
    // Counter-clockwise seen from outside: top-left, bottom-left, bottom-right, then top-left, bottom-right, top-right.
    indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
  }
  const vertices = positions.length / 3;
  return {
    name,
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    uvRects: new Float32Array(Array.from({ length: vertices }, () => [0, 0, 1, 1]).flat()),
    indices: new Uint32Array(indices),
    groups: [{ material, start: 0, count: indices.length, doubleSided }],
  };
}

/** An opaque box over s in [s0, s1], d in [d0, d1], y in [0, h], in the plane's frame. */
function box(s0: number, s1: number, d0: number, d1: number, h: number): SceneMesh {
  const p = checkerPoint;
  const n = CHECKER_NORMAL;
  const t = CHECKER_TANGENT;
  const faces: Face[] = [
    // Towards the plane (+n) and away (-n).
    { corners: [p(s0, d0, h), p(s1, d0, h), p(s1, d0, 0), p(s0, d0, 0)], outward: n },
    { corners: [p(s1, d1, h), p(s0, d1, h), p(s0, d1, 0), p(s1, d1, 0)], outward: [-n[0], 0, -n[2]] },
    // Right (+t) and left.
    { corners: [p(s1, d0, h), p(s1, d1, h), p(s1, d1, 0), p(s1, d0, 0)], outward: t },
    { corners: [p(s0, d1, h), p(s0, d0, h), p(s0, d0, 0), p(s0, d1, 0)], outward: [-t[0], 0, -t[2]] },
    // Top and bottom.
    { corners: [p(s0, d1, h), p(s1, d1, h), p(s1, d0, h), p(s0, d0, h)], outward: [0, 1, 0] },
    { corners: [p(s0, d0, 0), p(s1, d0, 0), p(s1, d1, 0), p(s0, d1, 0)], outward: [0, -1, 0] },
  ];
  return quads('cube', faces, 1, false);
}

/**
 * The pixel-shaped shadow test: a vertical double-sided 8 x 8 checker of cut-out and opaque texels (1 unit each,
 * bottom row 1 unit above the ground) facing the key light, and half a unit behind its right half an opaque grey box
 * that receives that half's shadow on its front and top; the left half's lower rows shadow the shadow catcher. Textures are
 * generated here (no file, nothing to license).
 */
export function cutoutChecker(base: SceneDocument): SceneDocument {
  const p = checkerPoint;
  const top = CHECKER_BOTTOM + 8;
  const plane = quads(
    'checker',
    [
      {
        corners: [p(-4, 0, top), p(4, 0, top), p(4, 0, CHECKER_BOTTOM), p(-4, 0, CHECKER_BOTTOM)],
        outward: CHECKER_NORMAL,
      },
    ],
    0,
    true,
  );
  return {
    ...base,
    nodes: [],
    rootNodes: [],
    meshes: [plane, box(0.25, 4.25, 0.5, 3.5, BOX_HEIGHT)],
    materials: [
      { name: 'checker', texture: 0, alphaMode: 'mask', alphaCutoff: 0.5 },
      { name: 'grey', texture: 1 },
    ],
    textures: [checkerTexture(), greyTexture()],
  };
}
