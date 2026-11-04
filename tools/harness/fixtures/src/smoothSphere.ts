import type { SceneDocument, SceneMesh } from '@modelshot/scene';

const SEGMENTS = 24;
const RINGS = 12;
const RADIUS = 4;

function sphereMesh(): SceneMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const theta = (i * Math.PI) / RINGS;
    for (let j = 0; j <= SEGMENTS; j++) {
      const phi = (j * 2 * Math.PI) / SEGMENTS;
      const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      positions.push(n[0]! * RADIUS, n[1]! * RADIUS + RADIUS, n[2]! * RADIUS);
      normals.push(...n);
      uvs.push(j / SEGMENTS, i / RINGS);
    }
  }
  const indices: number[] = [];
  const at = (i: number, j: number): number => i * (SEGMENTS + 1) + j;
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  const vertices = positions.length / 3;
  return {
    name: 'smooth-sphere',
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    uvRects: new Float32Array(Array.from({ length: vertices }, () => [0, 0, 1, 1]).flat()),
    indices: new Uint32Array(indices),
    groups: [{ material: 0, start: 0, count: indices.length, doubleSided: false }],
  };
}

/**
 * One opaque untextured sphere of smooth vertex normals, built in code (nothing to license): convex, so nothing blocks
 * a bake ray, yet the faceted triangles put cosine rays about the smooth normal under their geometric side (MS-87).
 */
export function smoothSphere(base: SceneDocument): SceneDocument {
  return {
    ...base,
    nodes: [],
    rootNodes: [],
    meshes: [sphereMesh()],
    materials: [{ name: 'smooth', texture: -1 }],
    textures: [],
  };
}
