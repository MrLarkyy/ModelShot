import { EDGE_WELD_DISTANCE } from '@modelshot/scene';

/** Positions closer than this (model units) are the same corner when matching shared edges. */
const SHARED_EDGE_EPSILON = 1e-5;

/** Unit normals at least this close to opposite: the neighbour is folded back onto the triangle. */
const FOLD_COS = -0.9999;

/** More triangles than this on one edge leave it open, so the neighbour search stays linear. */
const MAX_EDGE_FAN = 8;

/** Bit of `exactEdgeWords` x: edge i has no plain neighbour (`OPEN_EDGE << i`). */
export const OPEN_EDGE = 8;

/**
 * Per triangle, bit i set when its edge i (corner i to corner i + 1) is shared, by position, with another triangle of
 * the batch that lies in the same plane (normals within 1e-4 radians of each other, same side): the inner edges of a
 * quad or polygon face. A pixel whose centre ray leaves the triangle only across such edges still meets the same
 * plane, so the exact key keeps the centre ray there.
 */
export function sharedEdgeFlags(positions: Float32Array, indices: Uint32Array): Uint8Array {
  const triangles = Math.floor(indices.length / 3);
  // One id per distinct position (within SHARED_EDGE_EPSILON), so faces with their own vertices still match.
  const vertexCount = Math.floor(positions.length / 3);
  const ids = new Uint32Array(vertexCount);
  const byPosition = new Map<string, number>();
  for (let v = 0; v < vertexCount; v++) {
    const q = (k: number) => Math.round((positions[v * 3 + k] ?? 0) / SHARED_EDGE_EPSILON);
    const key = `${q(0)},${q(1)},${q(2)}`;
    let id = byPosition.get(key);
    if (id === undefined) {
      id = byPosition.size;
      byPosition.set(key, id);
    }
    ids[v] = id;
  }
  const normals = faceNormals(positions, indices);
  const coplanar = (s: number, t: number) =>
    (normals[s * 3] ?? 0) * (normals[t * 3] ?? 0) +
      (normals[s * 3 + 1] ?? 0) * (normals[t * 3 + 1] ?? 0) +
      (normals[s * 3 + 2] ?? 0) * (normals[t * 3 + 2] ?? 0) >
    1 - 5e-9;
  const distinct = byPosition.size;
  const firstOwner = new Map<number, number>();
  const flags = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    for (let i = 0; i < 3; i++) {
      const a = ids[indices[t * 3 + i] ?? 0] ?? 0;
      const b = ids[indices[t * 3 + ((i + 1) % 3)] ?? 0] ?? 0;
      const key = Math.min(a, b) * distinct + Math.max(a, b);
      const owner = firstOwner.get(key);
      if (owner === undefined) {
        firstOwner.set(key, t * 3 + i);
        continue;
      }
      const other = Math.floor(owner / 3);
      if (other !== t && coplanar(t, other)) {
        flags[t] = (flags[t] ?? 0) | (1 << i);
        flags[other] = (flags[other] ?? 0) | (1 << (owner % 3));
      }
    }
  }
  return flags;
}

/**
 * The edge word of every triangle of an indexed batch, four uint32 per triangle, the attribute at location 7 of the
 * de-indexed geometry (`triangleCornersVertex.glsl`):
 * - x: bits 0-2 `sharedEdgeFlags`; bit `OPEN_EDGE << i` when edge i has no plain neighbour. Triangles meet by position,
 *   welded to `EDGE_WELD_DISTANCE`; one with the same third corner as this one lies on it (a zero-thickness card's other
 *   side) and is no neighbour. The edge is open when no other triangle meets it, when the others reach two or more
 *   third corners (non-manifold) or more than `MAX_EDGE_FAN` triangles share it, or when the neighbour is degenerate,
 *   has a non-finite corner or is folded back onto this one (unit normals opposite within `FOLD_COS`). An open edge is
 *   a silhouette from every view.
 * - y, z, w: per edge i the neighbour's unit face normal as its own winding gives it (never re-oriented: a neighbour
 *   wound against this triangle faces away where this one faces the eye, as a culled back face does), octahedral in
 *   two snorm16 (x in the low half), as GLSL's unpackSnorm2x16 reads it; 0 on an open edge. Where both sides of a card
 *   lie across the edge, the one facing most like this triangle.
 * A triangle with a non-finite corner has every edge open. Linear in the triangle count, deterministic.
 */
export function exactEdgeWords(positions: Float32Array, indices: Uint32Array): Uint32Array {
  const triangles = Math.floor(indices.length / 3);
  const words = new Uint32Array(triangles * 4);
  const shared = sharedEdgeFlags(positions, indices);
  const normals = faceNormals(positions, indices);
  const ids = weldedIds(positions);
  const distinct = ids.reduce((max, id) => Math.max(max, id + 1), 0);
  const corner = (t: number, c: number): number => ids[indices[t * 3 + (c % 3)] ?? 0] ?? -1;
  const edgeKey = (t: number, i: number): number => {
    const a = corner(t, i);
    const b = corner(t, i + 1);
    if (a < 0 || b < 0 || a === b) return -1;
    return Math.min(a, b) * distinct + Math.max(a, b);
  };
  // Per welded edge its triangle edges (triangle × 3 + edge) as a list: head per edge, next per triangle edge.
  const slots = new Map<number, number>();
  const head: number[] = [];
  const count: number[] = [];
  const next = new Int32Array(triangles * 3).fill(-1);
  for (let t = 0; t < triangles; t++) {
    for (let i = 0; i < 3; i++) {
      const key = edgeKey(t, i);
      if (key < 0) continue;
      let slot = slots.get(key);
      if (slot === undefined) {
        slot = head.length;
        slots.set(key, slot);
        head.push(-1);
        count.push(0);
      }
      next[t * 3 + i] = head[slot] ?? -1;
      head[slot] = t * 3 + i;
      count[slot] = (count[slot] ?? 0) + 1;
    }
  }
  for (let t = 0; t < triangles; t++) {
    let bits = shared[t] ?? 0;
    const own = normalAt(normals, t);
    for (let i = 0; i < 3; i++) {
      const key = edgeKey(t, i);
      const slot = key < 0 ? undefined : slots.get(key);
      let neighbour: readonly [number, number, number] | null = null;
      let facing = -Infinity;
      let open = !own || slot === undefined || (count[slot] ?? 0) > MAX_EDGE_FAN;
      const third = corner(t, i + 2);
      // The third corner the triangles across the edge share.
      let across = -1;
      for (let e = open || slot === undefined ? -1 : (head[slot] ?? -1); e >= 0; e = next[e] ?? -1) {
        const other = Math.floor(e / 3);
        const otherThird = corner(other, (e % 3) + 2);
        if (other === t || otherThird === third) continue;
        const n = normalAt(normals, other);
        if (!n || (across >= 0 && otherThird !== across)) {
          open = true;
          break;
        }
        across = otherThird;
        const d = own ? own[0] * n[0] + own[1] * n[1] + own[2] * n[2] : -Infinity;
        if (d > facing) {
          facing = d;
          neighbour = n;
        }
      }
      if (!open && neighbour && facing > FOLD_COS) {
        words[t * 4 + 1 + i] = octSnorm16x2(neighbour[0], neighbour[1], neighbour[2]);
      } else {
        bits |= OPEN_EDGE << i;
      }
    }
    words[t * 4] = bits;
  }
  return words;
}

/** Unit face normal per triangle from its winding; [0, 0, 0] for a degenerate one, NaN for a non-finite corner. */
function faceNormals(positions: Float32Array, indices: Uint32Array): Float64Array {
  const triangles = Math.floor(indices.length / 3);
  const normals = new Float64Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const p = (c: number, k: number) => positions[(indices[t * 3 + c] ?? 0) * 3 + k] ?? 0;
    const u = [p(1, 0) - p(0, 0), p(1, 1) - p(0, 1), p(1, 2) - p(0, 2)] as const;
    const w = [p(2, 0) - p(0, 0), p(2, 1) - p(0, 1), p(2, 2) - p(0, 2)] as const;
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    for (let k = 0; k < 3; k++) normals[t * 3 + k] = (n[k] ?? 0) / length;
  }
  return normals;
}

/** Triangle t's unit normal, or null when it is degenerate or not finite. */
function normalAt(normals: Float64Array, t: number): readonly [number, number, number] | null {
  const n = [normals[t * 3] ?? NaN, normals[t * 3 + 1] ?? NaN, normals[t * 3 + 2] ?? NaN] as const;
  const length2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
  return Number.isFinite(length2) && length2 > 0.5 ? n : null;
}

/** One id per distinct position quantised to `EDGE_WELD_DISTANCE`; −1 for a vertex with a non-finite coordinate. */
function weldedIds(positions: Float32Array): Int32Array {
  const vertexCount = Math.floor(positions.length / 3);
  const ids = new Int32Array(vertexCount).fill(-1);
  const byPosition = new Map<string, number>();
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3] ?? NaN;
    const y = positions[v * 3 + 1] ?? NaN;
    const z = positions[v * 3 + 2] ?? NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    // + 0 turns −0 into 0, so both sides of zero weld.
    const q = (c: number) => Math.round(c / EDGE_WELD_DISTANCE) + 0;
    const key = `${q(x)},${q(y)},${q(z)}`;
    let id = byPosition.get(key);
    if (id === undefined) {
      id = byPosition.size;
      byPosition.set(key, id);
    }
    ids[v] = id;
  }
  return ids;
}

/** A unit vector, octahedral, as two snorm16 in one uint32 (x low), the layout of GLSL unpackSnorm2x16. */
function octSnorm16x2(x: number, y: number, z: number): number {
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let u = x / sum;
  let v = y / sum;
  if (z < 0) {
    const fu = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1);
    const fv = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1);
    u = fu;
    v = fv;
  }
  const snorm = (f: number) => Math.round(Math.min(1, Math.max(-1, f)) * 32767) & 0xffff;
  return (snorm(u) | (snorm(v) << 16)) >>> 0;
}
