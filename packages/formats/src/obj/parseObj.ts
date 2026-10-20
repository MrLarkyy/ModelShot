import { quoteValue } from '../bbmodel/quoteValue';
import { ObjError } from './ObjError';
import type { ObjLimits } from './ObjLoadOptions';
import type { ObjWarningList } from './ObjWarning';
import { forEachStatement, type ObjStatement } from './objText';

/** One face: corner indices (0-based; −1 for an absent `vt` or `vn`), three per corner, and its material slot. */
export interface ObjFace {
  readonly corners: Int32Array;
  /** Index into `ObjData.materialNames`, −1 before any `usemtl`. */
  readonly material: number;
  readonly path: string;
}

export interface ObjObject {
  readonly name: string;
  readonly faces: ObjFace[];
}

export interface ObjData {
  /** 3 numbers per `v`. */
  readonly positions: number[];
  /** 2 numbers per `vt`: `u` and `1 − v` (OBJ's v grows upwards, the scene's downwards). */
  readonly texcoords: number[];
  /** 3 numbers per `vn`. */
  readonly normals: number[];
  readonly objects: ObjObject[];
  /** `usemtl` names in order of first use, with the statement that first used each. */
  readonly materialNames: { readonly name: string; readonly path: string }[];
  readonly materialLibraries: { readonly name: string; readonly path: string }[];
}

/** Statements of geometry kinds the loader does not draw (curves, surfaces, lines, points, render attributes). */
const KNOWN_UNSUPPORTED = new Set([
  'l',
  'p',
  'vp',
  'curv',
  'curv2',
  'surf',
  'cstype',
  'deg',
  'bmat',
  'step',
  'parm',
  'trim',
  'hole',
  'scrv',
  'sp',
  'end',
  'con',
  'mg',
  'bevel',
  'c_interp',
  'd_interp',
  'lod',
  'usemap',
  'maplib',
  'shadow_obj',
  'trace_obj',
  'ctech',
  'stech',
  'call',
  'csh',
]);

/**
 * Parses an OBJ file into indexed corners, objects and material runs. Every count is checked against `limits` as it
 * grows (vertices, objects, materials, face size, triangles), so a hostile file fails before the geometry is built.
 * Unsupported statements are counted per keyword and reported once each with their first line.
 */
export function parseObj(text: string, fileName: string, limits: ObjLimits, warnings: ObjWarningList): ObjData {
  const data: ObjData = {
    positions: [],
    texcoords: [],
    normals: [],
    objects: [],
    materialNames: [],
    materialLibraries: [],
  };
  const materialIndex = new Map<string, number>();
  const unsupported = new Map<string, { count: number; path: string }>();
  let current: ObjObject | null = null;
  let material = -1;
  let triangles = 0;
  let vertexColourPath = '';
  let smoothingPath = '';
  const baseName = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1);
  const defaultName = baseName.includes('.') ? baseName.slice(0, baseName.lastIndexOf('.')) : baseName;

  const startObject = (name: string, path: string): ObjObject => {
    if (data.objects.length >= limits.maxObjects) {
      throw new ObjError('TOO_MANY_OBJECTS', path, `more than ${limits.maxObjects} objects and groups`);
    }
    const object: ObjObject = { name, faces: [] };
    data.objects.push(object);
    return object;
  };

  forEachStatement(text, fileName, limits.maxLineChars, (statement) => {
    const { keyword, args, path } = statement;
    switch (keyword) {
      case 'v': {
        if (args.length < 3) throw invalid(statement, 'expected x y z');
        if (args.length >= 6 && vertexColourPath === '') vertexColourPath = path;
        pushNumbers(data.positions, args.slice(0, 3), path, limits.maxVertices * 3, 'v');
        return;
      }
      case 'vt': {
        if (args.length < 1) throw invalid(statement, 'expected u [v]');
        const [u = 0, v = 0] = [readNumber(args[0], path), args.length > 1 ? readNumber(args[1], path) : 0];
        if (data.texcoords.length + 2 > limits.maxVertices * 2) throw tooMany('vt', path, limits.maxVertices);
        data.texcoords.push(u, 1 - v);
        return;
      }
      case 'vn': {
        if (args.length < 3) throw invalid(statement, 'expected x y z');
        pushNumbers(data.normals, args.slice(0, 3), path, limits.maxVertices * 3, 'vn');
        return;
      }
      case 'f': {
        if (args.length < 3) throw invalid(statement, `a face needs 3 or more vertices, got ${args.length}`);
        if (args.length > limits.maxFaceVertices) {
          throw new ObjError(
            'TOO_MANY_FACE_VERTICES',
            path,
            `${args.length} vertices, the limit is ${limits.maxFaceVertices}`,
          );
        }
        triangles += args.length - 2;
        if (triangles > limits.maxTriangles) {
          throw new ObjError('TOO_MANY_TRIANGLES', path, `more than ${limits.maxTriangles} triangles`);
        }
        const corners = new Int32Array(args.length * 3);
        args.forEach((token, k) => corners.set(readCorner(token, path, data), k * 3));
        current ??= startObject(defaultName, path);
        current.faces.push({ corners, material, path });
        return;
      }
      case 'o':
      case 'g':
        current = startObject(
          statement.rest(0).slice(0, limits.maxStringChars) || `${keyword} ${data.objects.length}`,
          path,
        );
        return;
      case 'usemtl': {
        const name = statement.rest(0).slice(0, limits.maxStringChars);
        let index = materialIndex.get(name);
        if (index === undefined) {
          if (data.materialNames.length >= limits.maxMaterials) {
            throw new ObjError('TOO_MANY_MATERIALS', path, `more than ${limits.maxMaterials} materials`);
          }
          index = data.materialNames.length;
          data.materialNames.push({ name, path });
          materialIndex.set(name, index);
        }
        material = index;
        return;
      }
      case 'mtllib':
        if (args.length > 0)
          data.materialLibraries.push({ name: statement.rest(0).slice(0, limits.maxStringChars), path });
        return;
      case 's':
        if (smoothingPath === '' && args[0] !== 'off' && args[0] !== '0') smoothingPath = path;
        return;
      default: {
        const key = KNOWN_UNSUPPORTED.has(keyword) ? keyword : keyword.slice(0, 32);
        const seen = unsupported.get(key);
        if (seen) seen.count++;
        else unsupported.set(key, { count: 1, path });
      }
    }
  });

  if (vertexColourPath !== '') {
    warnings.add('UNSUPPORTED_VERTEX_COLOR', vertexColourPath, 'v with colour components; colours are not drawn');
  }
  if (smoothingPath !== '' && data.normals.length === 0) {
    warnings.add('SMOOTHING_IGNORED', smoothingPath, 'the file has no vn normals; faces are drawn flat');
  }
  for (const [keyword, { count, path }] of unsupported) {
    warnings.add(
      'UNSUPPORTED_STATEMENT',
      path,
      `${quoteValue(keyword)} (${count} line${count === 1 ? '' : 's'}) is not drawn`,
    );
  }
  return data;
}

function invalid(statement: ObjStatement, detail: string): ObjError {
  return new ObjError('INVALID_STATEMENT', statement.path, `${quoteValue(statement.keyword)}: ${detail}`);
}

function tooMany(kind: string, path: string, max: number): ObjError {
  return new ObjError('TOO_MANY_VERTICES', path, `more than ${max} ${kind} statements`);
}

function readNumber(token: string | undefined, path: string): number {
  const value = Number(token);
  if (token === undefined || token === '' || !Number.isFinite(value)) {
    throw new ObjError('NON_FINITE_DATA', path, `expected a finite number, got ${quoteValue(token)}`);
  }
  return value;
}

function pushNumbers(target: number[], tokens: readonly string[], path: string, max: number, kind: string): void {
  if (target.length + tokens.length > max) throw tooMany(kind, path, max / 3);
  for (const token of tokens) target.push(readNumber(token, path));
}

/** `v`, `v/vt`, `v//vn` or `v/vt/vn`; 1-based, negative counts back from the latest; 0 or beyond is an error. */
function readCorner(token: string, path: string, data: ObjData): [number, number, number] {
  const parts = token.split('/');
  if (parts.length > 3 || parts[0] === '') {
    throw new ObjError('INVALID_STATEMENT', path, `expected v, v/vt, v//vn or v/vt/vn, got ${quoteValue(token)}`);
  }
  const resolve = (part: string | undefined, count: number, what: string): number => {
    if (part === undefined || part === '') return -1;
    if (!/^-?\d{1,10}$/.test(part)) {
      throw new ObjError('INVALID_STATEMENT', path, `expected an integer ${what} index, got ${quoteValue(part)}`);
    }
    const raw = Number(part);
    const index = raw > 0 ? raw - 1 : count + raw;
    if (raw === 0 || index < 0 || index >= count) {
      throw new ObjError('INDEX_OUT_OF_RANGE', path, `${what} index ${raw}, ${count} defined so far`);
    }
    return index;
  };
  return [
    resolve(parts[0], data.positions.length / 3, 'v'),
    resolve(parts[1], data.texcoords.length / 2, 'vt'),
    resolve(parts[2], data.normals.length / 3, 'vn'),
  ];
}
