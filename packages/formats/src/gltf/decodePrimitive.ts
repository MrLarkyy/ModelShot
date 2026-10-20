import type { MaterialUvs } from './convertMaterials';
import type { GltfAccessors } from './GltfAccessors';
import { GltfError } from './GltfError';
import { TRIANGLE_STRIP, TRIANGLES, type PrimitivePlan } from './planPrimitive';
import { applyTextureTransform } from './TextureTransform';

/** A primitive's data, decoded once however many nodes draw it. */
export interface DecodedPrimitive {
  /** 3 floats per source vertex (`plan.positions.count`), untransformed. */
  readonly positions: Float32Array;
  readonly normals: Float32Array | null;
  /** 2 floats per source vertex with `KHR_texture_transform` applied; `null` without a UV set. */
  readonly uvs: Float32Array | null;
  /** Source vertex of every triangle corner, three per triangle; strips and fans as lists, glTF winding. */
  readonly corners: Uint32Array;
}

/**
 * Decodes the accessors of `plan`. The caller has counted `plan.positions.count` (and the triangles) against the
 * limits, because an accessor without a buffer view has no bytes to bound it. Transformed UVs must stay finite in
 * float32 (`NON_FINITE_DATA`).
 */
export function decodePrimitive(
  plan: PrimitivePlan,
  accessors: GltfAccessors,
  materials: readonly MaterialUvs[],
): DecodedPrimitive {
  const positions = accessors.readFloats(plan.positions);
  const normals = plan.normals ? accessors.readFloats(plan.normals) : null;
  const uvs = plan.uvs ? accessors.readFloats(plan.uvs) : null;
  const transform = materials[plan.material]?.transform;
  if (uvs && transform) {
    applyTextureTransform(uvs, transform);
    const bad = uvs.findIndex((value) => !Number.isFinite(value));
    if (bad >= 0) {
      throw new GltfError(
        'NON_FINITE_DATA',
        plan.uvs?.path ?? plan.path,
        `KHR_texture_transform takes UV ${Math.floor(bad / 2)} beyond the float32 range`,
      );
    }
  }
  const elements = plan.indices
    ? accessors.readIndices(plan.indices, plan.positions.count)
    : Uint32Array.from({ length: plan.positions.count }, (_, i) => i);
  const corners = new Uint32Array(plan.triangles * 3);
  for (let t = 0; t < plan.triangles; t++) {
    // glTF: strip triangle i is (i, i + 1 + i % 2, i + 2 − i % 2); fan triangle i is (i + 1, i + 2, 0).
    const [a, b, c] =
      plan.mode === TRIANGLES
        ? [t * 3, t * 3 + 1, t * 3 + 2]
        : plan.mode === TRIANGLE_STRIP
          ? [t, t + 1 + (t % 2), t + 2 - (t % 2)]
          : [t + 1, t + 2, 0];
    corners.set([elements[a] ?? 0, elements[b] ?? 0, elements[c] ?? 0], t * 3);
  }
  return { positions, normals, uvs, corners };
}
