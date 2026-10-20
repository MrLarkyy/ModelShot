import {
  SCENE_FORMAT_VERSION,
  type SceneMaterial,
  type SceneMesh,
  type SceneMeshGroup,
  type SceneNode,
  type SceneTexture,
  type Vec3,
} from '@modelshot/scene';
import { BLEND_ALPHA_CUTOFF } from '../alpha/blendAlphaCutoff';
import { quoteValue } from '../text/quoteValue';
import { triangulateFace } from '../geometry/triangulateFace';
import { resolveUnitScale } from '../limits/resolveLimits';
import { encodeSolidPng } from '../png/encodeSolidPng';
import { readPngSize } from '../png/readPngSize';
import { ResourceFiles } from '../resources/ResourceFiles';
import { writeUntexturedUvs, writeUvRects } from '../uv/uvRects';
import { ObjError } from './ObjError';
import { DEFAULT_OBJ_UNIT_SCALE, resolveObjLimits, type ObjLimits, type ObjLoadOptions } from './ObjLoadOptions';
import type { ObjLoadResult } from './ObjLoadResult';
import { ObjWarningList } from './ObjWarning';
import { readObjText } from './objText';
import { parseMtl, type MtlMaterial } from './parseMtl';
import { parseObj, type ObjData, type ObjFace, type ObjObject } from './parseObj';

interface ConvertedMaterials {
  readonly materials: SceneMaterial[];
  readonly textures: SceneTexture[];
  /** Scene material per `usemtl` slot, −1 for an unknown name. */
  readonly bySlot: number[];
  /** Per scene material: it samples a `map_Kd` image (else a generated colour texture, UVs at the centre). */
  readonly textured: boolean[];
}

/**
 * Loads a Wavefront `.obj` with its `.mtl` libraries and PNG textures from the picked files: one node and mesh per
 * `o`/`g` object, one group per material, polygons of up to `maxFaceVertices` vertices (concave ones by ear clipping),
 * flat normals where a face has no `vn`. Synchronous and bounded; nothing is fetched. A bad file throws only
 * `ObjError`; whatever the scene format cannot carry is a warning. Invalid `options` throw a `RangeError`.
 */
export function loadObj(input: string | Uint8Array, options: ObjLoadOptions = {}): ObjLoadResult {
  const limits = resolveObjLimits(options.limits);
  const unitScale = resolveUnitScale(options.unitScale, DEFAULT_OBJ_UNIT_SCALE);
  const fileName = options.fileName ?? 'model.obj';
  const warnings = new ObjWarningList();
  const files = new ResourceFiles(options.files);
  const data = parseObj(readObjText(input, fileName, limits.maxFileBytes), fileName, limits, unitScale, warnings);

  const library = new Map<string, MtlMaterial>();
  const parsed = new Set<string>();
  for (const { name, path } of data.materialLibraries) {
    const found = files.resolve(name);
    if (!found.ok) {
      warnings.add(
        'MISSING_RESOURCE',
        path,
        `${missingDetail(name, found.reason, found.wanted)}; its materials are drawn plain`,
      );
      continue;
    }
    // Two names (`a.mtl`, `./a.mtl`) can resolve to one picked file: it is parsed once.
    if (parsed.has(found.fileName)) continue;
    parsed.add(found.fileName);
    parseMtl(readObjText(found.bytes, found.fileName, limits.maxFileBytes), found.fileName, limits, warnings, library);
  }
  const converted = convertMaterials(data, library, files, limits, warnings);

  const objects = data.objects.filter((object) => object.faces.length > 0);
  const built = buildMeshes(objects, data, converted, limits, unitScale);
  const nodes: SceneNode[] = objects.map((object, index) => ({
    name: object.name,
    sourceId: '',
    parent: -1,
    children: [],
    pivot: [0, 0, 0],
    rotation: [0, 0, 0],
    translation: [0, 0, 0],
    visible: true,
    meshes: [index],
  }));
  return {
    scene: {
      formatVersion: SCENE_FORMAT_VERSION,
      source: { format: 'obj', formatVersion: '', modelFormat: 'obj' },
      nodes,
      meshes: built,
      materials: converted.materials,
      textures: converted.textures,
      rootNodes: nodes.map((_, index) => index),
    },
    warnings: warnings.items,
  };
}

function missingDetail(name: string, reason: 'NOT_FETCHED' | 'NOT_PICKED', wanted: string): string {
  return reason === 'NOT_FETCHED'
    ? `${quoteValue(name)} is a URL and is not fetched`
    : `pick the file ${quoteValue(wanted)} together with the model`;
}

/**
 * Scene materials for the `usemtl` names, in order of first use. `map_Kd` or `d < 1`: `blend` with
 * `BLEND_ALPHA_CUTOFF`, else `opaque`. Without `map_Kd` the colour `Kd` and opacity `d` become a 1×1 PNG.
 */
function convertMaterials(
  data: ObjData,
  library: ReadonlyMap<string, MtlMaterial>,
  files: ResourceFiles,
  limits: ObjLimits,
  warnings: ObjWarningList,
): ConvertedMaterials {
  const result: ConvertedMaterials = { materials: [], textures: [], bySlot: [], textured: [] };
  const byKey = new Map<string, number>();
  let imageCount = 0;
  const texture = (key: string, make: () => SceneTexture, path: string): number => {
    const known = byKey.get(key);
    if (known !== undefined) return known;
    // Only picked images count: generated colour textures are bounded by the materials (one each), as in glTF.
    if (!key.startsWith('colour:') && imageCount++ >= limits.maxTextures) {
      throw new ObjError('TOO_MANY_TEXTURES', path, `more than ${limits.maxTextures} textures`);
    }
    result.textures.push(make());
    byKey.set(key, result.textures.length - 1);
    return result.textures.length - 1;
  };
  data.materialNames.forEach(({ name, path }) => {
    const material = library.get(name);
    if (!material) {
      warnings.add('UNKNOWN_MATERIAL', path, `${quoteValue(name)} is in no loaded .mtl; drawn plain`);
      result.bySlot.push(-1);
      return;
    }
    const textured = material.diffuseMap !== '';
    let index: number;
    if (textured) {
      const found = files.resolve(material.diffuseMap);
      const key = found.ok ? `file:${found.fileName}` : `missing:${material.diffuseMap}`;
      index = texture(key, () => readMapTexture(material, found, limits, warnings), material.path);
      if (material.diffuse.some((c) => c !== 1) || material.opacity < 1) {
        warnings.add(
          'BASE_COLOR_FACTOR_IGNORED',
          material.path,
          `Kd ${material.diffuse.join(' ')} / d ${material.opacity} of ${quoteValue(name)} beside map_Kd; the texture is drawn as is`,
        );
      }
    } else {
      const rgba = [...material.diffuse.map((c) => Math.round(c * 255)), Math.round(material.opacity * 255)] as const;
      const [r = 255, g = 255, b = 255, a = 255] = rgba;
      const hex = [r, g, b, a].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      index = texture(`colour:${hex}`, () => colourTexture(hex, [r, g, b, a]), material.path);
    }
    const blended = textured || material.opacity < 1;
    result.bySlot.push(result.materials.length);
    result.textured.push(textured);
    result.materials.push(
      blended
        ? { name, texture: index, alphaMode: 'blend', alphaCutoff: BLEND_ALPHA_CUTOFF }
        : { name, texture: index, alphaMode: 'opaque' },
    );
  });
  return result;
}

function colourTexture(hex: string, rgba: readonly [number, number, number, number]): SceneTexture {
  const bytes = encodeSolidPng(rgba);
  return {
    name: `colour #${hex}`,
    mimeType: 'image/png',
    bytes,
    width: 1,
    height: 1,
    uvWidth: 1,
    uvHeight: 1,
    missing: false,
  };
}

function readMapTexture(
  material: MtlMaterial,
  found: ReturnType<ResourceFiles['resolve']>,
  limits: ObjLimits,
  warnings: ObjWarningList,
): SceneTexture {
  const name = material.diffuseMap.slice(
    Math.max(material.diffuseMap.lastIndexOf('/'), material.diffuseMap.lastIndexOf('\\')) + 1,
  );
  const missing: SceneTexture = {
    name,
    mimeType: 'image/png',
    bytes: null,
    width: 0,
    height: 0,
    uvWidth: 1,
    uvHeight: 1,
    missing: true,
  };
  if (!found.ok) {
    warnings.add(
      'MISSING_RESOURCE',
      material.path,
      `map_Kd: ${missingDetail(material.diffuseMap, found.reason, found.wanted)}; drawn missing`,
    );
    return missing;
  }
  const size = readPngSize(found.bytes);
  if (!size.ok) {
    warnings.add(
      'UNSUPPORTED_IMAGE',
      material.path,
      `map_Kd ${quoteValue(name)} is not a PNG (${size.reason}); drawn missing`,
    );
    return missing;
  }
  if (
    size.width > limits.maxTextureSide ||
    size.height > limits.maxTextureSide ||
    size.width * size.height > limits.maxTexturePixels
  ) {
    throw new ObjError(
      'TEXTURE_TOO_LARGE',
      material.path,
      `map_Kd ${quoteValue(name)}: ${size.width}×${size.height} pixels, the limits are ${limits.maxTextureSide} per side and ${limits.maxTexturePixels} pixels`,
    );
  }
  return {
    name,
    mimeType: 'image/png',
    bytes: found.bytes,
    width: size.width,
    height: size.height,
    uvWidth: size.width,
    uvHeight: size.height,
    missing: false,
  };
}

/** A built vertex before allocation: source indices, and the face normal for corners without a usable `vn`. */
interface Corner {
  readonly v: number;
  readonly vt: number;
  readonly vn: number;
  readonly face: Vec3;
}

interface Run {
  readonly material: number;
  readonly corners: Corner[];
  readonly indices: number[];
  /** Vertex of each merged `v/vt/vn` corner. */
  readonly merged: Map<string, number>;
}

/**
 * One mesh per object: faces sorted (stably) into one run per scene material, corners with a `vn` merged per run by
 * `v/vt/vn`, corners without one kept per face with its flat normal. Vertices are counted against the limit before any
 * typed array is allocated.
 */
function buildMeshes(
  objects: readonly ObjObject[],
  data: ObjData,
  converted: ConvertedMaterials,
  limits: ObjLimits,
  unitScale: number,
): SceneMesh[] {
  let vertexTotal = 0;
  const planned = objects.map((object) => {
    const runs = new Map<number, Run>();
    const order = (material: number): number => (material < 0 ? Infinity : material);
    const faces = [...object.faces].sort(
      (a, b) => order(converted.bySlot[a.material] ?? -1) - order(converted.bySlot[b.material] ?? -1),
    );
    for (const face of faces) {
      const material = converted.bySlot[face.material] ?? -1;
      let run = runs.get(material);
      if (!run) {
        run = { material, corners: [], indices: [], merged: new Map() };
        runs.set(material, run);
      }
      const added = addFace(run, face, data);
      vertexTotal += added;
      if (vertexTotal > limits.maxVertices) {
        throw new ObjError('TOO_MANY_VERTICES', face.path, `more than ${limits.maxVertices} vertices`);
      }
    }
    return { object, runs: [...runs.values()] };
  });
  return planned.map(({ object, runs }, node) => fillMesh(object.name, node, runs, data, converted, unitScale));
}

/** Triangulates `face` into `run`; returns the number of vertices it added. */
function addFace(run: Run, face: ObjFace, data: ObjData): number {
  const count = face.corners.length / 3;
  const corner = (k: number, slot: number): number => face.corners[k * 3 + slot] ?? -1;
  const points = Array.from({ length: count }, (_, k): Vec3 => {
    const v = corner(k, 0);
    return [data.positions[v * 3] ?? 0, data.positions[v * 3 + 1] ?? 0, data.positions[v * 3 + 2] ?? 0];
  });
  const { normal, triangles } = triangulateFace(points, 'loop');
  if (triangles.length === 0) return 0;
  const shared = Array.from({ length: count }, (_, k) => corner(k, 2)).every((vn) => vn >= 0);
  const before = run.corners.length;
  const vertexOf = Array.from({ length: count }, (_, k) => {
    const v = corner(k, 0);
    const vt = corner(k, 1);
    const vn = corner(k, 2);
    const key = `${v}/${vt}/${vn}`;
    const known = shared ? run.merged.get(key) : undefined;
    if (known !== undefined) return known;
    run.corners.push({ v, vt, vn: shared ? vn : -1, face: normal });
    if (shared) run.merged.set(key, run.corners.length - 1);
    return run.corners.length - 1;
  });
  for (const k of triangles) run.indices.push(vertexOf[k] ?? 0);
  return run.corners.length - before;
}

function fillMesh(
  name: string,
  node: number,
  runs: readonly Run[],
  data: ObjData,
  converted: ConvertedMaterials,
  unitScale: number,
): SceneMesh {
  const vertexCount = runs.reduce((sum, run) => sum + run.corners.length, 0);
  const indexCount = runs.reduce((sum, run) => sum + run.indices.length, 0);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const uvRects = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(indexCount);
  const groups: SceneMeshGroup[] = [];
  let base = 0;
  let start = 0;
  for (const run of runs) {
    run.corners.forEach(({ v, vt, vn, face }, k) => {
      const at = base + k;
      positions.set(
        [0, 1, 2].map((axis) => (data.positions[v * 3 + axis] ?? 0) * unitScale),
        at * 3,
      );
      const given = vn >= 0 ? normalise([0, 1, 2].map((axis) => data.normals[vn * 3 + axis] ?? 0)) : null;
      normals.set(given ?? face, at * 3);
      if (vt >= 0) uvs.set([data.texcoords[vt * 2] ?? 0, data.texcoords[vt * 2 + 1] ?? 0], at * 2);
    });
    run.indices.forEach((index, k) => (indices[start + k] = base + index));
    const end = base + run.corners.length;
    if (run.material >= 0 && converted.textured[run.material]) {
      writeUvRects(uvs, indices, uvRects, { firstVertex: base, endVertex: end, start, count: run.indices.length });
    } else writeUntexturedUvs(uvs, uvRects, base, end);
    groups.push({ material: run.material, start, count: run.indices.length, doubleSided: true });
    base = end;
    start += run.indices.length;
  }
  return { name, sourceId: '', node, visible: true, positions, normals, uvs, uvRects, indices, groups };
}

function normalise(v: readonly number[]): Vec3 | null {
  const [x = 0, y = 0, z = 0] = v;
  const length = Math.hypot(x, y, z);
  return length > 1e-12 && Number.isFinite(length) ? [x / length, y / length, z / length] : null;
}
