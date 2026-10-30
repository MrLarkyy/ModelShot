import type { Mat4, SceneMesh, SceneMeshGroup } from '@modelshot/scene';
import { mat3Determinant, mat3FromMat4, mat3InverseTranspose, mat3TransformVector, type Mat3 } from '../math/Mat3';
import { writeUntexturedUvs, writeUvRects } from '../uv/uvRects';
import type { MaterialUvs } from './convertMaterials';
import type { DecodedPrimitive } from './decodePrimitive';
import { GltfError } from './GltfError';
import type { GltfWarningList } from './GltfWarning';
import type { PrimitivePlan } from './planPrimitive';

export interface BakeContext {
  readonly materials: readonly MaterialUvs[];
  readonly warnings: GltfWarningList;
  /** The decoded data of a plan (decoded once, shared by every instance). */
  readonly decoded: (plan: PrimitivePlan) => DecodedPrimitive;
  /** Materials already reported for UVs outside 0..1. */
  readonly reportedWrap: Set<number>;
}

/**
 * Bakes the primitives of one mesh instance into world space (`transform` already includes the unit scale): positions
 * by the matrix, normals by its inverse transpose, renormalised; a mirroring transform (negative determinant) swaps
 * two corners of every triangle so fronts stay counter-clockwise and outward. One group per primitive. Every stored
 * position must be finite in float32 (`NON_FINITE_DATA`).
 */
export function bakeMesh(
  name: string,
  node: number,
  transform: Mat4,
  plans: readonly PrimitivePlan[],
  context: BakeContext,
): SceneMesh {
  const vertexTotal = plans.reduce((sum, plan) => sum + plan.vertices, 0);
  const indexTotal = plans.reduce((sum, plan) => sum + plan.triangles * 3, 0);
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const uvRects = new Float32Array(vertexTotal * 4);
  const indices = new Uint32Array(indexTotal);
  const groups: SceneMeshGroup[] = [];
  const linear = mat3FromMat4(transform);
  const mirrored = mat3Determinant(linear) < 0;
  const normalMatrix = mat3InverseTranspose(linear);
  let base = 0;
  let start = 0;
  for (const plan of plans) {
    const data = context.decoded(plan);
    const corner = (t: number, c: number): number => data.corners[t * 3 + (mirrored && c > 0 ? 3 - c : c)] ?? 0;
    // Indexed with normals: vertex k is source vertex k. Flat normals: vertex k is corner k of the triangle list.
    const sourceOf = (k: number): number => (data.normals ? k : corner(Math.floor(k / 3), k % 3));
    for (let k = 0; k < plan.vertices; k++) {
      const s = sourceOf(k);
      const p = transformPoint(
        transform,
        data.positions[s * 3] ?? 0,
        data.positions[s * 3 + 1] ?? 0,
        data.positions[s * 3 + 2] ?? 0,
      );
      positions.set(p, (base + k) * 3);
      if (
        !Number.isFinite(positions[(base + k) * 3]! + positions[(base + k) * 3 + 1]! + positions[(base + k) * 3 + 2]!)
      ) {
        throw new GltfError('NON_FINITE_DATA', plan.positions.path, `vertex ${s} leaves the float32 range when placed`);
      }
      if (data.uvs) uvs.set([data.uvs[s * 2] ?? 0, data.uvs[s * 2 + 1] ?? 0], (base + k) * 2);
    }
    for (let t = 0; t < plan.triangles; t++) {
      for (let c = 0; c < 3; c++) indices[start + t * 3 + c] = base + (data.normals ? corner(t, c) : t * 3 + c);
    }
    writeNormals(normals, positions, indices, { base, start, plan, sourceNormals: data.normals, normalMatrix });
    const materialUvs = context.materials[plan.material];
    const range = { firstVertex: base, endVertex: base + plan.vertices, start, count: plan.triangles * 3 };
    if (materialUvs?.textured) {
      writeUvRects(uvs, indices, uvRects, range);
      const lost: string[] = [];
      for (const axis of [0, 1] as const) {
        const loss = axis === 0 ? materialUvs.wrapLoss.s : materialUvs.wrapLoss.t;
        const key = plan.material * 2 + axis;
        if (
          !loss ||
          context.reportedWrap.has(key) ||
          !reachesWrap(uvs, base, base + plan.vertices, axis, loss.margin)
        ) {
          continue;
        }
        context.reportedWrap.add(key);
        lost.push(loss.message);
      }
      if (lost.length > 0) context.warnings.add('UV_WRAP_APPROXIMATED', materialUvs.path, lost.join('; '));
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

interface NormalRun {
  readonly base: number;
  readonly start: number;
  readonly plan: PrimitivePlan;
  readonly sourceNormals: Float32Array | null;
  readonly normalMatrix: Mat3;
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
      const n = mat3TransformVector(
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

/** A UV on the axis outside `margin`..1 − `margin` (with a 1e-6 slack at margin 0), where a wrap shows. */
function reachesWrap(uvs: Float32Array, from: number, to: number, axis: 0 | 1, margin: number): boolean {
  const slack = margin === 0 ? 1e-6 : 0;
  for (let i = from * 2 + axis; i < to * 2; i += 2) {
    const value = uvs[i] ?? 0;
    if (value < margin - slack || value > 1 - margin + slack) return true;
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

function normalise(v: readonly [number, number, number]): [number, number, number] | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 1e-12) || !Number.isFinite(length)) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}
