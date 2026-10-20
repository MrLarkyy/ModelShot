import { ALPHA_MODE_ID } from '@modelshot/looks';
import { resolveMaterialAlpha, type SceneDocument, type SceneMesh } from '@modelshot/scene';

/**
 * Raster frames skip the back pass of a mesh that is closed and opaque on every face: from outside its bounds every
 * ray meets one of its front faces before any of its back sides, so a back side could only show through the MSAA
 * depth mismatch beside a near edge-on face (docs/realtime-renderer.md). This module decides which meshes qualify.
 */

/** Positions closer than this (model units) are the same corner when matching edges. */
const CLOSED_EDGE_EPSILON = 1e-5;

/** Smallest power of two at least twice `count` (an open-addressing table at most half full). */
function tableSize(count: number): number {
  let size = 16;
  while (size < count * 2) size *= 2;
  return size;
}

/** Hash of two or three integers held as doubles (ToInt32 wraps the large ones; equality is checked in full). */
function mix(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1);
  h = Math.imul(h ^ (b | 0), 0x85ebca6b);
  h = Math.imul(h ^ (c | 0), 0xc2b2ae35);
  return (h ^ (h >>> 15)) >>> 0;
}

/** One id per distinct position of `positions` (within CLOSED_EDGE_EPSILON), in order of first appearance. */
function positionIds(positions: Float32Array): Int32Array {
  const vertexCount = Math.floor(positions.length / 3);
  const quantised = new Float64Array(vertexCount * 3);
  for (let i = 0; i < vertexCount * 3; i++) quantised[i] = Math.round((positions[i] ?? 0) / CLOSED_EDGE_EPSILON);
  const ids = new Int32Array(vertexCount);
  const size = tableSize(vertexCount);
  // Each slot holds the first vertex of a position, −1 when empty.
  const slots = new Int32Array(size).fill(-1);
  let next = 0;
  for (let v = 0; v < vertexCount; v++) {
    const x = quantised[v * 3] ?? 0;
    const y = quantised[v * 3 + 1] ?? 0;
    const z = quantised[v * 3 + 2] ?? 0;
    for (let slot = mix(x, y, z) & (size - 1); ; slot = (slot + 1) & (size - 1)) {
      const first = slots[slot] ?? -1;
      if (first < 0) {
        slots[slot] = v;
        ids[v] = next++;
        break;
      }
      if (quantised[first * 3] === x && quantised[first * 3 + 1] === y && quantised[first * 3 + 2] === z) {
        ids[v] = ids[first] ?? 0;
        break;
      }
    }
  }
  return ids;
}

/**
 * Whether the triangles `indices` (over `positions`) form a closed surface: every edge, matched by position, is used
 * exactly once in each direction. An open border, a missing face, a face wound the other way, a duplicated face or a
 * pair of coincident opposite faces all break it. Triangles with two corners at one position are ignored (they cover
 * nothing); no other triangle at all is not closed. Linear in the vertex and index count (open-addressing tables, no
 * per-vertex strings): about 40 to 65 ms in Node at the loader's limit of 400 000 vertices.
 */
export function closedSurface(positions: Float32Array, indices: ArrayLike<number>): boolean {
  const triangles = Math.floor(indices.length / 3);
  if (triangles === 0) return false;
  const ids = positionIds(positions);
  const size = tableSize(triangles * 3);
  // Directed edges from → to, −1 when empty.
  const from = new Int32Array(size).fill(-1);
  const to = new Int32Array(size);
  const find = (a: number, b: number): number => {
    for (let slot = mix(a, b) & (size - 1); ; slot = (slot + 1) & (size - 1)) {
      const at = from[slot] ?? -1;
      if (at < 0 || (at === a && to[slot] === b)) return slot;
    }
  };
  let edges = 0;
  for (let t = 0; t < triangles; t++) {
    const c0 = ids[indices[t * 3] ?? 0] ?? 0;
    const c1 = ids[indices[t * 3 + 1] ?? 0] ?? 0;
    const c2 = ids[indices[t * 3 + 2] ?? 0] ?? 0;
    if (c0 === c1 || c1 === c2 || c2 === c0) continue;
    for (const [a, b] of [
      [c0, c1],
      [c1, c2],
      [c2, c0],
    ] as const) {
      const slot = find(a, b);
      // A second use of one directed edge: a duplicated face or two faces wound alike across it.
      if ((from[slot] ?? -1) >= 0) return false;
      from[slot] = a;
      to[slot] = b;
      edges++;
    }
  }
  if (edges === 0) return false;
  for (let slot = 0; slot < size; slot++) {
    const a = from[slot] ?? -1;
    if (a >= 0 && (from[find(to[slot] ?? 0, a)] ?? -1) < 0) return false;
  }
  return true;
}

/** Texels with an alpha byte below 255 of one texture, as a summed-area table. */
export interface TranslucentTexels {
  readonly width: number;
  readonly height: number;
  /** `(width + 1) × (height + 1)`: entry (x, y) counts the translucent texels above and left of texel (x, y). */
  readonly sums: Uint32Array;
}

/**
 * What a texture's readback says about its alpha: `opaque` (every byte 255), the table of its translucent texels, or
 * `unknown` (the readback failed: no face using it counts as opaque).
 */
export type TextureOpacity = 'opaque' | 'unknown' | TranslucentTexels;

/** The opacity of an RGBA8 image (rows as `texelFetch` indexes them, row 0 first), from its alpha bytes. */
export function textureOpacityOf(rgba: Uint8Array, width: number, height: number): TextureOpacity {
  let any = false;
  for (let i = 3; i < rgba.length && !any; i += 4) any = (rgba[i] ?? 255) < 255;
  if (!any) return 'opaque';
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 255) < 255) row++;
      sums[(y + 1) * stride + x + 1] = (sums[y * stride + x + 1] ?? 0) + row;
    }
  }
  return { width, height, sums };
}

/**
 * Translucent texels a face samples: those in its texel range, from the normalised UV rectangle
 * `[uMin, vMin, uMax, vMax]` the way `faceTexelRange` (texelSample.glsl) computes it, clamped to the image.
 */
export function translucentTexelsIn(table: TranslucentTexels, rect: ArrayLike<number>): number {
  const { width, height, sums } = table;
  const range = (min: number, max: number, size: number): [number, number] => {
    const lo = Math.floor(Math.min(min, max) * size + 1e-3);
    const hi = Math.max(Math.ceil(Math.max(min, max) * size - 1e-3) - 1, lo);
    return [Math.min(Math.max(lo, 0), size - 1), Math.min(Math.max(hi, 0), size - 1)];
  };
  const [x0, x1] = range(rect[0] ?? 0, rect[2] ?? 0, width);
  const [y0, y1] = range(rect[1] ?? 0, rect[3] ?? 0, height);
  const stride = width + 1;
  const at = (x: number, y: number) => sums[y * stride + x] ?? 0;
  return at(x1 + 1, y1 + 1) - at(x0, y1 + 1) - at(x1 + 1, y0) + at(x0, y0);
}

/** The drawn triangles of a mesh: its groups' index ranges, or every index without groups. */
function drawnIndices(mesh: SceneMesh): ArrayLike<number> {
  if (mesh.groups.length === 0) return mesh.indices;
  if (mesh.groups.length === 1 && mesh.groups[0]?.start === 0 && mesh.groups[0].count === mesh.indices.length) {
    return mesh.indices;
  }
  const drawn: number[] = [];
  for (const group of mesh.groups) {
    for (let i = group.start; i < group.start + group.count; i++) drawn.push(mesh.indices[i] ?? 0);
  }
  return drawn;
}

/**
 * Whether every drawn face of `mesh` is opaque: untextured, under the opaque alpha mode, or with no alpha byte below
 * 255 inside its UV rectangle (`opacity[t]` per texture of the document).
 */
export function meshFacesOpaque(doc: SceneDocument, mesh: SceneMesh, opacity: readonly TextureOpacity[]): boolean {
  const groups = mesh.groups.length > 0 ? mesh.groups : [{ material: -1, start: 0, count: mesh.indices.length }];
  for (const group of groups) {
    if (group.count === 0) continue;
    const material = group.material >= 0 ? doc.materials[group.material] : undefined;
    const texture = material?.texture ?? -1;
    if (texture < 0 || ALPHA_MODE_ID[resolveMaterialAlpha(material).mode] === ALPHA_MODE_ID.opaque) continue;
    const table = opacity[texture] ?? 'unknown';
    if (table === 'opaque') continue;
    if (table === 'unknown') return false;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const corner = mesh.indices[i] ?? 0;
      if (translucentTexelsIn(table, mesh.uvRects.subarray(corner * 4, corner * 4 + 4)) > 0) return false;
    }
  }
  return true;
}

/**
 * Per mesh of `doc`: closed (`closedSurface` over its drawn triangles) and opaque on every face (`meshFacesOpaque`),
 * so raster frames may skip its back pass. Only meshes with a double-sided group are checked (single-sided ones have
 * no back pass); the others, and meshes without triangles, are false.
 */
export function closedOpaqueMeshes(doc: SceneDocument, opacity: readonly TextureOpacity[]): boolean[] {
  return doc.meshes.map((mesh) => {
    if (!mesh.groups.some((group) => group.doubleSided)) return false;
    return meshFacesOpaque(doc, mesh, opacity) && closedSurface(mesh.positions, drawnIndices(mesh));
  });
}

/**
 * Whether a raster frame must still draw the back sides of a closed opaque batch with world bounds `bounds`
 * (`[minX, minY, minZ, maxX, maxY, maxZ]`): when the camera is inside the bounds, or when the near plane reaches them
 * (a clipped front face would open the surface). `view` is the column-major view matrix, `near` the near distance.
 */
export function backSidesVisible(
  bounds: ArrayLike<number>,
  eye: readonly [number, number, number],
  view: ArrayLike<number>,
  near: number,
): boolean {
  let inside = true;
  for (let k = 0; k < 3; k++) {
    const e = eye[k] ?? 0;
    if (e < (bounds[k] ?? 0) || e > (bounds[k + 3] ?? 0)) inside = false;
  }
  if (inside) return true;
  // Smallest view depth over the eight corners (view space looks down −z).
  let nearest = Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const x = bounds[corner & 1 ? 3 : 0] ?? 0;
    const y = bounds[corner & 2 ? 4 : 1] ?? 0;
    const z = bounds[corner & 4 ? 5 : 2] ?? 0;
    const depth = -((view[2] ?? 0) * x + (view[6] ?? 0) * y + (view[10] ?? 0) * z + (view[14] ?? 0));
    nearest = Math.min(nearest, depth);
  }
  return nearest <= near * (1 + 1e-6);
}

/** World bounds `[minX, minY, minZ, maxX, maxY, maxZ]` of `positions` under the column-major `model` matrix. */
export function worldBounds(positions: Float32Array, model: ArrayLike<number>): Float64Array {
  const local = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const p = positions[i + k] ?? 0;
      local[k] = Math.min(local[k] ?? 0, p);
      local[k + 3] = Math.max(local[k + 3] ?? 0, p);
    }
  }
  const bounds = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let corner = 0; corner < 8; corner++) {
    const p = [local[corner & 1 ? 3 : 0] ?? 0, local[corner & 2 ? 4 : 1] ?? 0, local[corner & 4 ? 5 : 2] ?? 0];
    for (let k = 0; k < 3; k++) {
      const w =
        (model[k] ?? 0) * (p[0] ?? 0) +
        (model[4 + k] ?? 0) * (p[1] ?? 0) +
        (model[8 + k] ?? 0) * (p[2] ?? 0) +
        (model[12 + k] ?? 0);
      bounds[k] = Math.min(bounds[k] ?? 0, w);
      bounds[k + 3] = Math.max(bounds[k + 3] ?? 0, w);
    }
  }
  return bounds;
}
