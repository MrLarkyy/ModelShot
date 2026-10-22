import type { Vec3 } from '@modelshot/scene';
import { BbmodelError } from './BbmodelError';
import { FACE_DIRECTIONS, faceArea, type FaceDirection } from './CubeFace';
import type { ConverterContext } from './ElementConverter';
import { faceMaterial, readFaceTexture } from './FaceTexture';
import { boxUvLayout, toFaceRotation, type FaceRotation, type FaceUv } from './faceUv';
import { childPath, field, type JsonObject } from '../json/JsonObject';
import {
  readFiniteNumber,
  readNumbers,
  readObject,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readOptionalVec3,
  readVec3,
} from './JsonFields';
import { quoteValue } from '../text/quoteValue';
import { readRenderOrder } from './RenderOrder';

export interface CubeFaceSpec {
  readonly direction: FaceDirection;
  readonly uv: FaceUv;
  readonly rotation: FaceRotation;
  /** Material index, −1 for none. */
  readonly material: number;
  /** Texture whose frame count divides v; absent: `material`. */
  readonly frameTexture?: number;
  /** UV size the face's uv is expressed in. */
  readonly uvWidth: number;
  readonly uvHeight: number;
  /** Shows its back: the texture's render sides, except on a zero-thickness axis (see `readCube`). */
  readonly doubleSided: boolean;
  /** `SceneMeshGroup.cameraOnly`: a single-sided face of an inverted cube (see `readCube`); absent: false. */
  readonly cameraOnly?: boolean;
}

/** A validated cube: inflated box, rotation, and only the faces that produce triangles. */
export interface CubeSpec {
  readonly name: string;
  readonly sourceId: string;
  readonly visible: boolean;
  readonly min: Vec3;
  readonly max: Vec3;
  /** Axes whose signed extent is negative (see `inflatedBox`): the box is drawn mirrored about its centre on them. */
  readonly reversed: readonly [boolean, boolean, boolean];
  readonly origin: Vec3;
  readonly rotation: Vec3;
  /** `SceneMesh.renderOrder`. */
  readonly renderOrder: number;
  readonly faces: readonly CubeFaceSpec[];
}

const ZERO: Vec3 = [0, 0, 0];
const ONE: Vec3 = [1, 1, 1];
const NORMAL_AXIS: Readonly<Record<FaceDirection, 0 | 1 | 2>> = {
  east: 0,
  west: 0,
  up: 1,
  down: 1,
  north: 2,
  south: 2,
};

/**
 * An inverted cube (an odd number of reversed axes, see `inflatedBox`) draws its faces whose texture's `render_sides` is
 * `auto` single-sided in every format, so it shows as the rim of an outline hull; explicit `double` stays double-sided.
 * Blockbench sides `auto` by its Render Sides setting, double-sided by default outside `java_block`, where such a
 * hull's outer side would cover what it encloses; outline hulls are made to be seen with back faces culled. Every
 * single-sided face of an inverted cube is `cameraOnly`: Blockbench has no global illumination, so the hull is only a
 * rim the camera sees and must not shadow or occlude what it encloses; a double-sided one stays an ordinary box.
 *
 * A face lying in the plane of a zero-thickness axis whose opposite face is drawn too stays single-sided whatever its
 * texture says: the two are coincident, face opposite ways and have their own UVs, so each side shows exactly one of
 * them, with no depth fight. A lone face there (its opposite removed or absent) keeps its texture's sidedness, so a
 * single pane still shows from behind where its texture is double-sided, as in Blockbench.
 */
export function readCube(element: JsonObject, path: string, context: ConverterContext): CubeSpec {
  const from = readVec3(field(element, 'from'), childPath(path, 'from'));
  const to = readVec3(field(element, 'to'), childPath(path, 'to'));
  const inflate = readOptionalNumber(element, 'inflate', path, 0);
  const stretch = readOptionalVec3(element, 'stretch', path, ONE);
  const { min, max, reversed } = inflatedBox(from, to, inflate, stretch);
  const boxUv = readOptionalBoolean(element, 'box_uv', path, context.boxUv);
  const side = (axis: 0 | 1 | 2): number => boxSide(from[axis], to[axis], context.boxUvFloatSize);
  const boxSize: Vec3 = [side(0), side(1), side(2)];
  const layout = boxUv ? boxUvLayout(boxSize, uvOffset(element, path), mirrorUv(element, path, context)) : undefined;
  const facesPath = childPath(path, 'faces');
  const faces = readObject(field(element, 'faces'), facesPath);
  const specs: CubeFaceSpec[] = [];
  for (const direction of FACE_DIRECTIONS) {
    const face = readFace(faces, direction, childPath(facesPath, direction), context, layout?.[direction]);
    if (face && faceArea(direction, min, max) > 0) specs.push(face);
  }
  const flatFaces = specs.filter((face) => max[NORMAL_AXIS[face.direction]] - min[NORMAL_AXIS[face.direction]] <= 0);
  const paired = flatFaces.length === 2;
  const inverted = reversed.filter(Boolean).length % 2 === 1;
  const drawn = specs.map((face) => {
    const flatPair = paired && flatFaces.includes(face);
    const hullAuto = inverted && (context.textureSidesAuto[face.material] ?? true);
    const doubleSided = face.doubleSided && !flatPair && !hullAuto;
    if (inverted && !doubleSided) return { ...face, doubleSided, cameraOnly: true };
    return doubleSided === face.doubleSided ? face : { ...face, doubleSided };
  });
  return {
    name: readOptionalString(element, 'name', path, context.maxStringChars, 'cube'),
    sourceId: readOptionalString(element, 'uuid', path, context.maxStringChars, ''),
    visible: readOptionalBoolean(element, 'visibility', path, true),
    min,
    max,
    reversed,
    origin: readOptionalVec3(element, 'origin', path, ZERO),
    rotation: readOptionalVec3(element, 'rotation', path, ZERO),
    renderOrder: readRenderOrder(element, path, context.warnings),
    faces: drawn,
  };
}

/** `mirror_uv`, or in an old box-UV file (`ConverterContext.shadeMirrorsUv`) a `shade` of `false`. */
function mirrorUv(element: JsonObject, path: string, context: ConverterContext): boolean {
  if (readOptionalBoolean(element, 'mirror_uv', path, false)) return true;
  return context.shadeMirrorsUv === true && field(element, 'shade') === false;
}

export function cubeTriangleCount(cube: CubeSpec): number {
  return cube.faces.length * 2;
}

/**
 * Blockbench's geometry (cube.js `adjustFromAndToForInflateAndStretch`, then `setShape`, which is linear in the two
 * corners): per axis the signed extent e = ((to − from) / 2 + inflate) · stretch about the centre (from + to) / 2, the
 * box running from centre − e to centre + e. A negative e reverses that axis: from > to, a negative stretch or an
 * inflate below −half a side (a positive inflate shrinks a reversed axis and past zero turns it back). `min` and `max`
 * stay sorted and `reversed` marks the axis, which `cubeToMesh` mirrors the faces on. e = 0 is not reversed.
 */
function inflatedBox(
  from: Vec3,
  to: Vec3,
  inflate: number,
  stretch: Vec3,
): { min: Vec3; max: Vec3; reversed: [boolean, boolean, boolean] } {
  const x = inflatedAxis(from[0], to[0], inflate, stretch[0]);
  const y = inflatedAxis(from[1], to[1], inflate, stretch[1]);
  const z = inflatedAxis(from[2], to[2], inflate, stretch[2]);
  return {
    min: [x.centre - Math.abs(x.extent), y.centre - Math.abs(y.extent), z.centre - Math.abs(z.extent)],
    max: [x.centre + Math.abs(x.extent), y.centre + Math.abs(y.extent), z.centre + Math.abs(z.extent)],
    reversed: [x.extent < 0, y.extent < 0, z.extent < 0],
  };
}

function inflatedAxis(a: number, b: number, inflate: number, stretch: number): { centre: number; extent: number } {
  return { centre: (a + b) / 2, extent: ((b - a) / 2 + inflate) * stretch };
}

/**
 * Box-UV size of one axis from the un-inflated, un-stretched cube, as Blockbench's `size()`: floored to whole units
 * with a 1e-7 epsilon, except in formats with float box-UV sizes (`modded_entity`). Signed: where from > to it is
 * negative and `boxUvLayout` lays the faces out with it as Blockbench's `updateUV` does.
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
  const stored = readFaceTexture(face, path, context);
  if (stored === null) return undefined;
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
  const { material, texture, doubleSided } = faceMaterial(stored, context);
  const uvSize = texture >= 0 ? context.textureUvSizes[texture] : context.resolution;
  return {
    direction,
    uv,
    rotation,
    material,
    frameTexture: texture,
    uvWidth: uvSize?.width ?? context.resolution.width,
    uvHeight: uvSize?.height ?? context.resolution.height,
    doubleSided,
  };
}
