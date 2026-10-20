import type { AccessorInfo, GltfAccessors } from './GltfAccessors';
import { GltfError } from './GltfError';
import type { GltfWarningList } from './GltfWarning';
import type { MaterialUvs } from './convertMaterials';
import { childPath, field, type JsonObject } from '../json/JsonObject';
import { readIndex, readObject, readOptionalIndex, readOptionalInteger } from './gltfFields';
import { reportPrimitive } from './reportUnsupported';

export const TRIANGLES = 4;
export const TRIANGLE_STRIP = 5;

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
 * Checks one primitive and sizes its output; `null` when it is skipped (points and lines, sparse accessors, no
 * triangles at all, each reported). Strips and fans count `n − 2` triangles, lists `n / 3`.
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
  if (triangles === 0) {
    warnings.add('EMPTY_PRIMITIVE', path, `${elements} element(s) make no triangle; the primitive is skipped`);
    return null;
  }
  const vertices = normals ? positions.count : triangles * 3;
  return { path, mode, positions, normals, uvs, indices, material, triangles, vertices };
}
