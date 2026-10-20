import { describe, expect, it } from 'vitest';
import { writeUntexturedUvs, writeUvRects } from '../../src/uv/uvRects';

const rounded = (values: Float32Array) => [...values].map((x) => Math.round(x * 1000) / 1000);

describe('writeUvRects', () => {
  it('a per-face atlas quad: every vertex gets the face rectangle', () => {
    const uvs = new Float32Array([0.25, 0.5, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const rects = new Float32Array(16);
    writeUvRects(uvs, indices, rects, { firstVertex: 0, endVertex: 4, start: 0, count: 6 });
    for (let v = 0; v < 4; v++) expect([...rects.slice(v * 4, v * 4 + 4)]).toEqual([0.25, 0.25, 0.5, 0.5]);
  });

  it('a shared vertex gets the union of its triangles, never narrower than one of them', () => {
    // Vertex 1 is shared by two triangles over different atlas regions.
    const uvs = new Float32Array([0, 0, 0.5, 0.5, 0, 0.5, 1, 1, 1, 0.5]);
    const indices = new Uint32Array([0, 1, 2, 1, 3, 4]);
    const rects = new Float32Array(20);
    writeUvRects(uvs, indices, rects, { firstVertex: 0, endVertex: 5, start: 0, count: 6 });
    expect([...rects.slice(0, 4)]).toEqual([0, 0, 0.5, 0.5]);
    expect([...rects.slice(4, 8)]).toEqual([0, 0, 1, 1]);
    expect([...rects.slice(12, 16)]).toEqual([0.5, 0.5, 1, 1]);
  });

  it('an unused vertex keeps the point rectangle of its own UV; only the given range is written', () => {
    const uvs = new Float32Array([9, 9, 0.1, 0.2, 0, 0, 1, 0, 0, 1]);
    const indices = new Uint32Array([2, 3, 4]);
    const rects = new Float32Array(20).fill(7);
    writeUvRects(uvs, indices, rects, { firstVertex: 1, endVertex: 5, start: 0, count: 3 });
    expect([...rects.slice(0, 4)]).toEqual([7, 7, 7, 7]);
    expect(rounded(rects.slice(4, 8))).toEqual([0.1, 0.2, 0.1, 0.2]);
    expect([...rects.slice(8, 12)]).toEqual([0, 0, 1, 1]);
  });

  it('untextured vertices sample the centre of the whole image', () => {
    const uvs = new Float32Array(6);
    const rects = new Float32Array(12);
    writeUntexturedUvs(uvs, rects, 1, 3);
    expect([...uvs]).toEqual([0, 0, 0.5, 0.5, 0.5, 0.5]);
    expect([...rects.slice(4)]).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
  });
});
