import type { SceneDocument, SceneMesh } from '@modelshot/scene';

/** Meshes of the world-chart load scene, each just at the world-chart gate (MAX_WORLD_MESH_TRIANGLES). */
const MESHES = 49;
const COLUMNS = 64;
const ROWS = 32;
const TRIANGLES = COLUMNS * ROWS * 2;

/** A small integer hash in 0..1, so the heights are the same on every run. */
function height(mesh: number, x: number, z: number): number {
  let h = Math.imul(mesh + 1, 0x9e3779b1) ^ Math.imul(x + 1, 0x85ebca6b) ^ Math.imul(z + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 2 ** 32;
}

function untextured(name: string, positions: Float32Array, indices: Uint32Array): SceneMesh {
  const vertices = positions.length / 3;
  const normals = new Float32Array(vertices * 3);
  for (let v = 0; v < vertices; v++) normals[v * 3 + 1] = 1;
  return {
    name,
    sourceId: '',
    node: -1,
    visible: true,
    positions,
    normals,
    uvs: new Float32Array(vertices * 2),
    uvRects: new Float32Array(Array.from({ length: vertices }, () => [0, 0, 1, 1]).flat()),
    indices,
    groups: [{ material: -1, start: 0, count: indices.length }],
  };
}

/** A smooth height field of shared vertices at (x0, z0), no two of its triangles in one plane. */
function heightField(m: number, x0: number, z0: number): SceneMesh {
  const positions = new Float32Array((COLUMNS + 1) * (ROWS + 1) * 3);
  for (let z = 0; z <= ROWS; z++) {
    for (let x = 0; x <= COLUMNS; x++) {
      positions.set([x0 + x, height(m, x, z) * 2, z0 + z * 2], (z * (COLUMNS + 1) + x) * 3);
    }
  }
  const indices = new Uint32Array(TRIANGLES * 3);
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLUMNS; x++) {
      const a = z * (COLUMNS + 1) + x;
      const c = a + COLUMNS + 1;
      indices.set([a, c, a + 1, a + 1, c, c + 1], (z * COLUMNS + x) * 6);
    }
  }
  return untextured(`field-${m}`, positions, indices);
}

/**
 * Every triangle on one unit edge along x at (x0, z0), the pages of a book around it: one edge of 4096 triangles,
 * small, so the first frame does not draw 4096 layers over a large part of the image.
 */
function edgeFan(m: number, x0: number, z0: number): SceneMesh {
  const positions = new Float32Array((TRIANGLES + 2) * 3);
  positions.set([x0, 0, z0, x0 + 1, 0, z0]);
  const indices = new Uint32Array(TRIANGLES * 3);
  for (let i = 0; i < TRIANGLES; i++) {
    const angle = (Math.PI * (i + 0.5)) / TRIANGLES;
    positions.set([x0 + 0.5, Math.sin(angle), z0 + Math.cos(angle)], (i + 2) * 3);
    indices.set([0, 1, i + 2], i * 3);
  }
  return untextured(`fan-${m}`, positions, indices);
}

/**
 * Load budget of world charts (MS-41): 49 untextured meshes of 4096 triangles each (200 704). 42 are smooth height
 * fields with shared vertices and no two triangles in one plane, so every triangle is its own chart and every mesh is
 * drawn de-indexed; every seventh is an edge fan, all of its triangles on one edge (quadratic for a chart search that
 * walks every triangle of a shared edge, MS-41 round 2).
 */
export function worldLoadScene(base: SceneDocument): SceneDocument {
  const meshes: SceneMesh[] = [];
  for (let m = 0; m < MESHES; m++) {
    const x0 = (m % 7) * (COLUMNS + 4) - 3.5 * (COLUMNS + 4);
    const z0 = Math.floor(m / 7) * (ROWS * 2 + 4) - 3.5 * (ROWS * 2 + 4);
    meshes.push(m % 7 === 6 ? edgeFan(m, x0, z0) : heightField(m, x0, z0));
  }
  return { ...base, nodes: [], rootNodes: [], meshes };
}
