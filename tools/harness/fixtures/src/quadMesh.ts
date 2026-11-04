import type { SceneMesh, SceneTexture } from '@modelshot/scene';
import { encodeRgbaPng } from './encodeRgbaPng';

export type Point = [number, number, number];

export function texture(name: string, width: number, rgba: Uint8Array): SceneTexture {
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

export interface Face {
  readonly corners: readonly Point[];
  readonly outward: Point;
}

/** Quads (corners top-left, top-right, bottom-right, bottom-left as seen from outside) as one mesh with own vertices. */
export function quads(name: string, faces: readonly Face[], material: number, doubleSided: boolean): SceneMesh {
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
