import type { SceneDocument } from '@modelshot/scene';
import { quads, texture, type Face } from './cutoutChecker';

const TEXELS = 16;
const H = 4;

const FACES: readonly Face[] = [
  {
    corners: [
      [-H, 2 * H, H],
      [H, 2 * H, H],
      [H, 0, H],
      [-H, 0, H],
    ],
    outward: [0, 0, 1],
  },
  {
    corners: [
      [H, 2 * H, -H],
      [-H, 2 * H, -H],
      [-H, 0, -H],
      [H, 0, -H],
    ],
    outward: [0, 0, -1],
  },
  {
    corners: [
      [H, 2 * H, H],
      [H, 2 * H, -H],
      [H, 0, -H],
      [H, 0, H],
    ],
    outward: [1, 0, 0],
  },
  {
    corners: [
      [-H, 2 * H, -H],
      [-H, 2 * H, H],
      [-H, 0, H],
      [-H, 0, -H],
    ],
    outward: [-1, 0, 0],
  },
  {
    corners: [
      [-H, 2 * H, -H],
      [H, 2 * H, -H],
      [H, 2 * H, H],
      [-H, 2 * H, H],
    ],
    outward: [0, 1, 0],
  },
  {
    corners: [
      [-H, 0, H],
      [H, 0, H],
      [H, 0, -H],
      [-H, 0, -H],
    ],
    outward: [0, -1, 0],
  },
];

/**
 * One opaque 8 x 8 x 8 cuboid with flat faces and a generated opaque 16 x 16 texture (no file, nothing to license):
 * convex, so no bake ray from a face can meet the model and every fill ray over the surface escapes (MS-87).
 */
export function convexCube(base: SceneDocument): SceneDocument {
  const rgba = new Uint8Array(TEXELS * TEXELS * 4);
  for (let i = 0; i < TEXELS * TEXELS; i++) rgba.set([200, 160, 120, 255], i * 4);
  return {
    ...base,
    nodes: [],
    rootNodes: [],
    meshes: [quads('convex-cube', FACES, 0, false)],
    materials: [{ name: 'convex', texture: 0 }],
    textures: [texture('convex-cube.png', TEXELS, rgba)],
  };
}
