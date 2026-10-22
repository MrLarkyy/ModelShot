import type { SceneDocument, SceneMesh } from '@modelshot/scene';

/** Meshes of the world-chart load scene, each just at the world-chart gate (MAX_WORLD_MESH_TRIANGLES). */
const MESHES = 49;
const COLUMNS = 64;
const ROWS = 32;

/** A small integer hash in 0..1, so the heights are the same on every run. */
function height(mesh: number, x: number, z: number): number {
  let h = Math.imul(mesh + 1, 0x9e3779b1) ^ Math.imul(x + 1, 0x85ebca6b) ^ Math.imul(z + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 2 ** 32;
}

/**
 * Load budget of world charts (MS-41): 49 untextured meshes of 4096 triangles each (200 704), smooth height fields
 * with shared vertices and no two triangles in one plane, so every triangle is its own chart and every mesh is drawn
 * de-indexed: the worst case of the chart unwrap and the per-corner upload at the loaders' scale.
 */
export function worldLoadScene(base: SceneDocument): SceneDocument {
  const meshes: SceneMesh[] = [];
  for (let m = 0; m < MESHES; m++) {
    const x0 = (m % 7) * (COLUMNS + 4) - 3.5 * (COLUMNS + 4);
    const z0 = Math.floor(m / 7) * (ROWS * 2 + 4) - 3.5 * (ROWS * 2 + 4);
    const vertices = (COLUMNS + 1) * (ROWS + 1);
    const positions = new Float32Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    for (let z = 0; z <= ROWS; z++) {
      for (let x = 0; x <= COLUMNS; x++) {
        const v = z * (COLUMNS + 1) + x;
        positions.set([x0 + x, height(m, x, z) * 2, z0 + z * 2], v * 3);
        normals.set([0, 1, 0], v * 3);
      }
    }
    const indices = new Uint32Array(COLUMNS * ROWS * 6);
    for (let z = 0; z < ROWS; z++) {
      for (let x = 0; x < COLUMNS; x++) {
        const a = z * (COLUMNS + 1) + x;
        const b = a + 1;
        const c = a + COLUMNS + 1;
        const d = c + 1;
        indices.set([a, c, b, b, c, d], (z * COLUMNS + x) * 6);
      }
    }
    meshes.push({
      name: `field-${m}`,
      sourceId: '',
      node: -1,
      visible: true,
      positions,
      normals,
      uvs: new Float32Array(vertices * 2),
      uvRects: new Float32Array(Array.from({ length: vertices }, () => [0, 0, 1, 1]).flat()),
      indices,
      groups: [{ material: -1, start: 0, count: indices.length }],
    });
  }
  return { ...base, nodes: [], rootNodes: [], meshes };
}
