import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GltfError, SkinError, loadBbmodel, loadGltf, loadObj, type ObjError } from '@modelshot/formats';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSource } from '../src/intake/ModelSource';
import { sha256Hex } from '../src/intake/sha256Hex';

const FIXTURES = join(import.meta.dirname, '..', '..', 'formats', 'test', 'fixtures');
const fixture = (path: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(join(FIXTURES, path)));
const file = (path: string, name = path.split('/').pop() ?? path): File => new File([fixture(path)], name);
const MAX = 512;

async function bytesOf(files: readonly File[]): Promise<Map<string, Uint8Array>> {
  return new Map(await Promise.all(files.map(async (f) => [f.name, new Uint8Array(await f.arrayBuffer())] as const)));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ModelSource', () => {
  it('reads a glTF once: one JSON parse for its references and its load, the same model as a whole-file load', async () => {
    const resources = [file('gltf/external.bin'), file('gltf/external.png')];
    const parse = vi.spyOn(JSON, 'parse');
    const model = file('gltf/external.gltf');
    const read = vi.spyOn(model, 'arrayBuffer');
    const source = await ModelSource.open(model);
    expect(source.references(MAX)).toEqual(['./external.bin', 'textures/External.PNG']);
    const loaded = await source.load(resources);
    expect(parse).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    parse.mockRestore();
    const whole = loadGltf(fixture('gltf/external.gltf'), { files: await bytesOf(resources) });
    expect(loaded).toEqual({
      doc: whole.scene,
      warnings: whole.warnings.map((w) => w.message),
      name: 'external.gltf',
      kind: 'model',
      key: await sha256Hex(fixture('gltf/external.gltf')),
    });
  });

  it('decodes an .obj model once for its references and its load (its library once more)', async () => {
    const resources = [file('obj/shapes.mtl'), file('obj/shapes.png')];
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    const source = await ModelSource.open(file('obj/shapes.obj'));
    expect(source.references(MAX)).toEqual(['shapes.mtl']);
    const loaded = await source.load(resources);
    expect(decode).toHaveBeenCalledTimes(2);
    decode.mockRestore();
    const whole = loadObj(fixture('obj/shapes.obj'), { files: await bytesOf(resources), fileName: 'shapes.obj' });
    expect(loaded.doc).toEqual(whole.scene);
    expect(loaded.warnings).toEqual(whole.warnings.map((w) => w.message));
  });

  it('cuts the list after maxReferences + 1, as the lister does', async () => {
    const images = Array.from({ length: 40 }, (_, i) => ({ uri: `t${i}.png` }));
    const gltf = new File([JSON.stringify({ asset: { version: '2.0' }, images })], 'a.gltf');
    expect((await ModelSource.open(gltf)).references(3)).toEqual(['t0.png', 't1.png', 't2.png', 't3.png']);
  });

  it.each([
    ['broken JSON', '{"asset":'],
    ['a glTF 1.0', '{"asset":{"version":"1.0"},"buffers":[{"uri":"a.bin"}]}'],
  ])('lists nothing for %s and fails the load with the loader error', async (_what, text) => {
    const source = await ModelSource.open(new File([text], 'a.gltf'));
    expect(source.references(MAX)).toEqual([]);
    const error = (await rejection(source.load([]))) as GltfError;
    const whole = (() => {
      try {
        loadGltf(new TextEncoder().encode(text));
      } catch (e) {
        return e as GltfError;
      }
      throw new Error('expected loadGltf to fail');
    })();
    expect(error).toBeInstanceOf(GltfError);
    expect([error.code, error.message]).toEqual([whole.code, whole.message]);
  });

  it('fails the load of an .obj over the size limit as a whole-file load does, naming the file', async () => {
    const big = new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'big.obj');
    const source = await ModelSource.open(big);
    expect(source.references(MAX)).toEqual([]);
    const error = (await rejection(source.load([]))) as ObjError;
    expect([error.code, error.path]).toEqual(['FILE_TOO_LARGE', 'big.obj']);
  });

  it('loads a .bbmodel as a whole-file load does, listing nothing', async () => {
    const source = await ModelSource.open(file('bbmodel/single-cube.bbmodel'));
    expect(source.references(MAX)).toEqual([]);
    const loaded = await source.load([]);
    expect(loaded.doc).toEqual(loadBbmodel(fixture('bbmodel/single-cube.bbmodel')).scene);
  });

  it('refuses a file of no model format as the worker did', async () => {
    const source = await ModelSource.open(new File(['hello'], 'a.txt'));
    expect(source.references(MAX)).toEqual([]);
    const error = await rejection(source.load([]));
    expect(error).toBeInstanceOf(SkinError);
    expect((error as SkinError).code).toBe('NOT_PNG');
  });
});
