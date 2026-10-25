import { describe, expect, it } from 'vitest';
import { sharedEdgeFlags } from '../src/exactEdgeWords';

const quad = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];

describe('sharedEdgeFlags', () => {
  it('flags the diagonal of a quad in both triangles, by position', () => {
    // Triangles (0, 1, 2) and (0, 2, 3): edge 2 of the first (2 -> 0) and edge 0 of the second (0 -> 2).
    expect([...sharedEdgeFlags(new Float32Array(quad), new Uint32Array([0, 1, 2, 0, 2, 3]))]).toEqual([4, 1]);
    // The same quad with its own vertices per triangle (no shared indices) is matched by position.
    const split = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect([...sharedEdgeFlags(split, new Uint32Array([0, 1, 2, 3, 4, 5]))]).toEqual([4, 1]);
  });

  it('does not flag an edge shared with a triangle in another plane or facing the other way', () => {
    const bent = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
    expect([...sharedEdgeFlags(bent, new Uint32Array([0, 1, 2, 3, 4, 5]))]).toEqual([0, 0]);
    // The second triangle wound the other way: its normal is opposite, so it is a back-to-back face, not a neighbour.
    const flipped = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0]);
    expect([...sharedEdgeFlags(flipped, new Uint32Array([0, 1, 2, 3, 4, 5]))]).toEqual([0, 0]);
  });

  it('leaves the outline of a lone triangle unflagged', () => {
    expect([...sharedEdgeFlags(new Float32Array(quad), new Uint32Array([0, 1, 2]))]).toEqual([0]);
  });
});
