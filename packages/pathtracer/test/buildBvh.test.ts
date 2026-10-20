import { describe, expect, it } from 'vitest';
import { buildBvh, bvhSahCost, MAX_BVH_DEPTH, MAX_LEAF_TRIANGLES, NODE_FLOATS, type Bvh } from '../src/buildBvh';
import { randomTriangles } from './testScenes';

/** Checks every structural invariant and returns the leaf depths. */
function checkInvariants(bvh: Bvh, positions: Float32Array, count: number): number[] {
  const seen = new Uint8Array(count);
  const depths: number[] = [];
  const box = (n: number) => Array.from(bvh.nodes.subarray(n * NODE_FLOATS, n * NODE_FLOATS + NODE_FLOATS));
  const visit = (n: number, depth: number, parent: number[] | null): void => {
    expect(n).toBeLessThan(bvh.nodeCount);
    const b = box(n);
    if (parent) {
      for (let k = 0; k < 3; k++) {
        expect(b[k]).toBeGreaterThanOrEqual(parent[k] ?? 0);
        expect(b[4 + k]).toBeLessThanOrEqual(parent[4 + k] ?? 0);
      }
    }
    const info = b[7] ?? 0;
    if (info > 0) {
      expect(info).toBeLessThanOrEqual(MAX_LEAF_TRIANGLES);
      depths.push(depth);
      for (let i = b[3] ?? 0; i < (b[3] ?? 0) + info; i++) {
        const t = bvh.order[i] ?? 0;
        seen[t] = (seen[t] ?? 0) + 1;
        for (let c = 0; c < 3; c++) {
          for (let k = 0; k < 3; k++) {
            const p = positions[t * 9 + c * 3 + k] ?? 0;
            expect(p).toBeGreaterThanOrEqual(b[k] ?? 0);
            expect(p).toBeLessThanOrEqual(b[4 + k] ?? 0);
          }
        }
      }
      return;
    }
    expect([-1, -2, -3]).toContain(info);
    visit(n + 1, depth + 1, b);
    visit(b[3] ?? 0, depth + 1, b);
  };
  visit(0, 0, null);
  expect(Array.from(seen).every((s) => s === 1)).toBe(true);
  expect(Math.max(...depths)).toBe(bvh.depth);
  return depths;
}

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
    const bvh = buildBvh(positions, 10_000);
    checkInvariants(bvh, positions, 10_000);
    expect(bvh.depth).toBeLessThanOrEqual(MAX_BVH_DEPTH);
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
    const bvh = buildBvh(positions, 4096);
    checkInvariants(bvh, positions, 4096);
    expect(bvh.depth).toBe(MAX_BVH_DEPTH);
  });

  it('builds nothing for no triangles and a single leaf for a few', () => {
    expect(buildBvh(new Float32Array(0), 0)).toMatchObject({ nodeCount: 0, depth: 0 });
    const few = buildBvh(new Float32Array(randomTriangles(3, 1)), 3);
    expect(few.nodeCount).toBe(1);
    expect(few.nodes[7]).toBe(3);
  });
});
