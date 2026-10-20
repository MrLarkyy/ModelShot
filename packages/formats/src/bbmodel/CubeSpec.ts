import type { Vec3 } from '@modelshot/scene';
import { BbmodelError } from './BbmodelError';
import { FACE_DIRECTIONS, faceArea, type FaceDirection } from './CubeFace';
import type { ConverterContext } from './ElementConverter';
import { boxUvLayout, toFaceRotation, type FaceRotation, type FaceUv } from './faceUv';
import {
  childPath,
  field,
  readFiniteNumber,
  readNumbers,
  readObject,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readOptionalVec3,
  readVec3,
  type JsonObject,
} from './JsonFields';
import { quoteValue } from './quoteValue';

export interface CubeFaceSpec {
  readonly direction: FaceDirection;
  readonly uv: FaceUv;
  readonly rotation: FaceRotation;
  /** Texture index, −1 for none. */
  readonly material: number;
  /** UV size the face's uv is expressed in. */
  readonly uvWidth: number;
  readonly uvHeight: number;
}

/** A validated cube: inflated box, rotation, and only the faces that produce triangles. */
export interface CubeSpec {
  readonly name: string;
  readonly sourceId: string;
  readonly visible: boolean;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly origin: Vec3;
  readonly rotation: Vec3;
  readonly faces: readonly CubeFaceSpec[];
}

const ZERO: Vec3 = [0, 0, 0];
const ONE: Vec3 = [1, 1, 1];

export function readCube(element: JsonObject, path: string, context: ConverterContext): CubeSpec {
  const from = readVec3(field(element, 'from'), childPath(path, 'from'));
  const to = readVec3(field(element, 'to'), childPath(path, 'to'));
  const inflate = readOptionalNumber(element, 'inflate', path, 0);
  const stretch = readOptionalVec3(element, 'stretch', path, ONE);
  const [min, max] = inflatedBox(from, to, inflate, stretch);
  const boxUv = readOptionalBoolean(element, 'box_uv', path, context.boxUv);
  const side = (axis: 0 | 1 | 2): number => boxSide(from[axis], to[axis], context.boxUvFloatSize);
  const boxSize: Vec3 = [side(0), side(1), side(2)];
  const layout = boxUv
    ? boxUvLayout(boxSize, uvOffset(element, path), readOptionalBoolean(element, 'mirror_uv', path, false))
    : undefined;
  const facesPath = childPath(path, 'faces');
  const faces = readObject(field(element, 'faces'), facesPath);
  const specs: CubeFaceSpec[] = [];
  for (const direction of FACE_DIRECTIONS) {
    const face = readFace(faces, direction, childPath(facesPath, direction), context, layout?.[direction]);
    if (face && faceArea(direction, min, max) > 0) specs.push(face);
  }
  return {
    name: readOptionalString(element, 'name', path, context.maxStringChars, 'cube'),
    sourceId: readOptionalString(element, 'uuid', path, context.maxStringChars, ''),
    visible: readOptionalBoolean(element, 'visibility', path, true),
    min,
    max,
    origin: readOptionalVec3(element, 'origin', path, ZERO),
    rotation: readOptionalVec3(element, 'rotation', path, ZERO),
    faces: specs,
  };
}

export function cubeTriangleCount(cube: CubeSpec): number {
  return cube.faces.length * 2;
}

/**
 * Blockbench's geometry: `centre ∓ (half + inflate) · stretch` per axis. A negative inflate larger than half a side
 * collapses that axis to its centre instead of turning the box inside out; a negative stretch counts as its magnitude
 * (the box is the same, only Blockbench's winding would differ).
 */
function inflatedBox(from: Vec3, to: Vec3, inflate: number, stretch: Vec3): [Vec3, Vec3] {
  const [x0, x1] = inflatedAxis(from[0], to[0], inflate, stretch[0]);
  const [y0, y1] = inflatedAxis(from[1], to[1], inflate, stretch[1]);
  const [z0, z1] = inflatedAxis(from[2], to[2], inflate, stretch[2]);
  return [
    [x0, y0, z0],
    [x1, y1, z1],
  ];
}

function inflatedAxis(a: number, b: number, inflate: number, stretch: number): [number, number] {
  const centre = (a + b) / 2;
  const extent = Math.max(0, Math.abs(b - a) / 2 + inflate) * Math.abs(stretch);
  return [centre - extent, centre + extent];
}

/**
 * Box-UV size of one axis from the un-inflated, un-stretched cube, as Blockbench's `size()`: floored to whole units
 * with a 1e-7 epsilon, except in formats with float box-UV sizes (`modded_entity`).
 */
function boxSide(from: number, to: number, floatSize: boolean): number {
  return floatSize ? to - from : Math.floor(to - from + 1e-7);
}

function uvOffset(element: JsonObject, path: string): [number, number] {
  const value = field(element, 'uv_offset');
  if (value === undefined) return [0, 0];
  const [u = 0, v = 0] = readNumbers(value, childPath(path, 'uv_offset'), 2);
  return [u, v];
}

/** `undefined` when the face is absent from the file or removed (`texture: null`). */
function readFace(
  faces: JsonObject,
  direction: FaceDirection,
  path: string,
  context: ConverterContext,
  boxUv: FaceUv | undefined,
): CubeFaceSpec | undefined {
  const value = field(faces, direction);
  if (value === undefined) return undefined;
  const face = readObject(value, path);
  const material = readFaceTexture(face, path, context);
  if (material === null) return undefined;
  const uvValue = field(face, 'uv');
  let uv: FaceUv;
  if (uvValue === undefined && boxUv) uv = boxUv;
  else {
    const [u1 = 0, v1 = 0, u2 = 0, v2 = 0] = readNumbers(uvValue, childPath(path, 'uv'), 4);
    uv = [u1, v1, u2, v2];
  }
  const rotationValue = field(face, 'rotation');
  const rotationPath = childPath(path, 'rotation');
  const rotation = rotationValue === undefined ? 0 : toFaceRotation(readFiniteNumber(rotationValue, rotationPath));
  if (rotation === undefined) {
    throw new BbmodelError(
      'INVALID_FIELD',
      rotationPath,
      `expected 0, 90, 180 or 270, got ${quoteValue(rotationValue)}`,
    );
  }
  const uvSize = material >= 0 ? context.textureUvSizes[material] : context.resolution;
  return {
    direction,
    uv,
    rotation,
    material,
    uvWidth: uvSize?.width ?? context.resolution.width,
    uvHeight: uvSize?.height ?? context.resolution.height,
  };
}

/**
 * Blockbench's face texture: `null` removes the face (`null` is returned); absent or `false` is a blank face drawn
 * untextured (−1); a number is a texture index, a string a texture uuid.
 */
function readFaceTexture(face: JsonObject, path: string, context: ConverterContext): number | null {
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
