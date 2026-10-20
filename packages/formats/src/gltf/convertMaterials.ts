import type { SceneMaterial, SceneTexture } from '@modelshot/scene';
import { BLEND_ALPHA_CUTOFF } from '../alpha/blendAlphaCutoff';
import { quoteValue } from '../bbmodel/quoteValue';
import { decodeDataUri } from '../dataUri/decodeDataUri';
import { encodeSolidPng } from '../png/encodeSolidPng';
import { readPngSize } from '../png/readPngSize';
import type { ResourceFiles } from '../resources/ResourceFiles';
import type { GltfAccessors } from './GltfAccessors';
import { GltfError } from './GltfError';
import type { GltfLimits } from './GltfLoadOptions';
import type { GltfWarningList } from './GltfWarning';
import {
  childPath,
  field,
  readList,
  readNumber,
  readObject,
  readObjects,
  readOptionalBoolean,
  readOptionalIndex,
  readOptionalInteger,
  readOptionalNumber,
  readOptionalNumbers,
  readOptionalObject,
  readOptionalString,
  readString,
  type JsonObject,
} from './gltfFields';
import { readTextureTransform, type TextureTransform } from './TextureTransform';

/** How the meshes of a material read their UVs. */
export interface MaterialUvs {
  /** The material samples a base colour image (present or missing); otherwise every UV is the centre. */
  readonly textured: boolean;
  /** `TEXCOORD_<n>` to read. */
  readonly texCoord: number;
  readonly transform: TextureTransform | null;
  /** The sampler repeats or mirrors; UVs outside 0..1 are reported, since the renderers clamp. */
  readonly wraps: boolean;
  readonly doubleSided: boolean;
  readonly path: string;
}

export interface ConvertedMaterials {
  readonly materials: SceneMaterial[];
  readonly textures: SceneTexture[];
  /** Indexed like `materials` (and the glTF materials). */
  readonly uvs: MaterialUvs[];
}

export interface MaterialSources {
  readonly accessors: GltfAccessors;
  readonly files: ResourceFiles;
  readonly limits: GltfLimits;
  readonly warnings: GltfWarningList;
}

const ALPHA_MODES = { OPAQUE: 'opaque', MASK: 'mask', BLEND: 'blend' } as const;
const LINEAR_FILTERS = [9729, 9985, 9986, 9987];
const CLAMP_TO_EDGE = 33071;
const WHITE = [1, 1, 1, 1] as const;

/**
 * glTF materials as scene materials, one for one: alpha mode and cutoff (`BLEND` gets `BLEND_ALPHA_CUTOFF`),
 * `doubleSided` for the mesh groups, the base colour texture (PNG only; read from a `data:` URI, a buffer view or a
 * picked file), or, without a texture, a generated 1×1 PNG of the base colour factor in sRGB, so every renderer shows
 * it with no material field of its own. Everything else a material holds is reported, never silently dropped.
 */
export function convertMaterials(json: JsonObject, sources: MaterialSources): ConvertedMaterials {
  const { limits, warnings } = sources;
  const list = readList(json, 'materials', '$', {
    max: limits.maxMaterials,
    code: 'TOO_MANY_MATERIALS',
    what: 'materials',
  });
  const textureLimit = (what: string) => ({ max: limits.maxTextures, code: 'TOO_MANY_TEXTURES' as const, what });
  const gltfTextures = readList(json, 'textures', '$', textureLimit('textures'));
  const images = readList(json, 'images', '$', textureLimit('images'));
  const samplers = readList(json, 'samplers', '$', textureLimit('samplers'));
  const textures: SceneTexture[] = [];
  const imageTextures = new Map<number, number>();
  const colourTextures = new Map<string, number>();
  const reportedSamplers = new Set<number>();

  const imageTexture = (image: number): number => {
    const known = imageTextures.get(image);
    if (known !== undefined) return known;
    textures.push(readImage(images, image, sources));
    imageTextures.set(image, textures.length - 1);
    return textures.length - 1;
  };
  const colourTexture = (factor: readonly number[]): number => {
    const [r = 1, g = 1, b = 1, a = 1] = factor;
    const rgba = [linearToSrgbByte(r), linearToSrgbByte(g), linearToSrgbByte(b), Math.round(clamp01(a) * 255)] as const;
    const key = rgba.join(',');
    const known = colourTextures.get(key);
    if (known !== undefined) return known;
    const bytes = encodeSolidPng(rgba);
    const name = `colour #${rgba.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    textures.push({ name, mimeType: 'image/png', bytes, width: 1, height: 1, uvWidth: 1, uvHeight: 1, missing: false });
    colourTextures.set(key, textures.length - 1);
    return textures.length - 1;
  };

  const materials: SceneMaterial[] = [];
  const uvs: MaterialUvs[] = [];
  readObjects(list, '$.materials').forEach((material, index) => {
    const path = childPath('$.materials', index);
    const name = readOptionalString(material, 'name', path, limits.maxStringChars, `material ${index}`);
    const pbrPath = childPath(path, 'pbrMetallicRoughness');
    const pbr = readOptionalObject(material, 'pbrMetallicRoughness', path) ?? {};
    const factor = readOptionalNumbers(pbr, 'baseColorFactor', pbrPath, WHITE).map(clamp01);
    const reference = readOptionalObject(pbr, 'baseColorTexture', pbrPath);
    const doubleSided = readOptionalBoolean(material, 'doubleSided', path, false);
    reportMaterialFeatures(material, pbr, path, warnings);

    let texture: number;
    let materialUvs: MaterialUvs = { textured: false, texCoord: 0, transform: null, wraps: false, doubleSided, path };
    if (reference) {
      const referencePath = childPath(pbrPath, 'baseColorTexture');
      const textureIndex = readOptionalIndex(reference, 'index', referencePath, gltfTextures.length);
      if (textureIndex === undefined) throw new GltfError('INVALID_FIELD', referencePath, 'expected a texture index');
      const texturePath = childPath('$.textures', textureIndex);
      const gltfTexture = readObject(gltfTextures[textureIndex], texturePath);
      const image = readOptionalIndex(gltfTexture, 'source', texturePath, images.length);
      const sampler = readOptionalIndex(gltfTexture, 'sampler', texturePath, samplers.length);
      const samplerInfo = sampler === undefined ? { linear: false, wraps: true } : readSampler(samplers, sampler);
      if (samplerInfo.linear && sampler !== undefined && !reportedSamplers.has(sampler)) {
        reportedSamplers.add(sampler);
        warnings.add(
          'TEXTURE_FILTER_NEAREST',
          childPath('$.samplers', sampler),
          'a linear filter is requested; pixel art is drawn with nearest sampling',
        );
      }
      if (image === undefined) {
        warnings.add('UNSUPPORTED_IMAGE', texturePath, 'no PNG source (only an extension image); drawn missing');
        textures.push(missingTexture(`texture ${textureIndex}`));
        texture = textures.length - 1;
      } else texture = imageTexture(image);
      if (factor.some((value, k) => value !== WHITE[k])) {
        warnings.add(
          'BASE_COLOR_FACTOR_IGNORED',
          childPath(pbrPath, 'baseColorFactor'),
          `factor ${factor.map((v) => round3(v)).join(', ')} beside a texture is not applied; the texture is drawn as is`,
        );
      }
      const extensions = readOptionalObject(reference, 'extensions', referencePath);
      const transformObject =
        extensions && readOptionalObject(extensions, 'KHR_texture_transform', `${referencePath}.extensions`);
      const transform = transformObject
        ? readTextureTransform(transformObject, `${referencePath}.extensions.KHR_texture_transform`)
        : null;
      const texCoord = readOptionalInteger(reference, 'texCoord', referencePath, { min: 0, max: 31 }, 0);
      materialUvs = {
        textured: true,
        texCoord: transform?.texCoord ?? texCoord,
        transform,
        wraps: samplerInfo.wraps,
        doubleSided,
        path,
      };
    } else texture = colourTexture(factor);

    materials.push({ name, texture, ...readAlpha(material, path) });
    uvs.push(materialUvs);
  });
  return { materials, textures, uvs };
}

function readAlpha(material: JsonObject, path: string): Pick<SceneMaterial, 'alphaMode' | 'alphaCutoff'> {
  const modeValue = field(material, 'alphaMode');
  const modePath = childPath(path, 'alphaMode');
  const modeName = modeValue === undefined ? 'OPAQUE' : readString(modeValue, modePath, 16);
  if (!Object.hasOwn(ALPHA_MODES, modeName)) {
    throw new GltfError('INVALID_FIELD', modePath, `expected OPAQUE, MASK or BLEND, got ${quoteValue(modeName)}`);
  }
  const mode = ALPHA_MODES[modeName as keyof typeof ALPHA_MODES];
  if (mode === 'opaque') return { alphaMode: 'opaque' };
  if (mode === 'blend') return { alphaMode: 'blend', alphaCutoff: BLEND_ALPHA_CUTOFF };
  const cutoff = readOptionalNumber(material, 'alphaCutoff', path, 0.5);
  if (cutoff < 0) throw new GltfError('INVALID_FIELD', childPath(path, 'alphaCutoff'), `expected ≥ 0, got ${cutoff}`);
  return { alphaMode: 'mask', alphaCutoff: cutoff };
}

/** One warning per material listing every property beyond the base colour that the scene format cannot carry. */
function reportMaterialFeatures(material: JsonObject, pbr: JsonObject, path: string, warnings: GltfWarningList): void {
  const features: string[] = [];
  if (field(pbr, 'metallicRoughnessTexture') !== undefined) features.push('metallicRoughnessTexture');
  if (readOptionalNumber(pbr, 'metallicFactor', `${path}.pbrMetallicRoughness`, 1) !== 1)
    features.push('metallicFactor');
  if (readOptionalNumber(pbr, 'roughnessFactor', `${path}.pbrMetallicRoughness`, 1) !== 1) {
    features.push('roughnessFactor');
  }
  for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) {
    if (field(material, key) !== undefined) features.push(key);
  }
  if (readOptionalNumbers(material, 'emissiveFactor', path, [0, 0, 0]).some((value) => value !== 0)) {
    features.push('emissiveFactor');
  }
  if (features.length > 0) {
    warnings.add('UNSUPPORTED_MATERIAL_FEATURE', path, `${features.join(', ')} not drawn (base colour only)`);
  }
}

function readSampler(samplers: readonly unknown[], index: number): { linear: boolean; wraps: boolean } {
  const path = childPath('$.samplers', index);
  const sampler = readObject(samplers[index], path);
  const filter = (key: string): number | undefined => {
    const value = field(sampler, key);
    return value === undefined ? undefined : readNumber(value, childPath(path, key));
  };
  const linear = [filter('magFilter'), filter('minFilter')].some((f) => f !== undefined && LINEAR_FILTERS.includes(f));
  const wraps = [filter('wrapS'), filter('wrapT')].some((wrap) => wrap === undefined || wrap !== CLAMP_TO_EDGE);
  return { linear, wraps };
}

function readImage(images: readonly unknown[], index: number, sources: MaterialSources): SceneTexture {
  const { limits, warnings } = sources;
  const path = childPath('$.images', index);
  const image = readObject(images[index], path);
  const uriValue = field(image, 'uri');
  const uri = uriValue === undefined ? '' : readString(uriValue, childPath(path, 'uri'), limits.maxDataUriChars);
  const fallbackName = uri === '' || /^data:/i.test(uri) ? `image ${index}` : uri.slice(uri.lastIndexOf('/') + 1);
  const name = readOptionalString(
    image,
    'name',
    path,
    limits.maxStringChars,
    fallbackName.slice(0, limits.maxStringChars),
  );
  const mimeType = readOptionalString(image, 'mimeType', path, limits.maxStringChars, '');
  let bytes: Uint8Array | undefined;
  if (uri === '') {
    const view = readOptionalIndex(image, 'bufferView', path, sources.accessors.viewCount);
    if (view === undefined) throw new GltfError('INVALID_FIELD', path, 'expected a uri or a bufferView');
    bytes = sources.accessors.viewBytes(view);
  } else if (/^data:/i.test(uri)) {
    const decoded = decodeDataUri(uri, limits.maxDataUriChars);
    if (!decoded.ok) throw new GltfError('INVALID_FIELD', childPath(path, 'uri'), 'expected a base64 data URI');
    bytes = decoded.bytes;
  } else {
    const found = sources.files.resolve(uri);
    if (!found.ok) {
      warnings.add(
        'MISSING_RESOURCE',
        childPath(path, 'uri'),
        found.reason === 'NOT_FETCHED'
          ? `${quoteValue(uri)} is a URL and is not fetched; drawn missing`
          : `pick the file ${quoteValue(found.wanted)} together with the model; drawn missing`,
      );
      return missingTexture(name);
    }
    bytes = found.bytes;
  }
  const size = readPngSize(bytes);
  if (!size.ok) {
    const what = mimeType !== '' && mimeType !== 'image/png' ? quoteValue(mimeType) : `not a PNG (${size.reason})`;
    warnings.add('UNSUPPORTED_IMAGE', path, `${what}; only PNG images are drawn, this one is drawn missing`);
    return missingTexture(name);
  }
  if (size.width > limits.maxTextureSide || size.height > limits.maxTextureSide) {
    throw new GltfError(
      'TEXTURE_TOO_LARGE',
      path,
      `${size.width}×${size.height} pixels, the side limit is ${limits.maxTextureSide}`,
    );
  }
  if (size.width * size.height > limits.maxTexturePixels) {
    throw new GltfError(
      'TEXTURE_TOO_LARGE',
      path,
      `${size.width}×${size.height} pixels, the limit is ${limits.maxTexturePixels} pixels`,
    );
  }
  return {
    name,
    mimeType: 'image/png',
    bytes,
    width: size.width,
    height: size.height,
    uvWidth: size.width,
    uvHeight: size.height,
    missing: false,
  };
}

function missingTexture(name: string): SceneTexture {
  return { name, mimeType: 'image/png', bytes: null, width: 0, height: 0, uvWidth: 1, uvHeight: 1, missing: true };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** glTF factors are linear; the generated texture holds sRGB bytes like any other base colour image. */
export function linearToSrgbByte(linear: number): number {
  const c = clamp01(linear);
  const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
