import { quoteValue } from '../bbmodel/quoteValue';
import { GltfError } from './GltfError';
import type { GltfLimits } from './GltfLoadOptions';
import type { GltfWarningList } from './GltfWarning';
import { childPath, field, isJsonObject, readList, readString, type JsonObject } from './gltfFields';

/** Extensions the loader implements; any other in `extensionsUsed` warns, in `extensionsRequired` fails. */
export const SUPPORTED_GLTF_EXTENSIONS: readonly string[] = ['KHR_texture_transform'];

/**
 * What the loader does with every property of the glTF 2.0 schema objects it meets: `read` (converted), `reported`
 * (a warning or error names it), `ignored` (carries nothing a scene can show: names, extras, bounds, hints). A test
 * checks the full schema key list against this table, so a property can never be dropped without a decision.
 */
export const GLTF_PROPERTY_HANDLING: Readonly<
  Record<string, Readonly<Record<string, 'read' | 'reported' | 'ignored'>>>
> = {
  root: {
    asset: 'read',
    scene: 'read',
    scenes: 'read',
    nodes: 'read',
    meshes: 'read',
    accessors: 'read',
    bufferViews: 'read',
    buffers: 'read',
    materials: 'read',
    textures: 'read',
    images: 'read',
    samplers: 'read',
    skins: 'reported',
    animations: 'reported',
    cameras: 'reported',
    extensionsUsed: 'reported',
    extensionsRequired: 'reported',
    extensions: 'reported',
    extras: 'ignored',
  },
  asset: {
    version: 'read',
    minVersion: 'read',
    generator: 'ignored',
    copyright: 'ignored',
    extensions: 'reported',
    extras: 'ignored',
  },
  scene: { nodes: 'read', name: 'ignored', extensions: 'reported', extras: 'ignored' },
  node: {
    children: 'read',
    mesh: 'read',
    matrix: 'read',
    translation: 'read',
    rotation: 'read',
    scale: 'read',
    name: 'read',
    camera: 'reported',
    skin: 'reported',
    weights: 'reported',
    extensions: 'reported',
    extras: 'ignored',
  },
  mesh: { primitives: 'read', name: 'read', weights: 'reported', extensions: 'reported', extras: 'ignored' },
  primitive: {
    attributes: 'read',
    indices: 'read',
    material: 'read',
    mode: 'read',
    targets: 'reported',
    extensions: 'reported',
    extras: 'ignored',
  },
  material: {
    name: 'read',
    pbrMetallicRoughness: 'read',
    alphaMode: 'read',
    alphaCutoff: 'read',
    doubleSided: 'read',
    normalTexture: 'reported',
    occlusionTexture: 'reported',
    emissiveTexture: 'reported',
    emissiveFactor: 'reported',
    extensions: 'reported',
    extras: 'ignored',
  },
  pbrMetallicRoughness: {
    baseColorFactor: 'read',
    baseColorTexture: 'read',
    metallicFactor: 'reported',
    roughnessFactor: 'reported',
    metallicRoughnessTexture: 'reported',
    extensions: 'reported',
    extras: 'ignored',
  },
  textureInfo: { index: 'read', texCoord: 'read', extensions: 'read', extras: 'ignored' },
  accessor: {
    bufferView: 'read',
    byteOffset: 'read',
    componentType: 'read',
    normalized: 'read',
    count: 'read',
    type: 'read',
    sparse: 'reported',
    max: 'ignored',
    min: 'ignored',
    name: 'ignored',
    extensions: 'reported',
    extras: 'ignored',
  },
  bufferView: {
    buffer: 'read',
    byteOffset: 'read',
    byteLength: 'read',
    byteStride: 'read',
    target: 'ignored',
    name: 'ignored',
    extensions: 'reported',
    extras: 'ignored',
  },
  buffer: { uri: 'read', byteLength: 'read', name: 'ignored', extensions: 'reported', extras: 'ignored' },
  sampler: {
    magFilter: 'reported',
    minFilter: 'reported',
    wrapS: 'reported',
    wrapT: 'reported',
    name: 'ignored',
    extensions: 'reported',
    extras: 'ignored',
  },
  texture: { sampler: 'read', source: 'read', name: 'ignored', extensions: 'reported', extras: 'ignored' },
  image: { uri: 'read', mimeType: 'read', bufferView: 'read', name: 'read', extensions: 'reported', extras: 'ignored' },
};

/**
 * Document-level reports: extensions (an unsupported required one is an error, before anything else is read), skins,
 * animations, cameras and morph weights. Extension objects anywhere in the file belong to an extension listed in
 * `extensionsUsed`, so the per-extension warning covers them.
 */
export function reportUnsupported(json: JsonObject, limits: GltfLimits, warnings: GltfWarningList): void {
  const strings = (key: string): string[] =>
    readList(json, key, '$', { max: limits.maxAccessors, code: 'TOO_MANY_ACCESSORS', what: 'extension names' }).map(
      (value, index) => readString(value, childPath(childPath('$', key), index), limits.maxStringChars),
    );
  strings('extensionsRequired').forEach((name, index) => {
    if (!SUPPORTED_GLTF_EXTENSIONS.includes(name)) {
      throw new GltfError(
        'UNSUPPORTED_REQUIRED_EXTENSION',
        childPath('$.extensionsRequired', index),
        `${quoteValue(name)} is required but not supported (supported: ${SUPPORTED_GLTF_EXTENSIONS.join(', ')})`,
      );
    }
  });
  strings('extensionsUsed').forEach((name, index) => {
    if (!SUPPORTED_GLTF_EXTENSIONS.includes(name)) {
      warnings.add('UNSUPPORTED_EXTENSION', childPath('$.extensionsUsed', index), `${quoteValue(name)} is ignored`);
    }
  });
  const count = (key: string): number => {
    const value = field(json, key);
    return Array.isArray(value) ? value.length : 0;
  };
  if (count('skins') > 0) {
    warnings.add('UNSUPPORTED_SKIN', '$.skins', `${count('skins')} skin(s); meshes are drawn unskinned`);
  }
  if (count('animations') > 0) {
    warnings.add(
      'UNSUPPORTED_ANIMATION',
      '$.animations',
      `${count('animations')} animation(s); the rest pose is drawn`,
    );
  }
  if (count('cameras') > 0) warnings.add('UNSUPPORTED_CAMERA', '$.cameras', `${count('cameras')} camera(s) not used`);
  for (const key of ['nodes', 'meshes']) {
    const list = field(json, key);
    if (!Array.isArray(list)) continue;
    const at = (list as readonly unknown[]).findIndex(
      (item) => isJsonObject(item) && field(item, 'weights') !== undefined,
    );
    if (at >= 0) {
      warnings.add(
        'UNSUPPORTED_MORPH_TARGETS',
        childPath(childPath(`$.${key}`, at), 'weights'),
        'morph weights ignored; the base geometry is drawn',
      );
    }
  }
}

const MODE_NAMES = ['POINTS', 'LINES', 'LINE_LOOP', 'LINE_STRIP'];

/**
 * Primitive-level reports. Returns `false` for a primitive that is skipped (points, lines, sparse storage, checked by
 * the caller); skins, morph targets and vertex colours only warn and the plain geometry is drawn.
 */
export function reportPrimitive(primitive: JsonObject, mode: number, path: string, warnings: GltfWarningList): boolean {
  const attributes = field(primitive, 'attributes');
  const names = isJsonObject(attributes) ? Object.keys(attributes) : [];
  const skin = names.find((name) => /^(JOINTS|WEIGHTS)_\d+$/.test(name));
  if (skin !== undefined) {
    warnings.add(
      'UNSUPPORTED_SKIN',
      childPath(childPath(path, 'attributes'), skin),
      'skinning ignored; drawn unskinned',
    );
  }
  const colour = names.find((name) => /^COLOR_\d+$/.test(name));
  if (colour !== undefined) {
    warnings.add('UNSUPPORTED_ATTRIBUTE', childPath(childPath(path, 'attributes'), colour), 'vertex colours not drawn');
  }
  if (field(primitive, 'targets') !== undefined) {
    warnings.add('UNSUPPORTED_MORPH_TARGETS', childPath(path, 'targets'), 'morph targets ignored; base geometry drawn');
  }
  if (mode < 4) {
    warnings.add('UNSUPPORTED_PRIMITIVE_MODE', childPath(path, 'mode'), `${MODE_NAMES[mode] ?? mode} cannot be drawn`);
    return false;
  }
  return true;
}
