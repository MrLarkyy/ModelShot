/**
 * Per-vertex UV rectangles `[uMin, vMin, uMax, vMax]` for a run of indexed triangles: each vertex gets the union of the
 * UV bounding boxes of the triangles that use it. For an atlas export with one face per region this is the face's
 * region; it is never narrower than a triangle's own texels, so texel anti-aliasing never clamps inside a face. Linear
 * filtering reads one texel past it (`linearTexelRange`), as a rectangle that differs across a shared edge would seam. A
 * vertex no triangle uses gets the point rectangle of its own UV. Writes `rects` for the vertices in
 * `[firstVertex, endVertex)` from the triangles in `indices[start, start + count)`.
 */
export function writeUvRects(
  uvs: Float32Array,
  indices: Uint32Array,
  rects: Float32Array,
  range: { readonly firstVertex: number; readonly endVertex: number; readonly start: number; readonly count: number },
): void {
  for (let v = range.firstVertex; v < range.endVertex; v++) {
    const u = uvs[v * 2] ?? 0;
    const w = uvs[v * 2 + 1] ?? 0;
    // Replaced by the first triangle that uses the vertex.
    rects.set([u, w, u, w], v * 4);
  }
  const used = new Uint8Array(range.endVertex - range.firstVertex);
  for (let t = range.start; t + 2 < range.start + range.count; t += 3) {
    const corners = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0];
    const us = corners.map((v) => uvs[v * 2] ?? 0);
    const vs = corners.map((v) => uvs[v * 2 + 1] ?? 0);
    const box = [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)] as const;
    for (const v of corners) {
      const k = v * 4;
      const slot = v - range.firstVertex;
      if (!used[slot]) {
        used[slot] = 1;
        rects.set(box, k);
        continue;
      }
      rects[k] = Math.min(rects[k] ?? 0, box[0]);
      rects[k + 1] = Math.min(rects[k + 1] ?? 0, box[1]);
      rects[k + 2] = Math.max(rects[k + 2] ?? 0, box[2]);
      rects[k + 3] = Math.max(rects[k + 3] ?? 0, box[3]);
    }
  }
}

/** Untextured vertices: the centre texel and the whole image (a generated 1×1 colour texture or none). */
export function writeUntexturedUvs(
  uvs: Float32Array,
  rects: Float32Array,
  firstVertex: number,
  endVertex: number,
): void {
  for (let v = firstVertex; v < endVertex; v++) {
    uvs.set([0.5, 0.5], v * 2);
    rects.set([0, 0, 1, 1], v * 4);
  }
}
