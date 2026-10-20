import { describe, expect, it } from 'vitest';
import { GLTF_PROPERTY_HANDLING, SUPPORTED_GLTF_EXTENSIONS } from '../../src/gltf/reportUnsupported';
import { GltfError, loadGltf } from '../../src/index';
import { encodeSolidPng } from '../../src/png/encodeSolidPng';
import { json } from './expectGltfError';
import { gltfDoc, pngDataUri, TRIANGLE, type Json, type TestPrimitive } from './gltfBuilder';

const PNG_URI = pngDataUri(encodeSolidPng([1, 2, 3, 255]));
const textured = (extra: Json = {}): Json => ({ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, ...extra } });
const withTexture = (primitive: TestPrimitive = TRIANGLE, sampler?: Json) =>
  gltfDoc({
    meshes: [[{ ...primitive, material: 0 }]],
    materials: [textured()],
    textures: [sampler ? { source: 0, sampler: 0 } : { source: 0 }],
    images: [{ uri: PNG_URI }],
    ...(sampler ? { samplers: [sampler] } : {}),
  });
const VEC4 = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

interface Row {
  /** `object.key` entries of `GLTF_PROPERTY_HANDLING` this row covers. */
  readonly covers: readonly string[];
  readonly doc: () => Json;
  readonly expected: readonly [kind: 'warning' | 'error', code: string, path: string];
}

/** One minimal file per row of the loader's report table (docs/gltf.md lists the same rows). */
const ROWS: Readonly<Record<string, Row>> = {
  skins: {
    covers: ['root.skins', 'node.skin'],
    doc: () => gltfDoc({ extra: { skins: [{ joints: [0] }] }, nodes: [{ mesh: 0, skin: 0 }] }),
    expected: ['warning', 'UNSUPPORTED_SKIN', '$.skins'],
  },
  'joint attributes': {
    covers: [],
    doc: () => gltfDoc({ meshes: [[{ ...TRIANGLE, attributes: { JOINTS_0: VEC4, WEIGHTS_0: VEC4 } }]] }),
    expected: ['warning', 'UNSUPPORTED_SKIN', '$.meshes[0].primitives[0].attributes.JOINTS_0'],
  },
  'morph targets': {
    covers: ['primitive.targets'],
    doc: () => gltfDoc({ meshes: [[{ ...TRIANGLE, extra: { targets: [{ POSITION: 0 }] } }]] }),
    expected: ['warning', 'UNSUPPORTED_MORPH_TARGETS', '$.meshes[0].primitives[0].targets'],
  },
  'mesh weights': {
    covers: ['mesh.weights'],
    doc: () => {
      const doc = gltfDoc();
      (doc.meshes as Json[])[0]!.weights = [0.5];
      return doc;
    },
    expected: ['warning', 'UNSUPPORTED_MORPH_TARGETS', '$.meshes[0].weights'],
  },
  'node weights': {
    covers: ['node.weights'],
    doc: () => gltfDoc({ nodes: [{ mesh: 0, weights: [0.5] }] }),
    expected: ['warning', 'UNSUPPORTED_MORPH_TARGETS', '$.nodes[0].weights'],
  },
  animations: {
    covers: ['root.animations'],
    doc: () => gltfDoc({ extra: { animations: [{ channels: [], samplers: [] }] } }),
    expected: ['warning', 'UNSUPPORTED_ANIMATION', '$.animations'],
  },
  cameras: {
    covers: ['root.cameras', 'node.camera'],
    doc: () => gltfDoc({ extra: { cameras: [{ type: 'perspective' }] }, nodes: [{ mesh: 0, camera: 0 }] }),
    expected: ['warning', 'UNSUPPORTED_CAMERA', '$.cameras'],
  },
  'used extension': {
    covers: [
      'root.extensionsUsed',
      'root.extensions',
      'asset.extensions',
      'scene.extensions',
      'node.extensions',
      'mesh.extensions',
      'primitive.extensions',
      'material.extensions',
      'pbrMetallicRoughness.extensions',
      'accessor.extensions',
      'bufferView.extensions',
      'buffer.extensions',
      'sampler.extensions',
      'texture.extensions',
      'image.extensions',
    ],
    doc: () => gltfDoc({ extra: { extensionsUsed: ['KHR_lights_punctual'], extensions: { KHR_lights_punctual: {} } } }),
    expected: ['warning', 'UNSUPPORTED_EXTENSION', '$.extensionsUsed[0]'],
  },
  'required Draco': {
    covers: ['root.extensionsRequired'],
    doc: () =>
      gltfDoc({
        extra: { extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] },
      }),
    expected: ['error', 'UNSUPPORTED_REQUIRED_EXTENSION', '$.extensionsRequired[0]'],
  },
  'required meshopt': {
    covers: [],
    doc: () => gltfDoc({ extra: { extensionsRequired: ['KHR_texture_transform', 'EXT_meshopt_compression'] } }),
    expected: ['error', 'UNSUPPORTED_REQUIRED_EXTENSION', '$.extensionsRequired[1]'],
  },
  'required quantization': {
    covers: [],
    doc: () => gltfDoc({ extra: { extensionsRequired: ['KHR_mesh_quantization'] } }),
    expected: ['error', 'UNSUPPORTED_REQUIRED_EXTENSION', '$.extensionsRequired[0]'],
  },
  'PBR beyond base colour': {
    covers: [
      'material.normalTexture',
      'material.occlusionTexture',
      'material.emissiveTexture',
      'material.emissiveFactor',
      'pbrMetallicRoughness.metallicFactor',
      'pbrMetallicRoughness.roughnessFactor',
      'pbrMetallicRoughness.metallicRoughnessTexture',
    ],
    doc: () =>
      gltfDoc({
        meshes: [[{ ...TRIANGLE, material: 0 }]],
        materials: [
          {
            pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.5, metallicRoughnessTexture: { index: 0 } },
            normalTexture: { index: 0 },
            occlusionTexture: { index: 0 },
            emissiveTexture: { index: 0 },
            emissiveFactor: [1, 0, 0],
          },
        ],
      }),
    expected: ['warning', 'UNSUPPORTED_MATERIAL_FEATURE', '$.materials[0]'],
  },
  'vertex colours': {
    covers: [],
    doc: () => gltfDoc({ meshes: [[{ ...TRIANGLE, attributes: { COLOR_0: VEC4 } }]] }),
    expected: ['warning', 'UNSUPPORTED_ATTRIBUTE', '$.meshes[0].primitives[0].attributes.COLOR_0'],
  },
  'lines and points': {
    covers: [],
    doc: () => gltfDoc({ meshes: [[{ ...TRIANGLE, mode: 1 }]] }),
    expected: ['warning', 'UNSUPPORTED_PRIMITIVE_MODE', '$.meshes[0].primitives[0].mode'],
  },
  'sparse accessor': {
    covers: ['accessor.sparse'],
    doc: () => {
      const doc = gltfDoc();
      (doc.accessors as Json[])[0]!.sparse = { count: 1, indices: {}, values: {} };
      return doc;
    },
    expected: ['warning', 'UNSUPPORTED_SPARSE_ACCESSOR', '$.accessors[0]'],
  },
  'several scenes': {
    covers: [],
    doc: () => gltfDoc({ scenes: [{ nodes: [0] }, { nodes: [] }] }),
    expected: ['warning', 'EXTRA_SCENES_IGNORED', '$.scenes'],
  },
  'no scene': {
    covers: [],
    doc: () => gltfDoc({ scenes: null }),
    expected: ['warning', 'NO_SCENE', '$'],
  },
  'linear filter': {
    covers: ['sampler.magFilter', 'sampler.minFilter'],
    doc: () => withTexture(TRIANGLE, { magFilter: 9729 }),
    expected: ['warning', 'TEXTURE_FILTER_NEAREST', '$.samplers[0]'],
  },
  'repeat wrapping': {
    covers: ['sampler.wrapS', 'sampler.wrapT'],
    doc: () => withTexture({ ...TRIANGLE, uvs: [0, 0, 1.5, 0, 0, 1] }),
    expected: ['warning', 'UV_WRAP_CLAMPED', '$.materials[0]'],
  },
  'non-PNG image': {
    covers: [],
    doc: () => {
      const doc = withTexture();
      doc.images = [{ uri: 'data:image/jpeg;base64,/9j/4AAQ' }];
      return doc;
    },
    expected: ['warning', 'UNSUPPORTED_IMAGE', '$.images[0]'],
  },
  'factor beside a texture': {
    covers: [],
    doc: () => {
      const doc = withTexture();
      doc.materials = [textured({ baseColorFactor: [0.5, 0.5, 0.5, 1] })];
      return doc;
    },
    expected: ['warning', 'BASE_COLOR_FACTOR_IGNORED', '$.materials[0].pbrMetallicRoughness.baseColorFactor'],
  },
  'matrix and TRS': {
    covers: [],
    doc: () =>
      gltfDoc({ nodes: [{ mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], scale: [2, 2, 2] }] }),
    expected: ['warning', 'INVALID_TRANSFORM', '$.nodes[0]'],
  },
};

describe('reported glTF features', () => {
  it.each(Object.entries(ROWS))('%s', (_, row) => {
    const [kind, code, path] = row.expected;
    const text = json(row.doc());
    if (kind === 'error') {
      expect(() => loadGltf(text)).toThrow(GltfError);
      try {
        loadGltf(text);
      } catch (error) {
        expect(error).toMatchObject({ code, path });
      }
      return;
    }
    const { warnings } = loadGltf(text);
    expect(warnings.map((w) => [w.code, w.path])).toContainEqual([code, path]);
  });

  it('a skipped primitive draws nothing; skins and vertex colours keep the plain geometry', () => {
    expect(loadGltf(json(ROWS['lines and points']!.doc())).scene.meshes).toEqual([]);
    expect(loadGltf(json(ROWS['sparse accessor']!.doc())).scene.meshes).toEqual([]);
    expect(loadGltf(json(ROWS['joint attributes']!.doc())).scene.meshes[0]!.indices).toHaveLength(3);
    expect(loadGltf(json(ROWS['vertex colours']!.doc())).scene.meshes[0]!.indices).toHaveLength(3);
  });

  it('KHR_texture_transform is supported, used or required', () => {
    expect(SUPPORTED_GLTF_EXTENSIONS).toEqual(['KHR_texture_transform']);
    const doc = gltfDoc({
      extra: { extensionsUsed: ['KHR_texture_transform'], extensionsRequired: ['KHR_texture_transform'] },
    });
    expect(loadGltf(json(doc)).warnings).toEqual([]);
  });

  // Every property of the glTF 2.0 schema objects the loader meets (specification 2.0.1, JSON schema).
  const SCHEMA: Readonly<Record<string, readonly string[]>> = {
    root: [
      'extensionsUsed',
      'extensionsRequired',
      'accessors',
      'animations',
      'asset',
      'buffers',
      'bufferViews',
      'cameras',
      'images',
      'materials',
      'meshes',
      'nodes',
      'samplers',
      'scene',
      'scenes',
      'skins',
      'textures',
      'extensions',
      'extras',
    ],
    asset: ['copyright', 'generator', 'version', 'minVersion', 'extensions', 'extras'],
    scene: ['nodes', 'name', 'extensions', 'extras'],
    node: [
      'camera',
      'children',
      'skin',
      'matrix',
      'mesh',
      'rotation',
      'scale',
      'translation',
      'weights',
      'name',
      'extensions',
      'extras',
    ],
    mesh: ['primitives', 'weights', 'name', 'extensions', 'extras'],
    primitive: ['attributes', 'indices', 'material', 'mode', 'targets', 'extensions', 'extras'],
    material: [
      'name',
      'extensions',
      'extras',
      'pbrMetallicRoughness',
      'normalTexture',
      'occlusionTexture',
      'emissiveTexture',
      'emissiveFactor',
      'alphaMode',
      'alphaCutoff',
      'doubleSided',
    ],
    pbrMetallicRoughness: [
      'baseColorFactor',
      'baseColorTexture',
      'metallicFactor',
      'roughnessFactor',
      'metallicRoughnessTexture',
      'extensions',
      'extras',
    ],
    textureInfo: ['index', 'texCoord', 'extensions', 'extras'],
    accessor: [
      'bufferView',
      'byteOffset',
      'componentType',
      'normalized',
      'count',
      'type',
      'max',
      'min',
      'sparse',
      'name',
      'extensions',
      'extras',
    ],
    bufferView: ['buffer', 'byteOffset', 'byteLength', 'byteStride', 'target', 'name', 'extensions', 'extras'],
    buffer: ['uri', 'byteLength', 'name', 'extensions', 'extras'],
    sampler: ['magFilter', 'minFilter', 'wrapS', 'wrapT', 'name', 'extensions', 'extras'],
    texture: ['sampler', 'source', 'name', 'extensions', 'extras'],
    image: ['uri', 'mimeType', 'bufferView', 'name', 'extensions', 'extras'],
  };

  it('every glTF 2.0 schema property is read, reported or deliberately ignored', () => {
    for (const [object, keys] of Object.entries(SCHEMA)) {
      const handled = GLTF_PROPERTY_HANDLING[object];
      expect(handled, object).toBeDefined();
      for (const key of keys) expect(handled?.[key], `${object}.${key}`).toBeDefined();
      expect(Object.keys(handled ?? {}).sort(), object).toEqual([...keys].sort());
    }
    expect(Object.keys(GLTF_PROPERTY_HANDLING).sort()).toEqual(Object.keys(SCHEMA).sort());
  });

  it('every reported property has a row above that shows its warning or error', () => {
    const covered = new Set(Object.values(ROWS).flatMap((row) => row.covers));
    for (const [object, keys] of Object.entries(GLTF_PROPERTY_HANDLING)) {
      for (const [key, handling] of Object.entries(keys)) {
        if (handling === 'reported') expect(covered.has(`${object}.${key}`), `${object}.${key}`).toBe(true);
      }
    }
  });
});
