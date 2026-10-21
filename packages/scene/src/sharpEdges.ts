import type { SceneMesh } from './SceneMesh';

/** Distance of an empty edge slot: farther than any rounding reaches. */
export const NO_EDGE = 1e6;
/** Sharp edges a triangle can round at once. */
export const EDGE_SLOTS = 4;
/** Two faces folded this far (degrees) or more are a zero-thickness card's front and back, never a rounded edge. */
export const MAX_SHARP_ANGLE_DEG = 170;
/** Positions closer than this (model units) are the same corner when matching edges. */
export const EDGE_WELD_DISTANCE = 1e-4;
/**
 * Work units of the slot search over one document (all its meshes, in order), about 5 ns each on the dev machine: a
 * candidate edge visited costs 1, testing whether the triangle lies beside it 5 more, measuring its distance 20 more,
 * keeping it in order 1 per place moved. Past the budget every later triangle rounds nothing, in every renderer alike
 * (a count, never a clock, so goldens stay stable): a hostile model costs at most about 0.6 s of `setScene` here.
 */
export const MAX_EDGE_WORK = 100_000_000;
/** A candidate edge whose inward direction is within this angle (degrees) of a kept edge's is not taken. */
export const PARALLEL_EDGE_DEG = 30;
const PARALLEL_EDGE_COS = Math.cos((PARALLEL_EDGE_DEG * Math.PI) / 180);
const WORK_VISIT = 1;
const WORK_TEST = 5;
const WORK_DISTANCE = 20;

/** Slot-search work done so far, shared by the meshes of one document (`MAX_EDGE_WORK`). */
export interface EdgeWork {
  used: number;
}

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

/**
 * Dense ids of non-negative integer keys below 2^53: equal keys get equal ids. By sorting (native numeric sort, then a
 * binary search per key), so O(n log n) whatever the keys: no hash table a model could crowd into one probe chain.
 */
function denseIds(keys: Float64Array): { ids: Int32Array; count: number } {
  const sorted = keys.slice().sort();
  let count = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i] !== sorted[count - 1]) sorted[count++] = sorted[i] ?? 0;
  }
  const ids = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] ?? 0;
    let low = 0;
    let high = count - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((sorted[middle] ?? 0) < key) low = middle + 1;
      else high = middle;
    }
    ids[i] = low;
  }
  return { ids, count };
}

/** Dense ids of the pairs (a[i], b[i]) of dense ids, `bCount` the number of distinct b. */
function densePairs(a: Int32Array, b: Int32Array, bCount: number): { ids: Int32Array; count: number } {
  const keys = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) keys[i] = (a[i] ?? 0) * bCount + (b[i] ?? 0);
  return denseIds(keys);
}

/**
 * One id per distinct position (quantised to `EDGE_WELD_DISTANCE`), so faces with their own vertices (every Blockbench
 * cube face) still meet; −1 for a vertex with a non-finite coordinate. Each coordinate is ranked by sorting, then the
 * rank pairs, so no position pattern can make it slower than O(n log n).
 */
function weldPositions(positions: Float32Array, vertexCount: number): Int32Array {
  const ids = new Int32Array(vertexCount).fill(-1);
  const finite: number[] = [];
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3] ?? NaN;
    const y = positions[v * 3 + 1] ?? NaN;
    const z = positions[v * 3 + 2] ?? NaN;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) finite.push(v);
  }
  // Ranks are non-negative, so the coordinate keys are shifted by their minimum; + 0 turns −0 into 0.
  const rank = (k: number) => {
    const q = new Float64Array(finite.length);
    let min = Infinity;
    finite.forEach((v, i) => {
      q[i] = Math.round((positions[v * 3 + k] ?? 0) / EDGE_WELD_DISTANCE) + 0;
      min = Math.min(min, q[i] ?? 0);
    });
    for (let i = 0; i < q.length; i++) q[i] = (q[i] ?? 0) - min;
    return denseIds(q);
  };
  const x = rank(0);
  const y = rank(1);
  const z = rank(2);
  let xyz: { ids: Int32Array; count: number };
  if (x.count * y.count * z.count < 2 ** 53) {
    // The three ranks fit one exact key.
    const keys = new Float64Array(finite.length);
    for (let i = 0; i < keys.length; i++) {
      keys[i] = ((x.ids[i] ?? 0) * y.count + (y.ids[i] ?? 0)) * z.count + (z.ids[i] ?? 0);
    }
    xyz = denseIds(keys);
  } else {
    const xy = densePairs(x.ids, y.ids, y.count);
    xyz = densePairs(xy.ids, z.ids, z.count);
  }
  finite.forEach((v, i) => (ids[v] = xyz.ids[i] ?? -1));
  return ids;
}

/** Squared distance from point p to the segment a-b. */
function pointSegmentSquared(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  const length = ex * ex + ey * ey + ez * ez;
  const t = length > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / length)) : 0;
  const dx = px - (ax + ex * t);
  const dy = py - (ay + ey * t);
  const dz = pz - (az + ez * t);
  return dx * dx + dy * dy + dz * dz;
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
 * `EDGE_SLOTS` sharp edges of its patch that it lies beside (not beyond a segment's ends), with all its corners on
 * their interior side and within `reach`, the nearest first, skipping one nearly parallel to a kept one on the same
 * side (`PARALLEL_EDGE_DEG`), kept in a fixed order so neighbours with the same edges share vertices. `work` is the
 * document's slot-search budget (`MAX_EDGE_WORK`, `sceneSharpEdges`); once spent, triangles round nothing. Pure and
 * deterministic; triangles with a non-finite corner or no area round nothing. Indices out of range throw a
 * `RangeError`.
 */
export function sharpEdges(
  mesh: SceneMesh,
  options: SharpEdgeOptions,
  work: EdgeWork = { used: 0 },
): SharpEdgeAttributes {
  const { positions, normals, indices } = mesh;
  const vertexCount = Math.floor(positions.length / 3);
  const triangles = Math.floor(indices.length / 3);
  for (let i = 0; i < triangles * 3; i++) {
    if ((indices[i] ?? 0) >= vertexCount) throw new RangeError(`sharpEdges: index ${i} is out of range`);
  }
  const corner = (t: number, c: number): number => indices[t * 3 + c] ?? 0;
  const px = (v: number): number => positions[v * 3] ?? 0;
  const py = (v: number): number => positions[v * 3 + 1] ?? 0;
  const pz = (v: number): number => positions[v * 3 + 2] ?? 0;
  const ids = weldPositions(positions, vertexCount);

  const faceNormals = new Float64Array(triangles * 3);
  const valid = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const v0 = corner(t, 0);
    const v1 = corner(t, 1);
    const v2 = corner(t, 2);
    const i0 = ids[v0] ?? -1;
    const i1 = ids[v1] ?? -1;
    const i2 = ids[v2] ?? -1;
    if (i0 < 0 || i1 < 0 || i2 < 0 || i0 === i1 || i1 === i2 || i0 === i2) continue;
    const ux = px(v1) - px(v0);
    const uy = py(v1) - py(v0);
    const uz = pz(v1) - pz(v0);
    const wx = px(v2) - px(v0);
    const wy = py(v2) - py(v0);
    const wz = pz(v2) - pz(v0);
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 0) || !Number.isFinite(length)) continue;
    valid[t] = 1;
    faceNormals[t * 3] = nx / length;
    faceNormals[t * 3 + 1] = ny / length;
    faceNormals[t * 3 + 2] = nz / length;
  }

  // Edges in order of first appearance: first and second triangle side (t * 3 + i, edge i from corner i to i + 1) and
  // how many sides meet there (3 or more: not manifold). Matched by sorting the sides' id pairs.
  const sideCount = triangles * 3;
  const sideLow = new Int32Array(sideCount).fill(-1);
  const sideHigh = new Int32Array(sideCount).fill(-1);
  let maxId = 0;
  for (let t = 0; t < triangles; t++) {
    if (!valid[t]) continue;
    for (let i = 0; i < 3; i++) {
      const a = ids[corner(t, i)] ?? 0;
      const b = ids[corner(t, (i + 1) % 3)] ?? 0;
      sideLow[t * 3 + i] = Math.min(a, b);
      sideHigh[t * 3 + i] = Math.max(a, b);
      maxId = Math.max(maxId, a, b);
    }
  }
  const validSides: number[] = [];
  for (let side = 0; side < sideCount; side++) if ((sideLow[side] ?? -1) >= 0) validSides.push(side);
  const sideKeys = new Float64Array(validSides.length);
  validSides.forEach((side, i) => (sideKeys[i] = (sideLow[side] ?? 0) * (maxId + 1) + (sideHigh[side] ?? 0)));
  const sideEdge = denseIds(sideKeys);
  const edgeFirst = new Int32Array(sideEdge.count).fill(-1);
  const edgeSecond = new Int32Array(sideEdge.count);
  const edgeSides = new Uint8Array(sideEdge.count);
  const edgeOrder: number[] = [];
  validSides.forEach((side, i) => {
    const e = sideEdge.ids[i] ?? 0;
    if ((edgeFirst[e] ?? -1) < 0) {
      edgeFirst[e] = side;
      edgeOrder.push(e);
    } else if (edgeSides[e] === 1) edgeSecond[e] = side;
    edgeSides[e] = Math.min(3, (edgeSides[e] ?? 0) + 1);
  });

  const parent = new Int32Array(triangles).map((_, i) => i);
  const sharpCos = Math.cos((options.sharpAngleDeg * Math.PI) / 180);
  const foldCos = Math.cos((MAX_SHARP_ANGLE_DEG * Math.PI) / 180);
  const sameNormal = (v: number, w: number): boolean =>
    v === w ||
    (normals[v * 3] ?? 0) * (normals[w * 3] ?? 0) +
      (normals[v * 3 + 1] ?? 0) * (normals[w * 3 + 1] ?? 0) +
      (normals[v * 3 + 2] ?? 0) * (normals[w * 3 + 2] ?? 0) >
      1 - 1e-6;
  const faceDot = (s: number, t: number): number =>
    (faceNormals[s * 3] ?? 0) * (faceNormals[t * 3] ?? 0) +
    (faceNormals[s * 3 + 1] ?? 0) * (faceNormals[t * 3 + 1] ?? 0) +
    (faceNormals[s * 3 + 2] ?? 0) * (faceNormals[t * 3 + 2] ?? 0);
  // Per sharp edge: its two sides and its signed angle.
  const pairs: number[] = [];
  for (const e of edgeOrder) {
    if (edgeSides[e] !== 2) continue;
    const sideA = edgeFirst[e] ?? 0;
    const sideB = edgeSecond[e] ?? 0;
    const ta = Math.floor(sideA / 3);
    const tb = Math.floor(sideB / 3);
    if (ta === tb) continue;
    const cos = faceDot(ta, tb);
    if (cos <= foldCos) continue;
    // Endpoints of the edge in each triangle, matched by position id.
    const a0 = corner(ta, sideA % 3);
    const a1 = corner(ta, ((sideA % 3) + 1) % 3);
    const b0 = corner(tb, sideB % 3);
    const b1 = corner(tb, ((sideB % 3) + 1) % 3);
    const sameOrder = ids[a0] === ids[b0];
    const smooth = sameNormal(a0, sameOrder ? b0 : b1) && sameNormal(a1, sameOrder ? b1 : b0);
    if (cos > sharpCos || smooth) {
      parent[find(parent, ta)] = find(parent, tb);
      continue;
    }
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    // Convex where the other face's far corner lies below this face's plane.
    const far = corner(tb, ((sideB % 3) + 2) % 3);
    const below =
      (faceNormals[ta * 3] ?? 0) * (px(far) - px(a0)) +
      (faceNormals[ta * 3 + 1] ?? 0) * (py(far) - py(a0)) +
      (faceNormals[ta * 3 + 2] ?? 0) * (pz(far) - pz(a0));
    pairs.push(sideA, sideB, below < 0 ? angle : -angle);
  }
  const edgeCount = pairs.length / 3;

  if (edgeCount === 0) {
    return {
      vertexOf: Uint32Array.from({ length: vertexCount }, (_, i) => i),
      indices: Uint32Array.from(indices.subarray(0, triangles * 3)),
      distances: new Float32Array(vertexCount * EDGE_SLOTS).fill(NO_EDGE),
      angles: new Float32Array(vertexCount * EDGE_SLOTS),
      edgeCount: 0,
    };
  }

  // Each sharp edge has a side in the patch of either triangle: its segment, the unit direction in the owning
  // triangle's plane perpendicular to it toward the interior, its angle and its bounds grown by the reach.
  const sides = edgeCount * 2;
  const sideA = new Float64Array(sides * 3);
  const sideB = new Float64Array(sides * 3);
  const inward = new Float64Array(sides * 3);
  const sideAngle = new Float64Array(sides);
  const sideBox = new Float64Array(sides * 6);
  const sidePatch = new Int32Array(sides);
  const reach = Math.max(0, options.reach);
  for (let s = 0; s < sides; s++) {
    const side = pairs[Math.floor(s / 2) * 3 + (s % 2)] ?? 0;
    const t = Math.floor(side / 3);
    const va = corner(t, side % 3);
    const vb = corner(t, ((side % 3) + 1) % 3);
    const vo = corner(t, ((side % 3) + 2) % 3);
    const ax = px(va);
    const ay = py(va);
    const az = pz(va);
    const bx = px(vb);
    const by = py(vb);
    const bz = pz(vb);
    const ex = bx - ax;
    const ey = by - ay;
    const ez = bz - az;
    const fx = faceNormals[t * 3] ?? 0;
    const fy = faceNormals[t * 3 + 1] ?? 0;
    const fz = faceNormals[t * 3 + 2] ?? 0;
    let ix = fy * ez - fz * ey;
    let iy = fz * ex - fx * ez;
    let iz = fx * ey - fy * ex;
    const length = Math.hypot(ix, iy, iz);
    ix /= length;
    iy /= length;
    iz /= length;
    if (ix * (px(vo) - ax) + iy * (py(vo) - ay) + iz * (pz(vo) - az) < 0) {
      ix = -ix;
      iy = -iy;
      iz = -iz;
    }
    sideA[s * 3] = ax;
    sideA[s * 3 + 1] = ay;
    sideA[s * 3 + 2] = az;
    sideB[s * 3] = bx;
    sideB[s * 3 + 1] = by;
    sideB[s * 3 + 2] = bz;
    inward[s * 3] = ix;
    inward[s * 3 + 1] = iy;
    inward[s * 3 + 2] = iz;
    sideAngle[s] = pairs[Math.floor(s / 2) * 3 + 2] ?? 0;
    sideBox[s * 6] = Math.min(ax, bx) - reach;
    sideBox[s * 6 + 1] = Math.min(ay, by) - reach;
    sideBox[s * 6 + 2] = Math.min(az, bz) - reach;
    sideBox[s * 6 + 3] = Math.max(ax, bx) + reach;
    sideBox[s * 6 + 4] = Math.max(ay, by) + reach;
    sideBox[s * 6 + 5] = Math.max(az, bz) + reach;
    sidePatch[s] = find(parent, t);
  }
  // Sides grouped by patch (the root triangle), in side order.
  const patchStart = new Int32Array(triangles + 1);
  for (let s = 0; s < sides; s++) {
    const next = (sidePatch[s] ?? 0) + 1;
    patchStart[next] = (patchStart[next] ?? 0) + 1;
  }
  for (let t = 0; t < triangles; t++) patchStart[t + 1] = (patchStart[t + 1] ?? 0) + (patchStart[t] ?? 0);
  const patchSides = new Int32Array(sides);
  const filled = new Int32Array(triangles);
  for (let s = 0; s < sides; s++) {
    const patch = sidePatch[s] ?? 0;
    patchSides[(patchStart[patch] ?? 0) + (filled[patch] ?? 0)] = s;
    filled[patch] = (filled[patch] ?? 0) + 1;
  }

  // Slots per triangle: up to EDGE_SLOTS side ids, ascending. Candidates are sides of the triangle's patch that it lies
  // beside (its projection onto the segment overlaps the segment), on their interior side and within reach. The nearest
  // are kept first, and one whose inward direction is within PARALLEL_EDGE_DEG of a kept side's is dropped: nearly
  // parallel edges on the same side (a curved rim) would bend the normal several times over.
  const slots = new Int32Array(triangles * EDGE_SLOTS).fill(-1);
  const candidateDistance: number[] = [];
  const candidateSide: number[] = [];
  const kept: number[] = [];
  const q = new Float64Array(9);
  for (let t = 0; t < triangles && work.used < MAX_EDGE_WORK; t++) {
    if (!valid[t]) continue;
    const patch = find(parent, t);
    const start = patchStart[patch] ?? 0;
    const end = patchStart[patch + 1] ?? 0;
    if (start === end) continue;
    for (let c = 0; c < 3; c++) {
      const v = corner(t, c);
      q[c * 3] = px(v);
      q[c * 3 + 1] = py(v);
      q[c * 3 + 2] = pz(v);
    }
    candidateDistance.length = 0;
    candidateSide.length = 0;
    for (let j = start; j < end; j++) {
      work.used += WORK_VISIT;
      if (work.used > MAX_EDGE_WORK) break;
      const s = patchSides[j] ?? 0;
      let outside = false;
      for (let k = 0; k < 3 && !outside; k++) {
        const low = Math.min(q[k] ?? 0, q[3 + k] ?? 0, q[6 + k] ?? 0);
        const high = Math.max(q[k] ?? 0, q[3 + k] ?? 0, q[6 + k] ?? 0);
        outside = low > (sideBox[s * 6 + 3 + k] ?? 0) || high < (sideBox[s * 6 + k] ?? 0);
      }
      if (outside) continue;
      work.used += WORK_TEST;
      const ax = sideA[s * 3] ?? 0;
      const ay = sideA[s * 3 + 1] ?? 0;
      const az = sideA[s * 3 + 2] ?? 0;
      const bx = sideB[s * 3] ?? 0;
      const by = sideB[s * 3 + 1] ?? 0;
      const bz = sideB[s * 3 + 2] ?? 0;
      const ex = bx - ax;
      const ey = by - ay;
      const ez = bz - az;
      const length2 = ex * ex + ey * ey + ez * ez;
      let low = Infinity;
      let high = -Infinity;
      for (let c = 0; c < 3; c++) {
        const along = ((q[c * 3] ?? 0) - ax) * ex + ((q[c * 3 + 1] ?? 0) - ay) * ey + ((q[c * 3 + 2] ?? 0) - az) * ez;
        low = Math.min(low, along);
        high = Math.max(high, along);
      }
      // Beside the segment: the overlap of the projections is longer than the weld distance.
      if (Math.min(high, length2) - Math.max(low, 0) <= EDGE_WELD_DISTANCE * Math.sqrt(length2)) continue;
      const ix = inward[s * 3] ?? 0;
      const iy = inward[s * 3 + 1] ?? 0;
      const iz = inward[s * 3 + 2] ?? 0;
      let behind = false;
      for (let c = 0; c < 3 && !behind; c++) {
        const d = ((q[c * 3] ?? 0) - ax) * ix + ((q[c * 3 + 1] ?? 0) - ay) * iy + ((q[c * 3 + 2] ?? 0) - az) * iz;
        behind = d < -EDGE_WELD_DISTANCE;
      }
      if (behind) continue;
      work.used += WORK_DISTANCE;
      // Distance between the triangle's edges and the segment (they do not cross): the nearest endpoint distance.
      let nearest = Infinity;
      for (let c = 0; c < 3 && nearest > 0; c++) {
        const ux = q[c * 3] ?? 0;
        const uy = q[c * 3 + 1] ?? 0;
        const uz = q[c * 3 + 2] ?? 0;
        const n = ((c + 1) % 3) * 3;
        const wx = q[n] ?? 0;
        const wy = q[n + 1] ?? 0;
        const wz = q[n + 2] ?? 0;
        nearest = Math.min(
          nearest,
          pointSegmentSquared(ux, uy, uz, ax, ay, az, bx, by, bz),
          pointSegmentSquared(wx, wy, wz, ax, ay, az, bx, by, bz),
          pointSegmentSquared(ax, ay, az, ux, uy, uz, wx, wy, wz),
          pointSegmentSquared(bx, by, bz, ux, uy, uz, wx, wy, wz),
        );
      }
      const distance = Math.sqrt(nearest);
      if (!(distance <= reach)) continue;
      // Insert by (distance, side id); sides come in ascending order, so ties keep it.
      let at = candidateDistance.length;
      candidateDistance.push(distance);
      candidateSide.push(s);
      while (at > 0 && (candidateDistance[at - 1] ?? 0) > distance) {
        candidateDistance[at] = candidateDistance[at - 1] ?? 0;
        candidateSide[at] = candidateSide[at - 1] ?? 0;
        at--;
      }
      candidateDistance[at] = distance;
      candidateSide[at] = s;
      work.used += candidateDistance.length - at;
    }
    // Past the budget the triangle rounds nothing, nor does any later one.
    if (work.used > MAX_EDGE_WORK) break;
    kept.length = 0;
    for (let k = 0; k < candidateSide.length && kept.length < EDGE_SLOTS; k++) {
      const s = candidateSide[k] ?? 0;
      const parallel = kept.some(
        (o) =>
          (inward[s * 3] ?? 0) * (inward[o * 3] ?? 0) +
            (inward[s * 3 + 1] ?? 0) * (inward[o * 3 + 1] ?? 0) +
            (inward[s * 3 + 2] ?? 0) * (inward[o * 3 + 2] ?? 0) >
          PARALLEL_EDGE_COS,
      );
      if (!parallel) kept.push(s);
    }
    kept.sort((x, y) => x - y);
    slots.set(kept, t * EDGE_SLOTS);
  }

  // A set id per triangle (0: no slot), equal slots equal ids: the slot tuples ranked by sorting, pair by pair.
  const setOf = new Int32Array(triangles);
  const sameSlots = (t: number, u: number): boolean => {
    for (let k = 0; k < EDGE_SLOTS; k++) if (slots[t * EDGE_SLOTS + k] !== slots[u * EDGE_SLOTS + k]) return false;
    return true;
  };
  // Neighbours on one face usually share their slots: only the first of a run is ranked.
  const withSlots: number[] = [];
  for (let t = 0; t < triangles; t++) {
    if ((slots[t * EDGE_SLOTS] ?? -1) >= 0 && !(t > 0 && sameSlots(t, t - 1))) withSlots.push(t);
  }
  const slotColumn = (k: number) => Int32Array.from(withSlots, (t) => (slots[t * EDGE_SLOTS + k] ?? -1) + 1);
  let tuple: { ids: Int32Array; count: number } = { ids: slotColumn(0), count: sides + 1 };
  for (let k = 1; k < EDGE_SLOTS; k++) tuple = densePairs(tuple.ids, slotColumn(k), sides + 1);
  withSlots.forEach((t, i) => (setOf[t] = (tuple.ids[i] ?? 0) + 1));
  for (let t = 1; t < triangles; t++) {
    if ((slots[t * EDGE_SLOTS] ?? -1) >= 0 && sameSlots(t, t - 1)) setOf[t] = setOf[t - 1] ?? 0;
  }
  const setCount = tuple.count + 1;

  // Split vertices by the slot set of the triangles using them: one output vertex per distinct (vertex, set), numbered
  // in order of first use, matched by sorting.
  // Without a vertex used under two sets (every cube face) the vertex itself is the group: no sort needed.
  const firstSet = new Int32Array(vertexCount).fill(-1);
  let split = false;
  for (let t = 0; t < triangles && !split; t++) {
    for (let c = 0; c < 3; c++) {
      const v = corner(t, c);
      if ((firstSet[v] ?? -1) < 0) firstSet[v] = setOf[t] ?? 0;
      else if (firstSet[v] !== setOf[t]) split = true;
    }
  }
  let cornerGroup: { ids: Int32Array; count: number };
  if (split) {
    const cornerKeys = new Float64Array(triangles * 3);
    for (let t = 0; t < triangles; t++) {
      for (let c = 0; c < 3; c++) cornerKeys[t * 3 + c] = corner(t, c) * setCount + (setOf[t] ?? 0);
    }
    cornerGroup = denseIds(cornerKeys);
  } else {
    cornerGroup = { ids: Int32Array.from(indices.subarray(0, triangles * 3)), count: vertexCount };
  }
  const groupOut = new Int32Array(cornerGroup.count).fill(-1);
  const maxOut = triangles * 3 + vertexCount;
  const vertexOf = new Uint32Array(maxOut);
  const distances = new Float32Array(maxOut * EDGE_SLOTS);
  const angles = new Float32Array(maxOut * EDGE_SLOTS);
  const outIndices = new Uint32Array(triangles * 3);
  const used = new Uint8Array(vertexCount);
  let out = 0;
  for (let t = 0; t < triangles; t++) {
    for (let c = 0; c < 3; c++) {
      const group = cornerGroup.ids[t * 3 + c] ?? 0;
      let o = groupOut[group] ?? -1;
      if (o < 0) {
        o = out++;
        groupOut[group] = o;
        const v = corner(t, c);
        used[v] = 1;
        vertexOf[o] = v;
        const qx = px(v);
        const qy = py(v);
        const qz = pz(v);
        for (let k = 0; k < EDGE_SLOTS; k++) {
          const s = slots[t * EDGE_SLOTS + k] ?? -1;
          if (s < 0) {
            distances[o * EDGE_SLOTS + k] = NO_EDGE;
            continue;
          }
          const d =
            (qx - (sideA[s * 3] ?? 0)) * (inward[s * 3] ?? 0) +
            (qy - (sideA[s * 3 + 1] ?? 0)) * (inward[s * 3 + 1] ?? 0) +
            (qz - (sideA[s * 3 + 2] ?? 0)) * (inward[s * 3 + 2] ?? 0);
          distances[o * EDGE_SLOTS + k] = Math.max(0, d);
          angles[o * EDGE_SLOTS + k] = sideAngle[s] ?? 0;
        }
      }
      outIndices[t * 3 + c] = o;
    }
  }
  // Vertices no triangle uses keep their place, so a mesh without sharp edges maps one to one.
  let identity = out === vertexCount;
  for (let i = 0; i < out && identity; i++) identity = vertexOf[i] === i;
  if (!identity) {
    for (let v = 0; v < vertexCount; v++) {
      if (used[v]) continue;
      vertexOf[out] = v;
      distances.fill(NO_EDGE, out * EDGE_SLOTS, out * EDGE_SLOTS + EDGE_SLOTS);
      out++;
    }
  }
  return {
    vertexOf: vertexOf.slice(0, out),
    indices: outIndices,
    distances: distances.slice(0, out * EDGE_SLOTS),
    angles: angles.slice(0, out * EDGE_SLOTS),
    edgeCount,
  };
}

const cache = new WeakMap<readonly SceneMesh[], { key: string; result: readonly SharpEdgeAttributes[] }>();

/**
 * `sharpEdges` of every mesh of a document, in order, sharing one `MAX_EDGE_WORK` budget, so the result is a pure
 * function of the meshes and options. Kept per meshes array for the latest options only: another pose of a document
 * keeps its meshes array (`poseScene`), so re-posing detects nothing again, and an angle change replaces the result
 * instead of adding one.
 */
export function sceneSharpEdges(
  meshes: readonly SceneMesh[],
  options: SharpEdgeOptions,
): readonly SharpEdgeAttributes[] {
  const key = `${options.sharpAngleDeg}:${options.reach}`;
  const cached = cache.get(meshes);
  if (cached?.key === key) return cached.result;
  const work: EdgeWork = { used: 0 };
  const result = meshes.map((mesh) => sharpEdges(mesh, options, work));
  cache.set(meshes, { key, result });
  return result;
}
