import type { Vec3 } from '@modelshot/scene';
import { BbmodelError } from './BbmodelError';
import type { ConverterContext } from './ElementConverter';
import { faceDoubleSided, readFaceTexture } from './FaceTexture';
import { childPath, field, type JsonObject } from '../json/JsonObject';
import {
  readArray,
  readNumbers,
  readObject,
  readOptionalBoolean,
  readOptionalString,
  readOptionalVec3,
  readVec3,
} from './JsonFields';
import { quoteValue } from '../text/quoteValue';
import { readRenderOrder } from './RenderOrder';

/** One drawable face (3 or more vertices) of a mesh element. */
export interface MeshFaceSpec {
  /** Vertex keys, in the order the file lists them. */
  readonly keys: readonly string[];
  /** Positions relative to the mesh `origin`, one per key. */
  readonly positions: readonly Vec3[];
  /** UV of each position, in uv units of `uvWidth` × `uvHeight`. */
  readonly uvs: readonly (readonly [number, number])[];
  /** Texture index, −1 for none. */
  readonly material: number;
  readonly doubleSided: boolean;
  readonly uvWidth: number;
  readonly uvHeight: number;
}

/** A validated Blockbench mesh: transform and the faces that can produce triangles. */
export interface MeshSpec {
  readonly name: string;
  readonly sourceId: string;
  readonly visible: boolean;
  readonly origin: Vec3;
  readonly rotation: Vec3;
  readonly renderOrder: number;
  /** Blockbench `shading`: `flat` gives every face its own normal, `smooth` averages them per vertex key. */
  readonly shading: MeshShading;
  readonly faces: readonly MeshFaceSpec[];
}

export type MeshShading = 'flat' | 'smooth';

const ZERO: Vec3 = [0, 0, 0];

/**
 * Reads a `mesh` element: `vertices` maps a key to a position relative to `origin`; each face lists vertex keys and a
 * uv per key. The vertex count is checked before any lookup table is built, and the running count of face vertices
 * (each face gets its own) before the next face is read. Keys are looked up in a `Map` or as own properties, so
 * `__proto__` is just a key. Faces with fewer than 3 vertices are validated and dropped, as Blockbench draws nothing.
 */
export function readMesh(element: JsonObject, path: string, context: ConverterContext): MeshSpec {
  const vertices = readVertices(element, path, context);
  const facesPath = childPath(path, 'faces');
  const facesObject = readObject(field(element, 'faces'), facesPath);
  const faces: MeshFaceSpec[] = [];
  let faceVertices = 0;
  for (const key of Object.keys(facesObject)) {
    checkKey(key, facesPath, 'face', context);
    const facePath = childPath(facesPath, key);
    const face = readFace(field(facesObject, key), facePath, vertices, context);
    if (!face) continue;
    faceVertices += face.positions.length;
    if (faceVertices > context.maxVertices) {
      throw new BbmodelError('TOO_MANY_VERTICES', facePath, `more than ${context.maxVertices} face vertices`);
    }
    faces.push(face);
  }
  return {
    name: readOptionalString(element, 'name', path, context.maxStringChars, 'mesh'),
    sourceId: readOptionalString(element, 'uuid', path, context.maxStringChars, ''),
    visible: readOptionalBoolean(element, 'visibility', path, true),
    origin: readOptionalVec3(element, 'origin', path, ZERO),
    rotation: readOptionalVec3(element, 'rotation', path, ZERO),
    renderOrder: readRenderOrder(element, path, context.warnings),
    shading: readShading(element, path, context),
    faces,
  };
}

/** Upper bound of the triangles: k − 2 for a face of k vertices (a degenerate face yields fewer). */
export function meshTriangleCount(mesh: MeshSpec): number {
  return mesh.faces.reduce((sum, face) => sum + face.positions.length - 2, 0);
}

/** Upper bound of the vertices: every face has its own. */
export function meshVertexCount(mesh: MeshSpec): number {
  return mesh.faces.reduce((sum, face) => sum + face.positions.length, 0);
}

/** Absent: `flat`; an unknown string warns and counts as `flat`; anything else is `INVALID_FIELD`. */
function readShading(element: JsonObject, path: string, context: ConverterContext): MeshShading {
  const value = field(element, 'shading');
  if (value === undefined) return 'flat';
  const valuePath = childPath(path, 'shading');
  if (typeof value !== 'string') {
    throw new BbmodelError('INVALID_FIELD', valuePath, `expected flat or smooth, got ${quoteValue(value)}`);
  }
  if (value === 'flat' || value === 'smooth') return value;
  context.warnings.add('UNSUPPORTED_VALUE', valuePath, `${quoteValue(value)} is not flat or smooth; using flat`);
  return 'flat';
}

function readVertices(element: JsonObject, path: string, context: ConverterContext): Map<string, Vec3> {
  const verticesPath = childPath(path, 'vertices');
  const object = readObject(field(element, 'vertices'), verticesPath);
  const keys = Object.keys(object);
  if (keys.length > context.maxVertices) {
    throw new BbmodelError(
      'TOO_MANY_VERTICES',
      verticesPath,
      `${keys.length} vertices, the limit is ${context.maxVertices}`,
    );
  }
  const vertices = new Map<string, Vec3>();
  for (const key of keys) {
    checkKey(key, verticesPath, 'vertex', context);
    vertices.set(key, readVec3(field(object, key), childPath(verticesPath, key)));
  }
  return vertices;
}

function checkKey(key: string, parentPath: string, what: string, context: ConverterContext): void {
  if (key.length > context.maxStringChars) {
    throw new BbmodelError(
      'INVALID_FIELD',
      parentPath,
      `expected ${what} keys of at most ${context.maxStringChars} characters, got ${quoteValue(key)}`,
    );
  }
}

function readFace(
  value: unknown,
  path: string,
  vertices: ReadonlyMap<string, Vec3>,
  context: ConverterContext,
): MeshFaceSpec | undefined {
  const face = readObject(value, path);
  const refsPath = childPath(path, 'vertices');
  const refs = readArray(field(face, 'vertices'), refsPath, {
    max: context.maxFaceVertices,
    code: 'TOO_MANY_VERTICES',
    what: 'vertices in one face',
  });
  const seen = new Set<string>();
  const keys = refs.map((ref, j) => {
    const refPath = childPath(refsPath, j);
    if (typeof ref !== 'string' || !vertices.has(ref)) {
      throw new BbmodelError(
        'INVALID_FIELD',
        refPath,
        `expected a key of this mesh's vertices, got ${quoteValue(ref)}`,
      );
    }
    if (seen.has(ref)) {
      throw new BbmodelError('INVALID_FIELD', refPath, `vertex ${quoteValue(ref)} appears twice in this face`);
    }
    seen.add(ref);
    return ref;
  });
  // A mesh face with `texture: null` is still drawn, untextured (Blockbench's mesh updateFaces); a cube drops it.
  const material = readFaceTexture(face, path, context) ?? -1;
  if (keys.length < 3) return undefined;
  const uvPath = childPath(path, 'uv');
  const uvObject = readObject(field(face, 'uv'), uvPath);
  const uvs = keys.map((key): [number, number] => {
    const [u = 0, v = 0] = readNumbers(field(uvObject, key), childPath(uvPath, key), 2);
    return [u, v];
  });
  const uvSize = material >= 0 ? context.textureUvSizes[material] : context.resolution;
  return {
    keys,
    positions: keys.map((key) => vertices.get(key) ?? ZERO),
    uvs,
    material,
    doubleSided: faceDoubleSided(material, context),
    uvWidth: uvSize?.width ?? context.resolution.width,
    uvHeight: uvSize?.height ?? context.resolution.height,
  };
}
