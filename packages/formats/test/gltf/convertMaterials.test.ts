import { resolveMaterialAlpha, texelCoverage } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { linearToSrgbByte } from '../../src/gltf/convertMaterials';
import { BLEND_ALPHA_CUTOFF, loadGltf } from '../../src/index';
import { encodeSolidPng } from '../../src/png/encodeSolidPng';
import { pngHeader } from '../bbmodel/fixtures';
import { expectGltfError, json } from './expectGltfError';
import { gltfDoc, pngDataUri, TRIANGLE, type Json, type TestPrimitive } from './gltfBuilder';

const PNG = encodeSolidPng([10, 20, 30, 255]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const image = (bytes: Uint8Array = PNG, mime = 'image/png'): Json => ({
  uri: `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`,
});

function loadMaterials(materials: Json[], extra: Partial<Parameters<typeof gltfDoc>[0]> = {}) {
  const meshes = [materials.map((_, material): TestPrimitive => ({ ...TRIANGLE, material }))];
  return loadGltf(json(gltfDoc({ meshes, materials, ...extra })));
}

/** The RGBA pixel stored in a 1×1 PNG from `encodeSolidPng`. */
function solidPixel(bytes: Uint8Array | null): number[] {
  if (!bytes) throw new Error('no bytes');
  return [...bytes.slice(33 + 8 + 8, 33 + 8 + 12)];
}

describe('convertMaterials', () => {
  it('maps the three alpha modes and their cutoffs', () => {
    const { scene } = loadMaterials([
      {},
      { alphaMode: 'OPAQUE', alphaCutoff: 0.3 },
      { alphaMode: 'MASK' },
      { alphaMode: 'MASK', alphaCutoff: 0.3 },
      { alphaMode: 'BLEND' },
    ]);
    expect(scene.materials.map((m) => [m.alphaMode, m.alphaCutoff])).toEqual([
      ['opaque', undefined],
      ['opaque', undefined],
      ['mask', 0.5],
      ['mask', 0.3],
      ['blend', BLEND_ALPHA_CUTOFF],
    ]);
    expectGltfError(json(gltfDoc({ materials: [{ alphaMode: 'ADD' }] })), 'INVALID_FIELD', '$.materials[0].alphaMode');
    expectGltfError(
      json(gltfDoc({ materials: [{ alphaMode: 'MASK', alphaCutoff: -0.1 }] })),
      'INVALID_FIELD',
      '$.materials[0].alphaCutoff',
    );
    expectGltfError(
      json(gltfDoc({ materials: [{ alphaMode: 'MASK', alphaCutoff: 'x' }] })),
      'INVALID_FIELD',
      '$.materials[0].alphaCutoff',
    );
  });

  it('BLEND hides only alpha byte 0: byte 1 is partial, 255 opaque', () => {
    const { scene } = loadMaterials([{ alphaMode: 'BLEND' }]);
    const rule = resolveMaterialAlpha(scene.materials[0]);
    expect(texelCoverage(0 / 255, rule)).toBe('invisible');
    expect(texelCoverage(1 / 255, rule)).toBe('partial');
    expect(texelCoverage(Math.fround(1 / 255), rule)).toBe('partial');
    expect(texelCoverage(254 / 255, rule)).toBe('partial');
    expect(texelCoverage(1, rule)).toBe('opaque');
  });

  it('sets doubleSided on the groups of the material', () => {
    const { scene } = loadMaterials([{ doubleSided: true }, {}]);
    expect(scene.meshes[0]!.groups.map((g) => [g.material, g.doubleSided])).toEqual([
      [0, true],
      [1, false],
    ]);
  });

  it('turns a base colour factor into a 1×1 sRGB PNG: linear 0.5 is byte 188, deduplicated', () => {
    expect(linearToSrgbByte(0.5)).toBe(188);
    expect(linearToSrgbByte(0)).toBe(0);
    expect(linearToSrgbByte(1)).toBe(255);
    const { scene, warnings } = loadMaterials([
      { pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } },
      { pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } },
      { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 0.25] } },
      {},
    ]);
    expect(scene.materials.map((m) => m.texture)).toEqual([0, 0, 1, 2]);
    expect(scene.textures.map((t) => [t.name, t.width, t.height, t.missing])).toEqual([
      ['colour #bcbcbcff', 1, 1, false],
      ['colour #ff000040', 1, 1, false],
      ['colour #ffffffff', 1, 1, false],
    ]);
    expect(solidPixel(scene.textures[0]!.bytes)).toEqual([188, 188, 188, 255]);
    expect(solidPixel(scene.textures[1]!.bytes)).toEqual([255, 0, 0, 64]);
    expect(warnings).toEqual([]);
    // Untextured faces sample the centre of the colour texture.
    expect([...scene.meshes[0]!.uvs.slice(0, 6)]).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect([...scene.meshes[0]!.uvRects.slice(0, 4)]).toEqual([0, 0, 1, 1]);
  });

  it('a primitive without a material keeps material −1', () => {
    const { scene } = loadGltf(json(gltfDoc()));
    expect(scene.meshes[0]!.groups[0]!.material).toBe(-1);
    expect(scene.materials).toEqual([]);
  });

  it('a texture: PNG only, deduplicated by image; a JPEG is missing with a warning', () => {
    const textured = (index: number): Json => ({ pbrMetallicRoughness: { baseColorTexture: { index } } });
    const { scene, warnings } = loadMaterials([textured(0), textured(1), textured(2)], {
      textures: [{ source: 0 }, { source: 0 }, { source: 1 }],
      images: [image(), image(JPEG, 'image/jpeg')],
    });
    expect(scene.materials.map((m) => m.texture)).toEqual([0, 0, 1]);
    expect(scene.textures.map((t) => [t.width, t.missing])).toEqual([
      [1, false],
      [0, true],
    ]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNSUPPORTED_IMAGE', '$.images[1]']]);
  });

  it('a PNG larger than the limits fails; a bad PNG header is missing with a warning', () => {
    const big = { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } };
    const doc = (bytes: Uint8Array) =>
      json(
        gltfDoc({
          meshes: [[{ ...TRIANGLE, material: 0 }]],
          materials: [big],
          textures: [{ source: 0 }],
          images: [image(bytes)],
        }),
      );
    expectGltfError(doc(pngHeader(4097, 1)), 'TEXTURE_TOO_LARGE', '$.images[0]');
    expectGltfError(doc(pngHeader(64, 64)), 'TEXTURE_TOO_LARGE', '$.images[0]', { limits: { maxTexturePixels: 4095 } });
    const broken = new Uint8Array(PNG);
    broken[12] = 0;
    const { scene, warnings } = loadGltf(doc(broken));
    expect(scene.textures[0]!.missing).toBe(true);
    expect(warnings.map((w) => w.code)).toEqual(['UNSUPPORTED_IMAGE']);
  });

  it('reports a factor beside a texture, which is drawn as it is', () => {
    const { warnings } = loadMaterials(
      [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 1, 1], baseColorTexture: { index: 0 } } }],
      { textures: [{ source: 0 }], images: [image()] },
    );
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['BASE_COLOR_FACTOR_IGNORED', '$.materials[0].pbrMetallicRoughness.baseColorFactor'],
    ]);
  });

  it('bakes KHR_texture_transform (T · R · S) into the UVs and honours its texCoord override', () => {
    const material = {
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
          texCoord: 0,
          extensions: {
            KHR_texture_transform: { offset: [0.5, 0], rotation: Math.PI / 2, scale: [0.5, 0.5], texCoord: 1 },
          },
        },
      },
    };
    const primitive: TestPrimitive = { ...TRIANGLE, material: 0, uvs1: [1, 0, 1, 0, 1, 0] };
    const doc = gltfDoc({ meshes: [[primitive]], materials: [material], textures: [{ source: 0 }], images: [image()] });
    const { scene } = loadGltf(json(doc));
    // (1, 0) -> S -> (0.5, 0) -> R 90° (u' = cos u + sin v, v' = −sin u + cos v) -> (0, −0.5) -> T -> (0.5, −0.5).
    const uvs = [...scene.meshes[0]!.uvs].map((x) => Math.round(x * 1e6) / 1e6 || 0);
    expect(uvs).toEqual([0.5, -0.5, 0.5, -0.5, 0.5, -0.5]);
  });

  it('reads TEXCOORD_<texCoord>; a missing set samples texel (0, 0) with a warning', () => {
    const material = { pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 3 } } };
    const { scene, warnings } = loadMaterials([material], { textures: [{ source: 0 }], images: [image()] });
    expect([...scene.meshes[0]!.uvs]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['MISSING_TEXCOORD', '$.meshes[0].primitives[0].attributes'],
    ]);
  });

  it('reports a linear filter once per sampler, and UVs outside 0..1 under a repeating sampler', () => {
    const material = (index: number) => ({ pbrMetallicRoughness: { baseColorTexture: { index } } });
    const outside: TestPrimitive = { ...TRIANGLE, uvs: [0, 0, 2, 0, 0, 1] };
    const doc = gltfDoc({
      meshes: [
        [
          { ...outside, material: 0 },
          { ...outside, material: 1 },
          { ...outside, material: 2 },
        ],
      ],
      materials: [material(0), material(1), material(2)],
      textures: [
        { source: 0, sampler: 0 },
        { source: 0, sampler: 0 },
        { source: 0, sampler: 1 },
      ],
      samplers: [
        { magFilter: 9729, minFilter: 9987 },
        { magFilter: 9728, wrapS: 33071, wrapT: 33071 },
      ],
      images: [image()],
    });
    const { warnings } = loadGltf(json(doc));
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['TEXTURE_FILTER_NEAREST', '$.samplers[0]'],
      ['UV_WRAP_CLAMPED', '$.materials[0]'],
      ['UV_WRAP_CLAMPED', '$.materials[1]'],
    ]);
  });

  it('reads an image from a buffer view (as in a GLB)', () => {
    const doc = gltfDoc({
      meshes: [[{ ...TRIANGLE, material: 0 }]],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
    });
    const buffers = doc.buffers as Json[];
    const views = doc.bufferViews as Json[];
    buffers.push({ byteLength: PNG.byteLength, uri: pngDataUri(PNG).replace('image/png', 'application/octet-stream') });
    views.push({ buffer: 1, byteLength: PNG.byteLength });
    doc.images = [{ bufferView: views.length - 1, mimeType: 'image/png' }];
    const { scene } = loadGltf(json(doc));
    expect(scene.textures[0]).toMatchObject({ width: 1, height: 1, missing: false });
    expect(scene.textures[0]!.bytes).toEqual(PNG);
  });
});
