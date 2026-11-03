import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGltf } from '../../src/index';
import { jpegFrame, jpegWith } from '../jpeg/jpegHeaderCases';
import { expectGltfError, json } from './expectGltfError';
import { gltfDoc, TRIANGLE, type Json } from './gltfBuilder';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/jpeg/${name}`, import.meta.url)));
const CRATE = fixture('crate.jpg');
const dataUri = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

function texturedDoc(image: Json): string {
  return json(
    gltfDoc({
      meshes: [[{ ...TRIANGLE, material: 0 }]],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [image],
    }),
  );
}

describe('glTF JPEG images', () => {
  it('reads crate.glb: the JPEG in a buffer view, also under a MASK material', () => {
    const { scene, warnings } = loadGltf(fixture('crate.glb'));
    expect(warnings).toEqual([]);
    expect(scene.textures).toHaveLength(1);
    expect(scene.textures[0]).toMatchObject({ mimeType: 'image/jpeg', width: 32, height: 32, missing: false });
    expect(scene.textures[0]!.bytes).toEqual(CRATE);
    expect(scene.materials.map((m) => [m.texture, m.alphaMode])).toEqual([
      [0, 'opaque'],
      [0, 'mask'],
    ]);
  });

  it('reads crate.gltf with the picked crate.bin and crate.jpg', () => {
    const files = new Map([
      ['crate.bin', fixture('crate.bin')],
      ['crate.jpg', CRATE],
    ]);
    const { scene, warnings } = loadGltf(fixture('crate.gltf'), { files });
    expect(warnings).toEqual([]);
    expect(scene.textures[0]).toMatchObject({ name: 'crate.jpg', mimeType: 'image/jpeg', width: 32, missing: false });
  });

  it('reads a data:image/jpeg URI, and JPEG bytes declared image/png as a JPEG', () => {
    for (const image of [
      { uri: dataUri(CRATE, 'image/jpeg') },
      { uri: dataUri(CRATE, 'image/png'), mimeType: 'image/png' },
    ]) {
      const { scene, warnings } = loadGltf(texturedDoc(image));
      expect(warnings).toEqual([]);
      expect(scene.textures[0]).toMatchObject({ mimeType: 'image/jpeg', width: 32, height: 32, missing: false });
    }
  });

  it('fails TEXTURE_TOO_LARGE from the JPEG header, before any decode', () => {
    const big = { uri: dataUri(fixture('big-sof.jpg'), 'image/jpeg') };
    const side = expectGltfError(texturedDoc(big), 'TEXTURE_TOO_LARGE', '$.images[0]');
    expect(side.message).toContain('4097×16');
    const tall = { uri: dataUri(jpegWith(jpegFrame(0xc2, 2048, 2049)), 'image/jpeg') };
    expectGltfError(texturedDoc(tall), 'TEXTURE_TOO_LARGE', '$.images[0]', {
      limits: { maxTexturePixels: 2048 * 2048 },
    });
  });

  it.each([
    ['a truncated JPEG', CRATE.slice(0, 40), 'image/jpeg', 'not a PNG or JPEG (JPEG TRUNCATED)'],
    ['an arithmetic JPEG', jpegWith(jpegFrame(0xc9, 8, 8)), 'image/jpeg', 'JPEG UNSUPPORTED_CODING arithmetic'],
    ['a zero-height JPEG', jpegWith(jpegFrame(0xc0, 8, 0)), 'image/jpeg', 'JPEG ZERO_SIZE'],
    ['WebP', new TextEncoder().encode('RIFF\x10\0\0\0WEBPVP8 '), 'image/webp', '"image/webp" (a WebP image)'],
  ])('draws %s missing with UNSUPPORTED_IMAGE naming why', (_name, bytes, mime, reason) => {
    const { scene, warnings } = loadGltf(texturedDoc({ uri: dataUri(bytes, mime), mimeType: mime }));
    expect(scene.textures[0]!.missing).toBe(true);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNSUPPORTED_IMAGE', '$.images[0]']]);
    expect(warnings[0]!.message).toContain(reason);
    expect(warnings[0]!.message).toContain('only PNG and JPEG images are drawn');
  });
});
