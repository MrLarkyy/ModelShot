import type { SceneMesh } from './SceneMesh';

/** Distance of an empty edge slot: farther than any rounding reaches. */
export const NO_EDGE = 1e6;
/** Sharp edges a triangle can round at once. */
export const EDGE_SLOTS = 4;
/** Two faces folded this far (degrees) or more are a zero-thickness card's front and back, never a rounded edge. */
export const MAX_SHARP_ANGLE_DEG = 170;
/** Positions closer than this (model units) are the same corner when matching edges. */
export const EDGE_WELD_DISTANCE = 1e-4;
/** Candidate checks of one mesh's slot assignment; past it the remaining triangles round no edge (hostile input). */
export const MAX_EDGE_CHECKS = 20_000_000;

export interface SharpEdgeOptions {
  /** Faces meeting at this angle between their normals (degrees) or more form a sharp edge. */
  readonly sharpAngleDeg: number;
  /** Farthest distance (model units) a triangle takes an edge into its slots from: the largest rounding width. */
  readonly reach: number;
}

/**
 * Per-vertex edge data of one mesh, derived and never stored in the scene format. A vertex shared by triangles that
 * round different edges is split: output vertex `i` copies `SceneMesh` vertex `vertexOf[i]`, and `indices` replaces
 * `SceneMesh.indices` (same length and triangle order, so group ranges stay valid).
 */
export interface SharpEdgeAttributes {
  readonly vertexOf: Uint32Array;
  readonly indices: Uint32Array;
  /**
   * 4 per output vertex: its distance (model units) to the line of each sharp edge in its triangle's slots, measured
   * in the triangle's plane toward the interior and never negative; `NO_EDGE` in an empty slot. Affine across a
   * triangle, so interpolating the corners gives the distance at every point.
   */
  readonly distances: Float32Array;
  /**
   * 4 per output vertex, the same on all corners of a triangle: the angle (radians) between the normals of the faces
   * meeting at each slot's edge, positive where the edge is convex, negative where it is a crease; 0 in an empty slot.
   */
  readonly angles: Float32Array;
  /** Sharp edges found in the mesh. */
  readonly edgeCount: number;
}

/** One side of a sharp edge: what a triangle of the patch on that side needs to measure its distance to the edge. */
interface EdgeSide {
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  /** Unit direction in the owning triangle's plane, perpendicular to the edge, toward the interior. */
  readonly inward: readonly [number, number, number];
  readonly angle: number;
  /** Bounds of the segment grown by the reach: [minX, minY, minZ, maxX, maxY, maxZ]. */
  readonly box: readonly number[];
}

type V3 = [number, number, number];

const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] ?? 0) - (b[0] ?? 0),
  (a[1] ?? 0) - (b[1] ?? 0),
  (a[2] ?? 0) - (b[2] ?? 0),
];
const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
  (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
  (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
];

function pointSegmentDistance(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = sub(b, a);
  const length = dot(ab, ab);
  const t = length > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / length)) : 0;
  return Math.hypot(...sub(p, [(a[0] ?? 0) + ab[0] * t, (a[1] ?? 0) + ab[1] * t, (a[2] ?? 0) + ab[2] * t]));
}

/** Distance between two segments that do not cross (edges of one surface): the nearest of their endpoints' distances. */
function segmentDistance(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]) {
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function find(parent: Int32Array, i: number): number {
  let root = i;
  while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
  while ((parent[i] ?? i) !== root) {
    const next = parent[i] ?? i;
    parent[i] = root;
    i = next;
  }
  return root;
}

/**
 * The sharp edges of `mesh` and, per vertex, the distances and angles a renderer rounds them with. An edge is sharp
 * where exactly two non-degenerate triangles meet (by position, within `EDGE_WELD_DISTANCE`), the angle between their
 * normals is at least `sharpAngleDeg` and below `MAX_SHARP_ANGLE_DEG`, and their vertex normals differ there (a
 * smooth-shaded edge is not sharp). Boundary edges (planes), edges of three or more triangles and back-to-back folds
 * (zero-thickness cards) never are. Triangles joined across other edges form a patch; each triangle takes up to
 * `EDGE_SLOTS` sharp edges of its patch within `reach` that have all its corners on their interior side, the nearest
 * first, kept in a fixed order so neighbours with the same edges share vertices. Pure and deterministic; triangles
 * with a non-finite corner or no area round nothing. Indices out of range throw a `RangeError`.
 */
export function sharpEdges(mesh: SceneMesh, options: SharpEdgeOptions): SharpEdgeAttributes {
  const { positions, normals, indices } = mesh;
  const vertexCount = Math.floor(positions.length / 3);
  const triangles = Math.floor(indices.length / 3);
  for (let i = 0; i < triangles * 3; i++) {
    if ((indices[i] ?? 0) >= vertexCount) throw new RangeError(`sharpEdges: index ${i} is out of range`);
  }
  const point = (v: number): V3 => [positions[v * 3] ?? 0, positions[v * 3 + 1] ?? 0, positions[v * 3 + 2] ?? 0];
  const corner = (t: number, c: number): number => indices[t * 3 + c] ?? 0;

  // One id per distinct position, so faces with their own vertices (every Blockbench cube face) still meet.
  const ids = new Int32Array(vertexCount).fill(-1);
  const byPosition = new Map<string, number>();
  for (let v = 0; v < vertexCount; v++) {
    const p = point(v);
    if (!p.every(Number.isFinite)) continue;
    const key = p.map((x) => Math.round(x / EDGE_WELD_DISTANCE)).join(',');
    let id = byPosition.get(key);
    if (id === undefined) {
      id = byPosition.size;
      byPosition.set(key, id);
    }
    ids[v] = id;
  }

  const faceNormals = new Float64Array(triangles * 3);
  const valid = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    if (![0, 1, 2].every((c) => (ids[corner(t, c)] ?? -1) >= 0)) continue;
    const p0 = point(corner(t, 0));
    const n = cross(sub(point(corner(t, 1)), p0), sub(point(corner(t, 2)), p0));
    const length = Math.hypot(...n);
    if (!(length > 0) || !Number.isFinite(length)) continue;
    const distinct = new Set([0, 1, 2].map((c) => ids[corner(t, c)]));
    if (distinct.size < 3) continue;
    valid[t] = 1;
    faceNormals.set([n[0] / length, n[1] / length, n[2] / length], t * 3);
  }

  // Edge key → its first and second triangle side (t * 3 + i, edge i from corner i to i + 1); more marks non-manifold.
  const distinctIds = byPosition.size;
  const first = new Map<number, number>();
  const second = new Map<number, number>();
  const crowded = new Set<number>();
  for (let t = 0; t < triangles; t++) {
    if (!valid[t]) continue;
    for (let i = 0; i < 3; i++) {
      const a = ids[corner(t, i)] ?? 0;
      const b = ids[corner(t, (i + 1) % 3)] ?? 0;
      const key = Math.min(a, b) * distinctIds + Math.max(a, b);
      if (!first.has(key)) first.set(key, t * 3 + i);
      else if (!second.has(key)) second.set(key, t * 3 + i);
      else crowded.add(key);
    }
  }

  const parent = new Int32Array(triangles).map((_, i) => i);
  const sharpCos = Math.cos((options.sharpAngleDeg * Math.PI) / 180);
  const foldCos = Math.cos((MAX_SHARP_ANGLE_DEG * Math.PI) / 180);
  const sameNormal = (v: number, w: number): boolean =>
    v === w ||
    dot(
      [normals[v * 3] ?? 0, normals[v * 3 + 1] ?? 0, normals[v * 3 + 2] ?? 0],
      [normals[w * 3] ?? 0, normals[w * 3 + 1] ?? 0, normals[w * 3 + 2] ?? 0],
    ) >
      1 - 1e-6;
  const faceNormal = (t: number): V3 => [
    faceNormals[t * 3] ?? 0,
    faceNormals[t * 3 + 1] ?? 0,
    faceNormals[t * 3 + 2] ?? 0,
  ];
  const sharpPairs: [number, number, number][] = [];
  for (const [key, sideA] of first) {
    const sideB = second.get(key);
    if (sideB === undefined || crowded.has(key)) continue;
    const ta = Math.floor(sideA / 3);
    const tb = Math.floor(sideB / 3);
    if (ta === tb) continue;
    const cos = dot(faceNormal(ta), faceNormal(tb));
    if (cos <= foldCos) continue;
    // Endpoints of the edge in each triangle, matched by position id.
    const a0 = corner(ta, sideA % 3);
    const a1 = corner(ta, ((sideA % 3) + 1) % 3);
    const b0 = corner(tb, sideB % 3);
    const b1 = corner(tb, ((sideB % 3) + 1) % 3);
    const [m0, m1] = ids[a0] === ids[b0] ? [b0, b1] : [b1, b0];
    const smooth = sameNormal(a0, m0) && sameNormal(a1, m1);
    if (cos > sharpCos || smooth) {
      parent[find(parent, ta)] = find(parent, tb);
      continue;
    }
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    // Convex where the other face's far corner lies below this face's plane.
    const far = corner(tb, ((sideB % 3) + 2) % 3);
    const convex = dot(faceNormal(ta), sub(point(far), point(a0))) < 0;
    sharpPairs.push([sideA, sideB, convex ? angle : -angle]);
  }

  if (sharpPairs.length === 0) {
    return {
      vertexOf: Uint32Array.from({ length: vertexCount }, (_, i) => i),
      indices: Uint32Array.from(indices.subarray(0, triangles * 3)),
      distances: new Float32Array(vertexCount * EDGE_SLOTS).fill(NO_EDGE),
      angles: new Float32Array(vertexCount * EDGE_SLOTS),
      edgeCount: 0,
    };
  }

  // Each sharp edge has a side in the patch of either triangle.
  const sidesByPatch = new Map<number, number[]>();
  const sides: EdgeSide[] = [];
  const reach = Math.max(0, options.reach);
  for (const [sideA, sideB, angle] of sharpPairs) {
    for (const side of [sideA, sideB]) {
      const t = Math.floor(side / 3);
      const a = point(corner(t, side % 3));
      const b = point(corner(t, ((side % 3) + 1) % 3));
      const opposite = point(corner(t, ((side % 3) + 2) % 3));
      const along = sub(b, a);
      const inward = cross(faceNormal(t), along);
      const length = Math.hypot(...inward);
      const unit: V3 = [inward[0] / length, inward[1] / length, inward[2] / length];
      if (dot(unit, sub(opposite, a)) < 0) unit.forEach((x, k) => (unit[k] = -x));
      const box = [0, 1, 2].map((k) => Math.min(a[k] ?? 0, b[k] ?? 0) - reach);
      box.push(...[0, 1, 2].map((k) => Math.max(a[k] ?? 0, b[k] ?? 0) + reach));
      const patch = find(parent, t);
      let list = sidesByPatch.get(patch);
      if (!list) {
        list = [];
        sidesByPatch.set(patch, list);
      }
      list.push(sides.length);
      sides.push({ a, b, inward: unit, angle, box });
    }
  }

  // Slots per triangle: side ids in ascending order.
  const slots: (number[] | null)[] = new Array<number[] | null>(triangles).fill(null);
  let checks = 0;
  for (let t = 0; t < triangles && checks < MAX_EDGE_CHECKS; t++) {
    if (!valid[t]) continue;
    const list = sidesByPatch.get(find(parent, t));
    if (!list) continue;
    const p = [0, 1, 2].map((c) => point(corner(t, c)));
    const min = [0, 1, 2].map((k) => Math.min(...p.map((q) => q[k] ?? 0)));
    const max = [0, 1, 2].map((k) => Math.max(...p.map((q) => q[k] ?? 0)));
    const near: [number, number][] = [];
    for (const id of list) {
      if (++checks > MAX_EDGE_CHECKS) break;
      const side = sides[id];
      if (!side) continue;
      if ([0, 1, 2].some((k) => (min[k] ?? 0) > (side.box[k + 3] ?? 0) || (max[k] ?? 0) < (side.box[k] ?? 0))) continue;
      if (p.some((q) => dot(sub(q, side.a), side.inward) < -EDGE_WELD_DISTANCE)) continue;
      let distance = Infinity;
      for (let c = 0; c < 3; c++) {
        distance = Math.min(distance, segmentDistance(p[c] ?? [0, 0, 0], p[(c + 1) % 3] ?? [0, 0, 0], side.a, side.b));
      }
      if (distance <= reach) near.push([distance, id]);
    }
    if (near.length === 0) continue;
    near.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    slots[t] = near
      .slice(0, EDGE_SLOTS)
      .map(([, id]) => id)
      .sort((x, y) => x - y);
  }

  // Split vertices by the slot set of the triangles using them.
  const outVertex = new Map<string, number>();
  const vertexOf: number[] = [];
  const outIndices = new Uint32Array(triangles * 3);
  const distances: number[] = [];
  const angles: number[] = [];
  for (let t = 0; t < triangles; t++) {
    const set = slots[t] ?? [];
    const setKey = set.join(',');
    for (let c = 0; c < 3; c++) {
      const v = corner(t, c);
      const key = `${v}|${setKey}`;
      let out = outVertex.get(key);
      if (out === undefined) {
        out = vertexOf.length;
        outVertex.set(key, out);
        vertexOf.push(v);
        const q = point(v);
        for (let k = 0; k < EDGE_SLOTS; k++) {
          const side = set[k] === undefined ? undefined : sides[set[k] ?? 0];
          distances.push(side ? Math.max(0, dot(sub(q, side.a), side.inward)) : NO_EDGE);
          angles.push(side ? side.angle : 0);
        }
      }
      outIndices[t * 3 + c] = out;
    }
  }
  // Vertices no triangle uses keep their place, so a mesh without sharp edges maps one to one.
  const identity = vertexOf.length === vertexCount && vertexOf.every((v, i) => v === i);
  if (!identity) {
    const used = new Uint8Array(vertexCount);
    for (const v of vertexOf) used[v] = 1;
    for (let v = 0; v < vertexCount; v++) {
      if (used[v]) continue;
      vertexOf.push(v);
      for (let k = 0; k < EDGE_SLOTS; k++) {
        distances.push(NO_EDGE);
        angles.push(0);
      }
    }
  }
  return {
    vertexOf: Uint32Array.from(vertexOf),
    indices: outIndices,
    distances: Float32Array.from(distances),
    angles: Float32Array.from(angles),
    edgeCount: sharpPairs.length,
  };
}

const cache = new WeakMap<SceneMesh, Map<string, SharpEdgeAttributes>>();

/**
 * `sharpEdges` computed once per mesh object and options: another pose of a document keeps its mesh objects
 * (`poseScene`), so re-posing never detects again.
 */
export function cachedSharpEdges(mesh: SceneMesh, options: SharpEdgeOptions): SharpEdgeAttributes {
  let byOptions = cache.get(mesh);
  if (!byOptions) {
    byOptions = new Map();
    cache.set(mesh, byOptions);
  }
  const key = `${options.sharpAngleDeg}:${options.reach}`;
  let result = byOptions.get(key);
  if (!result) {
    result = sharpEdges(mesh, options);
    byOptions.set(key, result);
  }
  return result;
}
