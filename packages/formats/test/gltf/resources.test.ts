import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGltf } from '../../src/index';
import { encodeSolidPng } from '../../src/png/encodeSolidPng';
import { expectGltfError, json } from './expectGltfError';
import { fromBase64, gltfDoc, pngDataUri, TRIANGLE, type Json } from './gltfBuilder';

const PNG = encodeSolidPng([200, 100, 50, 255]);

function texturedDoc(imageUri: string): Json {
  return gltfDoc({
    meshes: [[{ ...TRIANGLE, material: 0 }]],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: imageUri }],
  });
}

/** A textured triangle whose buffer `uri` is `uri`; `bin` is the buffer's bytes, for the files map. */
function externalDoc(uri: string, imageUri = pngDataUri(PNG)): { doc: Json; bin: Uint8Array } {
  const doc = texturedDoc(imageUri);
  const buffer = (doc.buffers as { uri: string }[])[0]!;
  const bin = fromBase64(buffer.uri.slice(buffer.uri.indexOf(',') + 1));
  buffer.uri = uri;
  return { doc, bin };
}

describe('glTF resources', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());

  it('reads embedded data: buffers and images', () => {
    const { scene, warnings } = loadGltf(json(texturedDoc(pngDataUri(PNG))));
    expect(scene.textures[0]).toMatchObject({ width: 1, missing: false });
    expect(warnings).toEqual([]);
  });

  it('reads picked files by relative path, ./ prefix, percent escapes and case-insensitive base name', () => {
    for (const [uri, key] of [
      ['model.bin', 'model.bin'],
      ['./model.bin', 'model.bin'],
      ['bin/My%20Model.bin', 'bin/My Model.bin'],
      ['deep/path/MODEL.BIN', 'model.bin'],
    ] as const) {
      const { doc, bin } = externalDoc(uri, 'textures/Skin.PNG');
      const { scene, warnings } = loadGltf(json(doc), {
        files: new Map([
          [key, bin],
          ['skin.png', PNG],
        ]),
      });
      expect(scene.meshes[0]!.indices, uri).toHaveLength(3);
      expect(scene.textures[0]).toMatchObject({ name: 'Skin.PNG', missing: false });
      expect(warnings).toEqual([]);
    }
  });

  it('never fetches a URL: a remote buffer is an error, a remote image is missing', () => {
    const remote = externalDoc('https://example.com/model.bin').doc;
    const error = expectGltfError(json(remote), 'MISSING_BUFFER', '$.buffers[0].uri');
    expect(error.message).toMatch(/not fetched/);
    const { doc, bin } = externalDoc('model.bin', 'http://example.com/skin.png');
    const { scene, warnings } = loadGltf(json(doc), { files: new Map([['model.bin', bin]]) });
    expect(scene.textures[0]!.missing).toBe(true);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['MISSING_RESOURCE', '$.images[0].uri']]);
    expect(warnings[0]!.message).toMatch(/not fetched/);
  });

  it('a missing picked file names the file to pick', () => {
    const { doc, bin } = externalDoc('model.bin', 'skin.png');
    expect(expectGltfError(json(doc), 'MISSING_BUFFER', '$.buffers[0].uri').message).toMatch(
      /pick the file "model\.bin"/,
    );
    const { warnings } = loadGltf(json(doc), { files: new Map([['model.bin', bin]]) });
    expect(warnings[0]!.message).toMatch(/pick the file "skin\.png"/);
  });

  it('a picked buffer shorter than its byteLength is an error; a buffer without uri needs a GLB', () => {
    const { doc, bin } = externalDoc('model.bin');
    expectGltfError(json(doc), 'MISSING_BUFFER', '$.buffers[0]', { files: new Map([['model.bin', bin.slice(0, 8)]]) });
    const noUri = gltfDoc();
    delete (noUri.buffers as Json[])[0]!.uri;
    expectGltfError(json(noUri), 'MISSING_BUFFER', '$.buffers[0]');
  });
});
