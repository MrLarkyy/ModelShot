import { describe, expect, it } from 'vitest';
import { exactEdgeWords, OPEN_EDGE } from '../src/exactEdgeWords';

const ALL_OPEN = OPEN_EDGE | (OPEN_EDGE << 1) | (OPEN_EDGE << 2);

/** The octahedral snorm16 pair as silhouetteVertexRaster.glsl decodes it (unpackSnorm2x16), normalized. */
function decode(word: number): [number, number, number] {
  const snorm = (half: number) => Math.max(-1, ((half << 16) >> 16) / 32767);
  let x = snorm(word & 0xffff);
  let y = snorm(word >>> 16);
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

const words = (positions: number[], indices: number[]) =>
  exactEdgeWords(new Float32Array(positions), new Uint32Array(indices));

describe('exactEdgeWords', () => {
  it('marks every edge of a lone triangle open, with no neighbour normal', () => {
    expect([...words([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])]).toEqual([ALL_OPEN, 0, 0, 0]);
  });

  it('keeps the shared coplanar bits and stores the neighbour normal across a quad diagonal', () => {
    // Triangles (0, 1, 2) and (0, 2, 3): edge 2 of the first (2 -> 0) and edge 0 of the second (0 -> 2).
    const w = words([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
    expect(w[0]).toBe(4 | OPEN_EDGE | (OPEN_EDGE << 1));
    expect(w[4]).toBe(1 | (OPEN_EDGE << 1) | (OPEN_EDGE << 2));
    for (const [component, value] of decode(w[3] ?? 0).entries()) expect(value).toBeCloseTo([0, 0, 1][component]!, 4);
    for (const [component, value] of decode(w[5] ?? 0).entries()) expect(value).toBeCloseTo([0, 0, 1][component]!, 4);
  });

  it('marks an edge three triangles share open in each of them', () => {
    // Edge (0, 0, 0)-(1, 0, 0) with three fins.
    const w = words([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0], [0, 1, 2, 1, 0, 3, 0, 1, 4]);
    for (let t = 0; t < 3; t++) expect((w[t * 4] ?? 0) & OPEN_EDGE, `triangle ${t}`).toBe(OPEN_EDGE);
  });

  it('finds the neighbour across a zero-thickness card diagonal and leaves its outline open', () => {
    // Front (0, 1, 2), (0, 2, 3) and the back wound the other way on the same corners: four triangles on 0-2.
    const w = words([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
    // Front triangle 0: edges 0 (0-1) and 1 (1-2) are the outline, edge 2 (2-0) the diagonal to front triangle 1.
    expect((w[0] ?? 0) & ~7).toBe(OPEN_EDGE | (OPEN_EDGE << 1));
    for (const [component, value] of decode(w[3] ?? 0).entries()) expect(value).toBeCloseTo([0, 0, 1][component]!, 4);
    // Back triangle (0, 2, 1): its edge 0 (0-2) is the diagonal, its neighbour the back triangle (0, 3, 2).
    expect((w[8] ?? 0) & ~7).toBe((OPEN_EDGE << 1) | (OPEN_EDGE << 2));
    for (const [component, value] of decode(w[9] ?? 0).entries()) expect(value).toBeCloseTo([0, 0, -1][component]!, 4);
  });

  it('leaves an edge open that a fan of ten triangles shares', () => {
    const positions = [0, 0, 0, 1, 0, 0];
    const indices: number[] = [];
    for (let k = 0; k < 10; k++) {
      positions.push(0.5, Math.cos(k), Math.sin(k));
      indices.push(0, 1, 2 + k);
    }
    const w = words(positions, indices);
    for (let t = 0; t < 10; t++) expect((w[t * 4] ?? 0) & OPEN_EDGE).toBe(OPEN_EDGE);
  });

  it('marks a neighbour folded back onto the triangle open: two faces back to back', () => {
    const w = words([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2, 0, 2, 1]);
    expect([w[0], w[4]]).toEqual([ALL_OPEN, ALL_OPEN]);
    expect([...w.filter((_, i) => i % 4 !== 0)]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('stores a bent neighbour normal as its own winding gives it, within 1e-3, on every side of the sphere', () => {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * 2 * Math.PI;
      // Triangle 0 in the xz plane; triangle 1 shares its edge 0 (0,0,0)-(1,0,0) at angle a around x.
      const p = [0.5, Math.cos(a), Math.sin(a)];
      const w = words([0, 0, 0, 1, 0, 0, 0.5, 0, -1, ...p], [0, 1, 2, 1, 0, 3]);
      // Triangle 1 = (1,0,0), (0,0,0), p: normal = (-1, 0, 0) x (p - (1, 0, 0)).
      const expected = [0, p[2]!, -p[1]!];
      const length = Math.hypot(...expected);
      const got = decode(w[1] ?? 0);
      if (Math.sin(a) < -0.9999) {
        // Folded back onto triangle 0 (normal (0, 1, 0)).
        expect((w[0] ?? 0) & OPEN_EDGE, `angle ${k}`).toBe(OPEN_EDGE);
        continue;
      }
      expect((w[0] ?? 0) & OPEN_EDGE, `angle ${k}`).toBe(0);
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c]! - expected[c]! / length), `angle ${k}`).toBeLessThan(1e-3);
    }
  });

  it('round-trips the octahedral encoding within 1e-3 for normals in every octant', () => {
    for (let k = 0; k < 64; k++) {
      // The neighbour (1,0,0), (0,0,0), q: its normal is perpendicular to x; turning the whole pair around y and z
      // reaches every octant; its angle around x stays 0.3 rad from folding onto the first (3 pi / 2).
      const yaw = (k % 8) * 0.8 + 0.1;
      const pitch = Math.floor(k / 8) * 0.7 - 2.4;
      const rotate = ([x, y, z]: number[]): number[] => {
        const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
        const x1 = x! * cy + z! * sy;
        const z1 = -x! * sy + z! * cy;
        return [x1 * cp - y! * sp, x1 * sp + y! * cp, z1];
      };
      const corners = [
        [0, 0, 0],
        [1, 0, 0],
        [0.5, 0, -1],
        [0.5, Math.cos(0.2 + (k % 16) * 0.28), Math.sin(0.2 + (k % 16) * 0.28)],
      ].map(rotate);
      const w = words(corners.flat(), [0, 1, 2, 1, 0, 3]);
      const [p0, p1, p3] = [corners[1]!, corners[0]!, corners[3]!];
      const u = [p0[0]! - p1[0]!, p0[1]! - p1[1]!, p0[2]! - p1[2]!].map((v) => -v);
      const v = [p3[0]! - p0[0]!, p3[1]! - p0[1]!, p3[2]! - p0[2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const length = Math.hypot(...n);
      const got = decode(w[1] ?? 0);
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c]! - n[c]! / length), `case ${k}`).toBeLessThan(1e-3);
    }
  });

  it('welds corners closer than the weld distance and keeps farther ones apart', () => {
    const near = words([0, 0, 0, 1, 0, 0, 0, 1, 0, 1.00002, 0, 0, 0, 0, 0, 0.5, -1, 0], [0, 1, 2, 3, 4, 5]);
    expect((near[0] ?? 0) & OPEN_EDGE).toBe(0);
    const far = words([0, 0, 0, 1, 0, 0, 0, 1, 0, 1.001, 0, 0, 0, 0, 0, 0.5, -1, 0], [0, 1, 2, 3, 4, 5]);
    expect((far[0] ?? 0) & OPEN_EDGE).toBe(OPEN_EDGE);
  });

  it('opens every edge of a triangle with a non-finite corner and the edge a neighbour shares with it', () => {
    const w = words([0, 0, 0, 1, 0, 0, NaN, 1, 0, 0, -1, 0], [0, 1, 2, 1, 0, 3]);
    expect(w[0]).toBe(ALL_OPEN);
    expect((w[4] ?? 0) & OPEN_EDGE).toBe(OPEN_EDGE);
    expect([w[1], w[2], w[3], w[5]]).toEqual([0, 0, 0, 0]);
  });

  it('is deterministic', () => {
    const positions = Array.from({ length: 60 }, (_, i) => Math.sin(i * 1.7) * 3);
    const indices = Array.from({ length: 30 }, (_, i) => (i * 7) % 20);
    expect([...words(positions, indices)]).toEqual([...words(positions, indices)]);
  });
});
