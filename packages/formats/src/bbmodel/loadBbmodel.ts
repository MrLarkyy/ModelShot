import { effectiveModelFormat } from './effectiveModelFormat';
import { SCENE_FORMAT_VERSION, type SceneMesh, type SceneNode } from '@modelshot/scene';
import { BbmodelError } from './BbmodelError';
import { resolveBbmodelLimits, type BbmodelLimits, type BbmodelLoadOptions } from './BbmodelLoadOptions';
import type { BbmodelLoadResult } from './BbmodelLoadResult';
import { bbmodelMaterials, layeredStack } from './bbmodelMaterials';
import { BbmodelWarningList } from './BbmodelWarning';
import { buildHierarchy, type ElementPlacement, type GroupTexture } from './buildHierarchy';
import type { ConverterContext, PreparedElement } from './ElementConverter';
import { ELEMENT_CONVERTERS } from './elementConverters';
import { formatVersionBefore } from './formatVersionBefore';
import { childPath, field, isJsonObject, type JsonObject } from '../json/JsonObject';
import {
  readArray,
  readObject,
  readOptionalBoolean,
  readOptionalString,
  readPositiveNumber,
  readString,
} from './JsonFields';
import { parseAnimations } from './parseAnimations';
import { readTextureEntries, resolveTextures, textureIdIndex, type UvSize } from './parseTextures';
import { quoteValue } from '../text/quoteValue';
import { readJson } from './readJson';
import { formatDoubleSided, isDoubleSided } from './RenderSides';
import { defaultTexture, formatPerGroupTexture, formatPerTextureUvSize, formatTextureRule } from './TextureRule';

const SUPPORTED_MAJOR_VERSIONS = [3, 4, 5];
const DEFAULT_RESOLUTION: UvSize = { width: 16, height: 16 };

interface PlacedElement {
  readonly prepared: PreparedElement;
  readonly node: number;
}

/**
 * Loads a Blockbench `.bbmodel` (format 3.x–5.x): cubes, meshes, groups, PNG textures and bone animations. Synchronous and bounded: every
 * count, size and depth is checked against `limits` before anything proportional to it is allocated or decoded, and
 * the result does not depend on the clock or randomness. A bad file throws only `BbmodelError`; recoverable problems
 * are warnings. Invalid `options.limits` throw a `RangeError`.
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
  // Blockbench tests `!model_format`, so null, false and 0 are as good as absent.
  const declaredFormat = field(meta, 'model_format')
    ? readOptionalString(meta, 'model_format', '$.meta', limits.maxStringChars, '')
    : '';
  const modelFormat = effectiveModelFormat(meta, declaredFormat);

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
  const textureEntries = readTextureEntries(
    root,
    resolution,
    formatPerTextureUvSize(modelFormat),
    modelFormat,
    limits,
    warnings,
  );
  const formatDefaultSides = formatDoubleSided(modelFormat);
  const elementObjects = elements.map((item, index) => readObject(item, childPath('$.elements', index)));
  // Before 3.2 Blockbench stored group z rotations with the opposite sign and negates them on import.
  const invertGroupZ = formatVersionBefore(formatVersion, '3.2');
  const perGroupTexture = formatPerGroupTexture(modelFormat);
  const hierarchy = buildHierarchy(root, elementIds(elementObjects, limits), elements.length, limits, warnings, {
    invertGroupZ,
    readGroupTextures: perGroupTexture,
  });
  const boxUv = readOptionalBoolean(meta, 'box_uv', '$.meta', false);

  const textureIds = textureIdIndex(textureEntries);
  const textureRule = formatTextureRule(modelFormat);
  const stack = layeredStack(textureEntries, modelFormat);
  const context: ConverterContext = {
    textureUvSizes: textureEntries.map((entry) => ({ width: entry.uvWidth, height: entry.uvHeight })),
    resolution,
    textureIds,
    textureDoubleSided: textureEntries.map((entry) => isDoubleSided(entry.renderSides, formatDefaultSides)),
    untexturedDoubleSided: formatDefaultSides,
    textureRule,
    perGroupTexture,
    defaultTexture: defaultTexture(textureRule, textureEntries),
    // The composite follows the texture materials, so material i stays texture i.
    ...(stack ? { layeredMaterial: textureEntries.length } : {}),
    boxUv,
    // Before 4.5 a box-UV project kept "mirror UV" in the cube's `shade` flag; Blockbench reads `shade: false` as
    // mirrored on import.
    shadeMirrorsUv: boxUv && formatVersionBefore(formatVersion, '4.5'),
    boxUvFloatSize: modelFormat === 'modded_entity',
    maxStringChars: limits.maxStringChars,
    maxVertices: limits.maxVertices,
    maxFaceVertices: limits.maxFaceVertices,
    warnings,
  };
  const nodeTextures = hierarchy.groupTextures.map((texture) => groupTextureIndex(texture, textureIds, warnings));
  const placed = prepareElements(elementObjects, hierarchy.placements, nodeTextures, context, limits, warnings);
  const animations = parseAnimations(root, hierarchy.nodes, { formatVersion, modelFormat }, limits, warnings);

  // Every limit has passed; only now are texture bytes decoded and geometry buffers allocated.
  const textures = resolveTextures(textureEntries, options.textureFiles, limits, warnings);
  const textureFrameCounts = textures.map((texture) => texture.frames?.count ?? 1);
  const nodeMeshes = hierarchy.nodes.map((): number[] => []);
  const meshes: SceneMesh[] = placed.map(({ prepared, node }, index) => {
    nodeMeshes[node]?.push(index);
    return prepared.build(node, textureFrameCounts);
  });
  const nodes: SceneNode[] = hierarchy.nodes.map((node, index) => ({
    ...node,
    translation: [0, 0, 0],
    meshes: nodeMeshes[index] ?? [],
  }));

  return {
    scene: {
      formatVersion: SCENE_FORMAT_VERSION,
      source: { format: 'bbmodel', formatVersion, modelFormat: declaredFormat || 'unknown' },
      nodes,
      meshes,
      materials: bbmodelMaterials(textures, textureEntries, stack),
      textures,
      rootNodes: hierarchy.rootNodes,
      // Absent rather than empty, so a file without animations loads exactly as before animations were read.
      ...(animations ? { animations } : {}),
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

/** A group texture uuid as a texture index; `undefined` when unset, −1 (warned) when it names no texture. */
function groupTextureIndex(
  texture: GroupTexture | undefined,
  textureIds: ReadonlyMap<string, number>,
  warnings: BbmodelWarningList,
): number | undefined {
  if (texture === undefined) return undefined;
  const index = textureIds.get(texture.uuid);
  if (index !== undefined) return index;
  warnings.add(
    'UNKNOWN_REFERENCE',
    texture.path,
    `no texture with uuid ${quoteValue(texture.uuid)}; its faces are untextured`,
  );
  return -1;
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

/** Validates every placed element and counts its triangles and vertices against the limits; allocates no geometry. */
function prepareElements(
  elements: readonly JsonObject[],
  placements: readonly ElementPlacement[],
  nodeTextures: readonly (number | undefined)[],
  context: ConverterContext,
  limits: BbmodelLimits,
  warnings: BbmodelWarningList,
): PlacedElement[] {
  const placed: PlacedElement[] = [];
  let triangles = 0;
  let vertices = 0;
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
    const groupTexture = node >= 0 ? nodeTextures[node] : undefined;
    const prepared = converter.prepare(
      element,
      path,
      groupTexture === undefined ? context : { ...context, groupTexture },
    );
    triangles += prepared.triangleCount;
    if (triangles > limits.maxTriangles) {
      throw new BbmodelError('TOO_MANY_TRIANGLES', path, `more than ${limits.maxTriangles} triangles`);
    }
    vertices += prepared.vertexCount;
    if (vertices > limits.maxVertices) {
      throw new BbmodelError('TOO_MANY_VERTICES', path, `more than ${limits.maxVertices} vertices`);
    }
    placed.push({ prepared, node });
  }
  return placed;
}
