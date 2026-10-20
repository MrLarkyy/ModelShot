import { BbmodelError } from './BbmodelError';
import type { ConverterContext } from './ElementConverter';
import { childPath, field, type JsonObject } from './JsonFields';
import { quoteValue } from '../text/quoteValue';

/**
 * Blockbench's face texture: `null` is returned for an explicit `null` (a cube drops that face, a mesh draws it
 * untextured); absent or `false` is a blank face drawn untextured (−1); a number is a texture index, a string a texture
 * uuid.
 */
export function readFaceTexture(
  face: JsonObject,
  path: string,
  context: Pick<ConverterContext, 'textureUvSizes' | 'textureIds'>,
): number | null {
  const value = field(face, 'texture');
  if (value === null) return null;
  if (value === undefined || value === false) return -1;
  const texturePath = childPath(path, 'texture');
  const count = context.textureUvSizes.length;
  if (typeof value === 'string') {
    const index = context.textureIds.get(value);
    if (index === undefined) {
      throw new BbmodelError('INVALID_FIELD', texturePath, `expected a texture uuid, got ${quoteValue(value)}`);
    }
    return index;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= count) {
    throw new BbmodelError(
      'INVALID_FIELD',
      texturePath,
      `expected a texture index below ${count}, a texture uuid, null or false, got ${quoteValue(value)}`,
    );
  }
  return value;
}

/** Whether faces with `material` (a texture index, −1 for none) show their back. */
export function faceDoubleSided(
  material: number,
  context: Pick<ConverterContext, 'textureDoubleSided' | 'untexturedDoubleSided'>,
): boolean {
  return material >= 0
    ? (context.textureDoubleSided[material] ?? context.untexturedDoubleSided)
    : context.untexturedDoubleSided;
}
