/**
 * A bounding volume hierarchy over triangles in flat arrays, nodes in depth-first order (a node's left child follows
 * it). Per node 8 floats: `minX, minY, minZ, a, maxX, maxY, maxZ, b`. A leaf has `b` = its triangle count (1..4) and
 * `a` = its first position in `order`; an inner node has `b` = −(split axis + 1) and `a` = its right child's index.
 * Indices are stored as floats, exact below 2^24.
 */
export interface Bvh {
  readonly nodeCount: number;
  readonly nodes: Float32Array;
  /** Triangle indices in leaf order: a leaf covers `order[a .. a + b)`. */
  readonly order: Uint32Array;
  /** Depth of the deepest leaf (the root is depth 0); at most `MAX_BVH_DEPTH`. */
  readonly depth: number;
}

export interface BuildBvhOptions {
  /** `median` splits every node at its index median (the reference the SAH build is tested against). */
  readonly split?: 'sah' | 'median';
}

/** Deepest leaf; the traversal stack in bvhTraverse.glsl holds 32 entries, so it never overflows. */
export const MAX_BVH_DEPTH = 31;
export const MAX_LEAF_TRIANGLES = 4;
export const NODE_FLOATS = 8;
const BINS = 12;

/** Levels a median-split subtree of n triangles needs until every leaf holds at most MAX_LEAF_TRIANGLES. */
function medianLevels(n: number): number {
  return n <= MAX_LEAF_TRIANGLES ? 0 : Math.ceil(Math.log2(n / MAX_LEAF_TRIANGLES));
}

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

const emptyBox = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });

function grow(box: Box, min: ArrayLike<number>, max: ArrayLike<number>, at: number): void {
  for (let k = 0; k < 3; k++) {
    box.min[k] = Math.min(box.min[k] ?? 0, min[at + k] ?? 0);
    box.max[k] = Math.max(box.max[k] ?? 0, max[at + k] ?? 0);
  }
}

function halfArea(box: Box): number {
  const x = box.max[0] - box.min[0];
  const y = box.max[1] - box.min[1];
  const z = box.max[2] - box.min[2];
  return x < 0 ? 0 : x * y + y * z + z * x;
}

/**
 * Binned SAH build (12 bins per axis, leaves of at most 4 triangles) over `count` triangles of `positions` (9 floats
 * each). Deterministic: ties go to the lower axis and bin, partitions are stable, and no Map or Set order is involved.
 * Depth stays at most 31 for any input: a node whose triangles would need every remaining level if split at the
 * median, or whose centroids all coincide, is split at its index median instead.
 */
export function buildBvh(positions: Float32Array, count: number, options: BuildBvhOptions = {}): Bvh {
  if (medianLevels(count) > MAX_BVH_DEPTH) throw new RangeError(`${count} triangles exceed the BVH depth limit`);
  if (count >= 2 ** 23) throw new RangeError(`${count} triangles exceed the BVH index range`);
  const triMin = new Float32Array(count * 3);
  const triMax = new Float32Array(count * 3);
  const centroid = new Float64Array(count * 3);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const a = positions[t * 9 + k] ?? 0;
      const b = positions[t * 9 + 3 + k] ?? 0;
      const c = positions[t * 9 + 6 + k] ?? 0;
      triMin[t * 3 + k] = Math.min(a, b, c);
      triMax[t * 3 + k] = Math.max(a, b, c);
      centroid[t * 3 + k] = ((triMin[t * 3 + k] ?? 0) + (triMax[t * 3 + k] ?? 0)) / 2;
    }
  }
  const order = new Uint32Array(count);
  for (let t = 0; t < count; t++) order[t] = t;
  // At most 2n − 1 nodes for leaves of at least one triangle.
  const nodes = new Float32Array(Math.max(1, 2 * count - 1) * NODE_FLOATS);
  let nodeCount = 0;
  let maxDepth = 0;
  const scratch = new Uint32Array(count);
  const median = options.split === 'median';

  const build = (start: number, end: number, depth: number): void => {
    const node = nodeCount++;
    const bounds = emptyBox();
    const centroids = emptyBox();
    for (let i = start; i < end; i++) {
      const t = order[i] ?? 0;
      grow(bounds, triMin, triMax, t * 3);
      grow(centroids, centroid, centroid, t * 3);
    }
    const base = node * NODE_FLOATS;
    nodes.set(count === 0 ? [0, 0, 0] : bounds.min, base);
    nodes.set(count === 0 ? [0, 0, 0] : bounds.max, base + 4);
    const n = end - start;
    if (n <= MAX_LEAF_TRIANGLES) {
      nodes[base + 3] = start;
      nodes[base + 7] = n;
      maxDepth = Math.max(maxDepth, depth);
      return;
    }
    const extent = [0, 1, 2].map((k) => (centroids.max[k] ?? 0) - (centroids.min[k] ?? 0));
    let split = -1;
    let axis = extent[1]! > extent[0]! ? (extent[2]! > extent[1]! ? 2 : 1) : extent[2]! > extent[0]! ? 2 : 0;
    const forced = median || medianLevels(n) >= MAX_BVH_DEPTH - depth || extent.every((e) => !(e > 0));
    if (!forced) {
      let bestCost = Infinity;
      let bestAxis = -1;
      let bestBin = -1;
      for (let k = 0; k < 3; k++) {
        const size = extent[k] ?? 0;
        if (!(size > 0)) continue;
        const lo = centroids.min[k] ?? 0;
        const counts = new Array<number>(BINS).fill(0);
        const boxes = Array.from({ length: BINS }, emptyBox);
        for (let i = start; i < end; i++) {
          const t = order[i] ?? 0;
          const bin = Math.min(BINS - 1, Math.floor((((centroid[t * 3 + k] ?? 0) - lo) / size) * BINS));
          counts[bin] = (counts[bin] ?? 0) + 1;
          grow(boxes[bin]!, triMin, triMax, t * 3);
        }
        const rightArea = new Array<number>(BINS).fill(0);
        const rightCount = new Array<number>(BINS).fill(0);
        const right = emptyBox();
        let rc = 0;
        for (let b = BINS - 1; b > 0; b--) {
          rc += counts[b] ?? 0;
          grow(right, boxes[b]!.min, boxes[b]!.max, 0);
          rightArea[b] = halfArea(right);
          rightCount[b] = rc;
        }
        const left = emptyBox();
        let lc = 0;
        for (let b = 0; b < BINS - 1; b++) {
          lc += counts[b] ?? 0;
          grow(left, boxes[b]!.min, boxes[b]!.max, 0);
          const rcount = rightCount[b + 1] ?? 0;
          if (lc === 0 || rcount === 0) continue;
          const cost = halfArea(left) * lc + (rightArea[b + 1] ?? 0) * rcount;
          if (cost < bestCost) {
            bestCost = cost;
            bestAxis = k;
            bestBin = b;
          }
        }
      }
      if (bestAxis >= 0) {
        axis = bestAxis;
        const size = extent[axis] ?? 0;
        const lo = centroids.min[axis] ?? 0;
        const goesLeft = (t: number): boolean =>
          Math.min(BINS - 1, Math.floor((((centroid[t * 3 + axis] ?? 0) - lo) / size) * BINS)) <= bestBin;
        // Stable partition: the left triangles in their order, then the right ones in theirs.
        let l = 0;
        for (let i = start; i < end; i++) if (goesLeft(order[i] ?? 0)) scratch[l++] = order[i] ?? 0;
        let r = l;
        for (let i = start; i < end; i++) if (!goesLeft(order[i] ?? 0)) scratch[r++] = order[i] ?? 0;
        order.set(scratch.subarray(0, n), start);
        split = start + l;
      }
    }
    if (split < 0) {
      const range = Array.from(order.subarray(start, end));
      const allCoincide = extent.every((e) => !(e > 0));
      range.sort((p, q) =>
        allCoincide ? p - q : (centroid[p * 3 + axis] ?? 0) - (centroid[q * 3 + axis] ?? 0) || p - q,
      );
      order.set(range, start);
      split = start + Math.floor(n / 2);
    }
    nodes[base + 7] = -(axis + 1);
    build(start, split, depth + 1);
    nodes[base + 3] = nodeCount;
    build(split, end, depth + 1);
  };

  if (count > 0) build(0, count, 0);
  return { nodeCount, nodes: nodes.subarray(0, nodeCount * NODE_FLOATS), order, depth: maxDepth };
}

/**
 * Surface area heuristic cost of a hierarchy relative to its root (inner nodes cost 1, a leaf its triangle count,
 * each weighted by its surface area over the root's): the measure the binned build minimises.
 */
export function bvhSahCost(bvh: Bvh): number {
  const area = (node: number): number => {
    const b = node * NODE_FLOATS;
    const box: Box = {
      min: [bvh.nodes[b] ?? 0, bvh.nodes[b + 1] ?? 0, bvh.nodes[b + 2] ?? 0],
      max: [bvh.nodes[b + 4] ?? 0, bvh.nodes[b + 5] ?? 0, bvh.nodes[b + 6] ?? 0],
    };
    return halfArea(box);
  };
  const root = area(0);
  if (!(root > 0)) return 0;
  let cost = 0;
  for (let node = 0; node < bvh.nodeCount; node++) {
    const b = bvh.nodes[node * NODE_FLOATS + 7] ?? 0;
    cost += (area(node) / root) * (b > 0 ? b : 1);
  }
  return cost;
}
