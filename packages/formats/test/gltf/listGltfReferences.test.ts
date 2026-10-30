import { describe, expect, it } from 'vitest';
import { listGltfReferences } from '../../src/index';
import { encodeSolidPng } from '../../src/png/encodeSolidPng';
import { gltfFixture } from './fixtures';
import { gltfDoc, pngDataUri, toGlb, TRIANGLE } from './gltfBuilder';

const MAX = { maxReferences: 31 };
const encode = (value: unknown): string => JSON.stringify(value);
const asset = { version: '2.0' };

describe('listGltfReferences', () => {
  it('lists the buffer and image of external.gltf as written', () => {
    expect(listGltfReferences(gltfFixture('external'), MAX)).toEqual(['./external.bin', 'textures/External.PNG']);
  });

  it('reads bytes as well as text', () => {
    const bytes = new TextEncoder().encode(gltfFixture('external'));
    expect(listGltfReferences(bytes, MAX)).toEqual(['./external.bin', 'textures/External.PNG']);
  });

  it('leaves data: URIs out', () => {
    const doc = gltfDoc({
      meshes: [[{ ...TRIANGLE, material: 0 }]],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ uri: pngDataUri(encodeSolidPng([1, 2, 3, 255])) }],
    });
    expect(listGltfReferences(encode(doc), MAX)).toEqual([]);
  });

  it('lists an external image of a GLB, not its BIN chunk', () => {
    const doc = gltfDoc({
      meshes: [[{ ...TRIANGLE, material: 0 }]],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ uri: 'skin.png' }],
    });
    expect(listGltfReferences(toGlb(doc), MAX)).toEqual(['skin.png']);
  });

  it('lists one relative path once, the first spelling kept', () => {
    const doc = {
      asset,
      buffers: [{ uri: 'a.bin' }, { uri: './a.bin' }, { uri: 'b.bin' }],
      images: [{ uri: 'a.bin' }],
    };
    expect(listGltfReferences(encode(doc), MAX)).toEqual(['a.bin', 'b.bin']);
  });

  it('lists URLs for the caller to refuse', () => {
    const doc = { asset, images: [{ uri: 'https://evil.example/a.png' }, { uri: 'javascript:alert(1)' }] };
    expect(listGltfReferences(encode(doc), MAX)).toEqual(['https://evil.example/a.png', 'javascript:alert(1)']);
  });

  it('stops after one more than the maximum', () => {
    const doc = { asset, images: Array.from({ length: 1000 }, (_, i) => ({ uri: `t${i}.png` })) };
    const listed = listGltfReferences(encode(doc), MAX);
    expect(listed).toHaveLength(32);
    expect(listed.at(-1)).toBe('t31.png');
  });

  it('ignores entries that are not objects and non-string or empty uris', () => {
    const doc = { asset, buffers: [null, 3, { uri: 5 }, { uri: '' }, { uri: ['a.bin'] }], images: { uri: 'x.png' } };
    expect(listGltfReferences(encode(doc), MAX)).toEqual([]);
  });

  it('lists nothing for a file the loader refuses', () => {
    expect(listGltfReferences('{"asset":', MAX)).toEqual([]);
    expect(listGltfReferences(encode({ asset: { version: '1.0' }, buffers: [{ uri: 'a.bin' }] }), MAX)).toEqual([]);
    expect(listGltfReferences(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]), MAX)).toEqual([]);
  });
});
