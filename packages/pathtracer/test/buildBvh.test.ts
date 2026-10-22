import { describe, expect, it } from 'vitest';
import { buildBvh, bvhSahCost, MAX_BVH_DEPTH, MAX_LEAF_TRIANGLES, NODE_FLOATS, type Bvh } from '../src/buildBvh';
import { randomTriangles } from './testScenes';

interface Leaf {
  depth: number;
  count: number;
}

/** Checks every structural invariant, one assertion each (a per-triangle `expect` makes a large build slow), and returns the leaves. */
function checkInvariants(bvh: Bvh, positions: Float32Array, count: number): Leaf[] {
  const seen = new Uint8Array(count);
  const leaves: Leaf[] = [];
  const problems: Record<'range' | 'parent' | 'leafSize' | 'point' | 'info', string[]> = {
    range: [],
    parent: [],
    leafSize: [],
    point: [],
    info: [],
  };
  const box = (n: number) => Array.from(bvh.nodes.subarray(n * NODE_FLOATS, n * NODE_FLOATS + NODE_FLOATS));
  const visit = (n: number, depth: number, parent: number[] | null): void => {
    if (!(n < bvh.nodeCount)) {
      problems.range.push(`node ${n} of ${bvh.nodeCount}`);
      return;
    }
    const b = box(n);
    if (parent) {
      for (let k = 0; k < 3; k++) {
        if (!((b[k] ?? 0) >= (parent[k] ?? 0) && (b[4 + k] ?? 0) <= (parent[4 + k] ?? 0))) {
          problems.parent.push(`node ${n} axis ${k}`);
        }
      }
    }
    const info = b[7] ?? 0;
    if (info > 0) {
      if (info > MAX_LEAF_TRIANGLES) problems.leafSize.push(`node ${n} holds ${info}`);
      leaves.push({ depth, count: info });
      for (let i = b[3] ?? 0; i < (b[3] ?? 0) + info; i++) {
        const t = bvh.order[i] ?? 0;
        seen[t] = (seen[t] ?? 0) + 1;
        for (let c = 0; c < 3; c++) {
          for (let k = 0; k < 3; k++) {
            const p = positions[t * 9 + c * 3 + k] ?? 0;
            if (!(p >= (b[k] ?? 0) && p <= (b[4 + k] ?? 0))) problems.point.push(`triangle ${t} in node ${n}`);
          }
        }
      }
      return;
    }
    if (![-1, -2, -3].includes(info)) {
      problems.info.push(`node ${n} info ${info}`);
      return;
    }
    visit(n + 1, depth + 1, b);
    visit(b[3] ?? 0, depth + 1, b);
  };
  visit(0, 0, null);
  for (const [name, found] of Object.entries(problems)) expect(found[0] ?? '', `${name} (${found.length})`).toBe('');
  const missing = Array.from(seen).findIndex((v) => v !== 1);
  expect(missing, 'first triangle not held exactly once').toBe(-1);
  expect(Math.max(...leaves.map((l) => l.depth))).toBe(bvh.depth);
  expect(bvh.nodeCount, 'a binary tree of L leaves has 2L - 1 nodes').toBe(2 * leaves.length - 1);
  return leaves;
}

// The pathtracer package has no Node types; only the thread CPU clock is used here.
declare const process: { threadCpuUsage(): { user: number; system: number } };

/** Thread CPU milliseconds of a synchronous build: unlike wall time, a busy machine does not count. */
function buildCpu<T>(build: () => T): { value: T; ms: number } {
  const before = process.threadCpuUsage();
  const value = build();
  const after = process.threadCpuUsage();
  return { value, ms: (after.user - before.user + after.system - before.system) / 1000 };
}

const CPU_COINCIDENT_MS = 200;
const CPU_CHAIN_MS = 400;

describe('buildBvh', () => {
  it('holds every triangle once, children inside their parent, leaves of at most 4', () => {
    const positions = new Float32Array(randomTriangles(1000, 7));
    const bvh = buildBvh(positions, 1000);
    checkInvariants(bvh, positions, 1000);
    expect(bvh.depth).toBeLessThanOrEqual(MAX_BVH_DEPTH);
  });

  it('rebuilds byte-identically', () => {
    const positions = new Float32Array(randomTriangles(500, 3));
    const a = buildBvh(positions, 500);
    const b = buildBvh(positions, 500);
    const bytes = (f: Float32Array) => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    expect(bytes(b.nodes)).toEqual(bytes(a.nodes));
    expect(b.order).toEqual(a.order);
  });

  it('costs no more by the surface area heuristic than median splits on a random mesh', () => {
    const positions = new Float32Array(randomTriangles(2000, 11));
    const sah = bvhSahCost(buildBvh(positions, 2000));
    const median = bvhSahCost(buildBvh(positions, 2000, { split: 'median' }));
    expect(sah).toBeLessThanOrEqual(median);
  });

  it('stays within depth 31 with leaves of at most 4 for 10 000 coincident triangles', () => {
    const one = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const positions = new Float32Array(Array.from({ length: 10_000 }, () => one).flat());
    const { value: bvh, ms } = buildCpu(() => buildBvh(positions, 10_000));
    checkInvariants(bvh, positions, 10_000);
    // Equal boxes force median splits by index: the depth of a balanced tree, not a quadratic peel.
    expect(bvh.depth).toBe(Math.ceil(Math.log2(Math.ceil(10_000 / MAX_LEAF_TRIANGLES))));
    expect(ms, 'build CPU ms').toBeLessThan(CPU_COINCIDENT_MS);
  });

  it('stays within depth 31 for a 4096-triangle chain that SAH alone would split one at a time', () => {
    // Exponentially spaced: the last of 12 bins holds only the outermost few triangles at every level, so SAH splits
    // peel off about 5 at a time (some 800 levels deep without the median fallback).
    const positions = new Float32Array(
      Array.from({ length: 4096 }, (_, i) => {
        const x = 2 ** (i / 40);
        return [x, 0, 0, x + 1e-3 * x, 0, 0, x, 1e-3 * x, 0];
      }).flat(),
    );
    const { value: bvh, ms } = buildCpu(() => buildBvh(positions, 4096));
    checkInvariants(bvh, positions, 4096);
    expect(bvh.depth).toBe(MAX_BVH_DEPTH);
    expect(ms, 'build CPU ms').toBeLessThan(CPU_CHAIN_MS);
  });

  it('builds nothing for no triangles and a single leaf for a few', () => {
    expect(buildBvh(new Float32Array(0), 0)).toMatchObject({ nodeCount: 0, depth: 0 });
    const few = buildBvh(new Float32Array(randomTriangles(3, 1)), 3);
    expect(few.nodeCount).toBe(1);
    expect(few.nodes[7]).toBe(3);
  });
});
