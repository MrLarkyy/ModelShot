import {
  mat4TransformPoint,
  meshVisible,
  nodeVisibility,
  worldMatrices,
  type Mat4,
  type SceneDocument,
  type SceneMesh,
  type Vec3,
} from '@modelshot/scene';

export interface LocalBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The twelve edges of a box over the corner order of `boxCorners`. */
export const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/** The twelve triangles of a box over the corner order of `boxCorners`. */
export const BOX_TRIANGLES: readonly (readonly [number, number, number])[] = [
  [0, 1, 3],
  [0, 3, 2],
  [4, 6, 7],
  [4, 7, 5],
  [0, 4, 5],
  [0, 5, 1],
  [2, 3, 7],
  [2, 7, 6],
  [0, 2, 6],
  [0, 6, 4],
  [1, 5, 7],
  [1, 7, 3],
];

/** Most boxes the selection outline draws one by one; a larger subtree gets one box around it. */
export const MAX_OUTLINE_BOXES = 256;

const cache = new WeakMap<SceneMesh, LocalBox | null>();

/** The axis-aligned box of a mesh's vertices in its own space (cached per mesh); null for a mesh without a finite vertex. */
export function localBox(mesh: SceneMesh): LocalBox | null {
  const cached = cache.get(mesh);
  if (cached !== undefined) return cached;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a] ?? NaN;
      if (!Number.isFinite(v)) continue;
      min[a] = Math.min(min[a] ?? v, v);
      max[a] = Math.max(max[a] ?? v, v);
    }
  }
  const box = min[0] <= max[0] && min[1] <= max[1] && min[2] <= max[2] ? { min, max } : null;
  cache.set(mesh, box);
  return box;
}

/** The eight corners, x fastest (bit 0), then y, then z, placed by `matrix` when given. */
export function boxCorners(box: LocalBox, matrix?: Mat4): Vec3[] {
  const corners: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? box.max[0] : box.min[0],
      i & 2 ? box.max[1] : box.min[1],
      i & 4 ? box.max[2] : box.min[2],
    ];
    corners.push(matrix ? mat4TransformPoint(matrix, corner) : corner);
  }
  return corners;
}

export interface PlacedBox {
  readonly mesh: number;
  readonly corners: Vec3[];
}

/** The boxes of the shown meshes in world space, for picking and the outline. */
export function placedBoxes(doc: SceneDocument, only?: ReadonlySet<number>): PlacedBox[] {
  const world = worldMatrices(doc.nodes);
  const visibility = nodeVisibility(doc);
  const out: PlacedBox[] = [];
  doc.meshes.forEach((mesh, index) => {
    if (only && !only.has(index)) return;
    if (!meshVisible(doc, index, visibility)) return;
    const box = localBox(mesh);
    if (box) out.push({ mesh: index, corners: boxCorners(box, mesh.node >= 0 ? world[mesh.node] : undefined) });
  });
  return out;
}

/** The meshes of a node and everything below it. */
export function subtreeMeshes(doc: SceneDocument, node: number): Set<number> {
  const meshes = new Set<number>();
  const stack = [node];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const current = doc.nodes[index];
    if (!current || seen.has(index)) continue;
    seen.add(index);
    for (const mesh of current.meshes) meshes.add(mesh);
    stack.push(...current.children);
  }
  return meshes;
}

/** One axis-aligned box around all `boxes`' corners, as eight corners. */
export function enclosingBox(boxes: readonly PlacedBox[]): Vec3[] | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (const corner of box.corners) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a] ?? 0, corner[a] ?? 0);
        max[a] = Math.max(max[a] ?? 0, corner[a] ?? 0);
      }
    }
  }
  return min[0] <= max[0] ? boxCorners({ min, max }) : null;
}
