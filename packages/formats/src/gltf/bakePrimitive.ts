import type { Mat4, SceneMesh, SceneMeshGroup } from '@modelshot/scene';
import { writeUntexturedUvs, writeUvRects } from '../uv/uvRects';
import type { AccessorInfo, GltfAccessors } from './GltfAccessors';
import { GltfError } from './GltfError';
import type { GltfWarningList } from './GltfWarning';
import type { MaterialUvs } from './convertMaterials';
import {
  childPath,
  field,
  readIndex,
  readObject,
  readOptionalIndex,
  readOptionalInteger,
  type JsonObject,
} from './gltfFields';
import { reportPrimitive } from './reportUnsupported';
import { applyTextureTransform } from './TextureTransform';

const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;

/** A primitive that will be drawn, validated from the JSON alone; its sizes are known before anything is decoded. */
export interface PrimitivePlan {
  readonly path: string;
  readonly mode: number;
  readonly positions: AccessorInfo;
  readonly normals: AccessorInfo | null;
  readonly uvs: AccessorInfo | null;
  readonly indices: AccessorInfo | null;
  /** Scene material index, −1 for none. */
  readonly material: number;
  readonly triangles: number;
  /** Vertices emitted: the position count, or three per triangle when flat normals need de-indexing. */
  readonly vertices: number;
}

export interface PrimitiveContext {
  readonly accessors: GltfAccessors;
  readonly materials: readonly MaterialUvs[];
  readonly warnings: GltfWarningList;
}

/**
 * Checks one primitive and sizes its output; `null` when it is skipped (points and lines, sparse accessors, each
 * reported). Strips and fans count `n − 2` triangles, lists `n / 3`.
 */
export function planPrimitive(primitive: JsonObject, path: string, context: PrimitiveContext): PrimitivePlan | null {
  const { accessors, materials, warnings } = context;
  const mode = readOptionalInteger(primitive, 'mode', path, { min: 0, max: 6 }, TRIANGLES);
  if (!reportPrimitive(primitive, mode, path, warnings)) return null;
  const attributesPath = childPath(path, 'attributes');
  const attributes = readObject(field(primitive, 'attributes'), attributesPath);
  const attribute = (name: string, usage: 'POSITION' | 'NORMAL' | 'TEXCOORD'): AccessorInfo | null => {
    const index = readOptionalIndex(attributes, name, attributesPath, accessors.count);
    return index === undefined ? null : accessors.describe(index, usage);
  };
  const positionIndex = field(attributes, 'POSITION');
  if (positionIndex === undefined)
    throw new GltfError('INVALID_FIELD', attributesPath, 'expected a POSITION attribute');
  const positions = accessors.describe(
    readIndex(positionIndex, childPath(attributesPath, 'POSITION'), accessors.count),
    'POSITION',
  );
  const normals = attribute('NORMAL', 'NORMAL');
  const material = readOptionalIndex(primitive, 'material', path, materials.length) ?? -1;
  const materialUvs = materials[material];
  let uvs: AccessorInfo | null = null;
  if (materialUvs?.textured) {
    uvs = attribute(`TEXCOORD_${materialUvs.texCoord}`, 'TEXCOORD');
    if (!uvs) {
      warnings.add(
        'MISSING_TEXCOORD',
        attributesPath,
        `no TEXCOORD_${materialUvs.texCoord} for the material's texture; every vertex samples texel (0, 0)`,
      );
    }
  }
  const indexAccessor = readOptionalIndex(primitive, 'indices', path, accessors.count);
  const indices = indexAccessor === undefined ? null : accessors.describe(indexAccessor, 'INDICES');
  for (const info of [positions, normals, uvs]) {
    if (info && info !== positions && info.count !== positions.count) {
      throw new GltfError('INVALID_FIELD', info.path, `${info.count} elements, POSITION has ${positions.count}`);
    }
  }
  const sparse = [positions, normals, uvs, indices].find((info) => info?.sparse);
  if (sparse) {
    warnings.add('UNSUPPORTED_SPARSE_ACCESSOR', sparse.path, 'sparse storage is not read; the primitive is skipped');
    return null;
  }
  const elements = indices?.count ?? positions.count;
  if (mode === TRIANGLES && elements % 3 !== 0) {
    throw new GltfError(
      'INVALID_FIELD',
      indices?.path ?? positions.path,
      `${elements} elements is not a multiple of 3`,
    );
  }
  const triangles = mode === TRIANGLES ? elements / 3 : Math.max(0, elements - 2);
  const vertices = normals ? positions.count : triangles * 3;
  return { path, mode, positions, normals, uvs, indices, material, triangles, vertices };
}

/** Upper 3×3 determinant of a column-major matrix. */
export function determinant3(m: Mat4): number {
  const a = (i: number): number => m[i] ?? 0;
  return a(0) * (a(5) * a(10) - a(9) * a(6)) - a(4) * (a(1) * a(10) - a(9) * a(2)) + a(8) * (a(1) * a(6) - a(5) * a(2));
}

/** A transform that flattens space (relative to the lengths of its axes) cannot carry a mesh. */
export function isDegenerate(m: Mat4): boolean {
  const column = (c: number): number => Math.hypot(m[c * 4] ?? 0, m[c * 4 + 1] ?? 0, m[c * 4 + 2] ?? 0);
  const scale = column(0) * column(1) * column(2);
  return !(scale > 0) || Math.abs(determinant3(m)) <= 1e-9 * scale;
}

/**
 * Bakes the primitives of one mesh instance into world space (`transform` already includes the unit scale): positions
 * by the matrix, normals by its inverse transpose, renormalised; a mirroring transform (negative determinant) swaps
 * two corners of every triangle so fronts stay counter-clockwise and outward. One group per primitive.
 */
export function bakeMesh(
  name: string,
  node: number,
  transform: Mat4,
  plans: readonly PrimitivePlan[],
  context: PrimitiveContext,
  reportedWrap: Set<number>,
): SceneMesh {
  const vertexTotal = plans.reduce((sum, plan) => sum + plan.vertices, 0);
  const indexTotal = plans.reduce((sum, plan) => sum + plan.triangles * 3, 0);
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const uvRects = new Float32Array(vertexTotal * 4);
  const indices = new Uint32Array(indexTotal);
  const groups: SceneMeshGroup[] = [];
  const mirrored = determinant3(transform) < 0;
  const normalMatrix = inverseTranspose3(transform);
  let base = 0;
  let start = 0;
  for (const plan of plans) {
    const source = context.accessors.readFloats(plan.positions);
    const corners = triangleCorners(plan, context.accessors, mirrored);
    const sourceNormals = plan.normals ? context.accessors.readFloats(plan.normals) : null;
    const sourceUvs = plan.uvs ? context.accessors.readFloats(plan.uvs) : null;
    const materialUvs = context.materials[plan.material];
    if (sourceUvs && materialUvs?.transform) applyTextureTransform(sourceUvs, materialUvs.transform);
    // Indexed with normals: vertex k is source vertex k. Flat normals: vertex k is corner k of the triangle list.
    const sourceOf = (k: number): number => (sourceNormals ? k : (corners[k] ?? 0));
    for (let k = 0; k < plan.vertices; k++) {
      const s = sourceOf(k);
      const p = transformPoint(transform, source[s * 3] ?? 0, source[s * 3 + 1] ?? 0, source[s * 3 + 2] ?? 0);
      if (!p.every(Number.isFinite)) {
        throw new GltfError('NON_FINITE_DATA', plan.positions.path, `vertex ${s} leaves the finite range when placed`);
      }
      positions.set(p, (base + k) * 3);
      if (sourceUvs) uvs.set([sourceUvs[s * 2] ?? 0, sourceUvs[s * 2 + 1] ?? 0], (base + k) * 2);
    }
    for (let t = 0; t < plan.triangles; t++) {
      for (let c = 0; c < 3; c++)
        indices[start + t * 3 + c] = base + (sourceNormals ? (corners[t * 3 + c] ?? 0) : t * 3 + c);
    }
    writeNormals(normals, positions, indices, { base, start, plan, sourceNormals, normalMatrix });
    const range = { firstVertex: base, endVertex: base + plan.vertices, start, count: plan.triangles * 3 };
    if (materialUvs?.textured) {
      writeUvRects(uvs, indices, uvRects, range);
      if (materialUvs.wraps && !reportedWrap.has(plan.material) && outsideUnit(uvs, base, base + plan.vertices)) {
        reportedWrap.add(plan.material);
        context.warnings.add(
          'UV_WRAP_CLAMPED',
          materialUvs.path,
          'UVs leave 0..1 under a repeating sampler; the texture is clamped at its edges',
        );
      }
    } else writeUntexturedUvs(uvs, uvRects, base, base + plan.vertices);
    groups.push({
      material: plan.material,
      start,
      count: plan.triangles * 3,
      doubleSided: materialUvs?.doubleSided ?? false,
    });
    base += plan.vertices;
    start += plan.triangles * 3;
  }
  return { name, sourceId: '', node, visible: true, positions, normals, uvs, uvRects, indices, groups };
}

/** Source vertex indices, three per triangle, strips and fans as lists, winding swapped under a mirror. */
function triangleCorners(plan: PrimitivePlan, accessors: GltfAccessors, mirrored: boolean): Uint32Array {
  const elements = plan.indices
    ? accessors.readIndices(plan.indices, plan.positions.count)
    : Uint32Array.from({ length: plan.positions.count }, (_, i) => i);
  const corners = new Uint32Array(plan.triangles * 3);
  for (let t = 0; t < plan.triangles; t++) {
    let a: number;
    let b: number;
    let c: number;
    if (plan.mode === TRIANGLES) [a, b, c] = [t * 3, t * 3 + 1, t * 3 + 2];
    // glTF: strip triangle i is (i, i + 1 + i % 2, i + 2 − i % 2); fan triangle i is (i + 1, i + 2, 0).
    else if (plan.mode === TRIANGLE_STRIP) [a, b, c] = [t, t + 1 + (t % 2), t + 2 - (t % 2)];
    else [a, b, c] = [t + 1, t + 2, 0];
    corners.set(
      mirrored
        ? [elements[a] ?? 0, elements[c] ?? 0, elements[b] ?? 0]
        : [elements[a] ?? 0, elements[b] ?? 0, elements[c] ?? 0],
      t * 3,
    );
  }
  return corners;
}

interface NormalRun {
  readonly base: number;
  readonly start: number;
  readonly plan: PrimitivePlan;
  readonly sourceNormals: Float32Array | null;
  readonly normalMatrix: readonly number[];
}

/**
 * Given normals through the inverse transpose, renormalised; a missing, zero or non-finite one takes the face normal
 * of the first triangle using it. Without normals every (de-indexed) corner gets its triangle's face normal.
 */
function writeNormals(normals: Float32Array, positions: Float32Array, indices: Uint32Array, run: NormalRun): void {
  const { base, start, plan, sourceNormals, normalMatrix } = run;
  const filled = new Uint8Array(plan.vertices);
  if (sourceNormals) {
    for (let k = 0; k < plan.vertices; k++) {
      const n = multiply3(
        normalMatrix,
        sourceNormals[k * 3] ?? NaN,
        sourceNormals[k * 3 + 1] ?? NaN,
        sourceNormals[k * 3 + 2] ?? NaN,
      );
      const unit = normalise(n);
      if (unit) {
        normals.set(unit, (base + k) * 3);
        filled[k] = 1;
      }
    }
  }
  for (let t = 0; t < plan.triangles; t++) {
    const corner = (c: number): number => indices[start + t * 3 + c] ?? 0;
    const at = (v: number, axis: number): number => positions[v * 3 + axis] ?? 0;
    const [v0, v1, v2] = [corner(0), corner(1), corner(2)];
    const e1 = [at(v1, 0) - at(v0, 0), at(v1, 1) - at(v0, 1), at(v1, 2) - at(v0, 2)] as const;
    const e2 = [at(v2, 0) - at(v0, 0), at(v2, 1) - at(v0, 1), at(v2, 2) - at(v0, 2)] as const;
    const face = normalise([
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ]) ?? [0, 1, 0];
    for (const v of [v0, v1, v2]) {
      if (filled[v - base]) continue;
      filled[v - base] = 1;
      normals.set(face, v * 3);
    }
  }
}

function outsideUnit(uvs: Float32Array, from: number, to: number): boolean {
  for (let i = from * 2; i < to * 2; i++) {
    const value = uvs[i] ?? 0;
    if (value < -1e-6 || value > 1 + 1e-6) return true;
  }
  return false;
}

function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  const a = (i: number): number => m[i] ?? 0;
  return [
    a(0) * x + a(4) * y + a(8) * z + a(12),
    a(1) * x + a(5) * y + a(9) * z + a(13),
    a(2) * x + a(6) * y + a(10) * z + a(14),
  ];
}

/** Row-major 3×3 inverse transpose of the upper 3×3 (cofactors over the determinant). */
function inverseTranspose3(m: Mat4): number[] {
  const a = (col: number, row: number): number => m[col * 4 + row] ?? 0;
  const det = determinant3(m);
  const cofactor = (row: number, col: number): number => {
    const r = [0, 1, 2].filter((i) => i !== row);
    const c = [0, 1, 2].filter((i) => i !== col);
    const [r0 = 0, r1 = 0] = r;
    const [c0 = 0, c1 = 0] = c;
    const minor = a(c0, r0) * a(c1, r1) - a(c1, r0) * a(c0, r1);
    return ((row + col) % 2 ? -minor : minor) / det;
  };
  return [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => cofactor(row, col)));
}

function multiply3(m: readonly number[], x: number, y: number, z: number): [number, number, number] {
  const a = (i: number): number => m[i] ?? 0;
  return [a(0) * x + a(1) * y + a(2) * z, a(3) * x + a(4) * y + a(5) * z, a(6) * x + a(7) * y + a(8) * z];
}

function normalise(v: readonly [number, number, number]): [number, number, number] | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 1e-12) || !Number.isFinite(length)) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}
