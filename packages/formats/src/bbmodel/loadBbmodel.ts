import { SCENE_FORMAT_VERSION, type SceneMesh, type SceneNode } from '@modelshot/scene';
import { BbmodelError } from './BbmodelError';
import { resolveBbmodelLimits, type BbmodelLimits, type BbmodelLoadOptions } from './BbmodelLoadOptions';
import type { BbmodelLoadResult } from './BbmodelLoadResult';
import { BbmodelWarningList } from './BbmodelWarning';
import { buildHierarchy, type ElementPlacement } from './buildHierarchy';
import type { ConverterContext, PreparedElement } from './ElementConverter';
import { ELEMENT_CONVERTERS } from './elementConverters';
import {
  childPath,
  field,
  isJsonObject,
  readArray,
  readObject,
  readOptionalBoolean,
  readOptionalString,
  readPositiveNumber,
  readString,
  type JsonObject,
} from './JsonFields';
import { readTextureEntries, resolveTextures, type UvSize } from './parseTextures';
import { quoteValue } from './quoteValue';
import { readJson } from './readJson';

const SUPPORTED_MAJOR_VERSIONS = [3, 4, 5];
const DEFAULT_RESOLUTION: UvSize = { width: 16, height: 16 };

interface PlacedElement {
  readonly prepared: PreparedElement;
  readonly node: number;
}

/**
 * Loads a Blockbench `.bbmodel` (format 3.x–5.x): cubes, groups and PNG textures. Synchronous and bounded: every
 * count, size and depth is checked against `limits` before anything proportional to it is allocated or decoded, and
 * the result does not depend on the clock or randomness. Throws only `BbmodelError`; recoverable problems are warnings.
 */
export function loadBbmodel(input: string | Uint8Array, options: BbmodelLoadOptions = {}): BbmodelLoadResult {
  const limits = resolveBbmodelLimits(options.limits);
  const warnings = new BbmodelWarningList();
  const root = readJson(input, limits.maxFileBytes);
  if (!isJsonObject(root)) throw new BbmodelError('NOT_BBMODEL', '$', `expected an object, got ${quoteValue(root)}`);
  const meta = field(root, 'meta');
  if (!isJsonObject(meta))
    throw new BbmodelError('NOT_BBMODEL', '$.meta', `expected an object, got ${quoteValue(meta)}`);
  const formatVersion = readFormatVersion(meta);
  const modelFormat = readOptionalString(meta, 'model_format', '$.meta', limits.maxStringChars, 'unknown');

  const elementsValue = field(root, 'elements');
  const elements =
    elementsValue === undefined
      ? []
      : readArray(elementsValue, '$.elements', {
          max: limits.maxElements,
          code: 'TOO_MANY_ELEMENTS',
          what: 'elements',
        });
  const resolution = readResolution(root);
  const textureEntries = readTextureEntries(root, resolution, limits);
  const elementObjects = elements.map((item, index) => readObject(item, childPath('$.elements', index)));
  const hierarchy = buildHierarchy(root, elementIds(elementObjects, limits), elements.length, limits, warnings);

  const context: ConverterContext = {
    textureUvSizes: textureEntries.map((entry) => ({ width: entry.uvWidth, height: entry.uvHeight })),
    resolution,
    boxUv: readOptionalBoolean(meta, 'box_uv', '$.meta', false),
    maxStringChars: limits.maxStringChars,
  };
  const placed = prepareElements(elementObjects, hierarchy.placements, context, limits, warnings);

  // Every limit has passed; only now are texture bytes decoded and geometry buffers allocated.
  const textures = resolveTextures(textureEntries, options.textureFiles, limits, warnings);
  const nodeMeshes = hierarchy.nodes.map((): number[] => []);
  const meshes: SceneMesh[] = placed.map(({ prepared, node }, index) => {
    nodeMeshes[node]?.push(index);
    return prepared.build(node);
  });
  const nodes: SceneNode[] = hierarchy.nodes.map((node, index) => ({
    ...node,
    translation: [0, 0, 0],
    meshes: nodeMeshes[index] ?? [],
  }));

  return {
    scene: {
      formatVersion: SCENE_FORMAT_VERSION,
      source: { format: 'bbmodel', formatVersion, modelFormat },
      nodes,
      meshes,
      materials: textures.map((texture, index) => ({ name: texture.name, texture: index })),
      textures,
      rootNodes: hierarchy.rootNodes,
    },
    warnings: warnings.items,
  };
}

function readFormatVersion(meta: JsonObject): string {
  const value = field(meta, 'format_version');
  const path = '$.meta.format_version';
  if (value === undefined) throw new BbmodelError('NOT_BBMODEL', path, 'expected a format version');
  const version = typeof value === 'number' ? String(value) : readString(value, path, 32);
  const major = /^(\d{1,4})(\.\d{1,4}){0,3}$/.exec(version)?.[1];
  if (major === undefined || !SUPPORTED_MAJOR_VERSIONS.includes(Number(major))) {
    throw new BbmodelError('UNSUPPORTED_VERSION', path, `expected 3.x to 5.x, got ${quoteValue(value)}`);
  }
  return version;
}

function readResolution(root: JsonObject): UvSize {
  const value = field(root, 'resolution');
  if (value === undefined) return DEFAULT_RESOLUTION;
  const resolution = readObject(value, '$.resolution');
  const width = field(resolution, 'width');
  const height = field(resolution, 'height');
  return {
    width: width === undefined ? DEFAULT_RESOLUTION.width : readPositiveNumber(width, '$.resolution.width'),
    height: height === undefined ? DEFAULT_RESOLUTION.height : readPositiveNumber(height, '$.resolution.height'),
  };
}

function elementIds(elements: readonly JsonObject[], limits: BbmodelLimits): Map<string, number> {
  const ids = new Map<string, number>();
  elements.forEach((element, index) => {
    const path = childPath('$.elements', index);
    const uuid = readOptionalString(element, 'uuid', path, limits.maxStringChars, '');
    if (uuid === '') return;
    if (ids.has(uuid)) {
      throw new BbmodelError('DUPLICATE_REFERENCE', childPath(path, 'uuid'), `uuid ${quoteValue(uuid)} appears twice`);
    }
    ids.set(uuid, index);
  });
  return ids;
}

/** Validates every placed element and counts its triangles against the limit; allocates no geometry. */
function prepareElements(
  elements: readonly JsonObject[],
  placements: readonly ElementPlacement[],
  context: ConverterContext,
  limits: BbmodelLimits,
  warnings: BbmodelWarningList,
): PlacedElement[] {
  const placed: PlacedElement[] = [];
  let triangles = 0;
  for (const { element: index, node } of placements) {
    const element = elements[index];
    if (!element) continue;
    const path = childPath('$.elements', index);
    const type = readOptionalString(element, 'type', path, limits.maxStringChars, 'cube');
    const converter = ELEMENT_CONVERTERS.get(type);
    if (!converter) {
      warnings.add('UNSUPPORTED_ELEMENT', path, `type ${quoteValue(type)} is not supported yet`);
      continue;
    }
    const prepared = converter.prepare(element, path, context);
    triangles += prepared.triangleCount;
    if (triangles > limits.maxTriangles) {
      throw new BbmodelError('TOO_MANY_TRIANGLES', path, `more than ${limits.maxTriangles} triangles`);
    }
    placed.push({ prepared, node });
  }
  return placed;
}
