import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelSource } from '@modelshot/app/intake';
import { listMtlReferences } from '@modelshot/formats';
import { describe, expect, it, vi } from 'vitest';
import { EmbedError } from '../src/EmbedError';
import { MAX_EMBED_SIDECARS, fetchSidecars, type ReferenceLister } from '../src/frame/fetchSidecars';

const FIXTURES = join(import.meta.dirname, '..', 'e2e', 'fixtures', 'sidecars');
const fixture = (path: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(join(FIXTURES, path)));

const FRAME = 'https://embed.example';
const SERVER = 'https://models.example';

/**
 * What the load worker answers: the model read and listed by `ModelSource`, a library by `listMtlReferences`. The worker
 * gets a copy of the File (a message is a structured clone), so the copy is read, never the frame's object.
 */
function workerLister(): { lister: ReferenceLister; asked: string[] } {
  const asked: string[] = [];
  const lister: ReferenceLister = async (file, of, maxReferences) => {
    asked.push(`${of} ${file.name}`);
    const copy = new File([file], file.name);
    if (of === 'library') return listMtlReferences(new Uint8Array(await copy.arrayBuffer()), { maxReferences });
    return (await ModelSource.open(copy)).references(maxReferences);
  };
  return { lister, asked };
}

const text = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value);
const gltfWith = (uris: { buffers?: string[]; images?: string[] }): string =>
  JSON.stringify({
    asset: { version: '2.0' },
    buffers: (uris.buffers ?? []).map((uri) => ({ uri, byteLength: 4 })),
    images: (uris.images ?? []).map((uri) => ({ uri })),
  });

interface Case {
  readonly model: () => File;
  readonly path: string;
  readonly served?: Record<string, () => Uint8Array<ArrayBuffer>>;
  readonly maxBytes?: (model: File) => number;
}

const names = (count: number): string[] => Array.from({ length: count }, (_, i) => `t${i}.png`);
const pngs = (count: number): Record<string, () => Uint8Array<ArrayBuffer>> =>
  Object.fromEntries(names(count).map((n) => [`/m/${n}`, () => text('png')]));

const CASES: Record<string, Case> = {
  'the fixture glTF': {
    model: () => new File([fixture('gltf/scene.gltf')], 'scene.gltf'),
    path: '/sidecars/gltf/scene.gltf',
    served: {
      '/sidecars/gltf/bin/scene.bin': () => fixture('gltf/bin/scene.bin'),
      '/sidecars/textures/checker%20tile.png': () => fixture('textures/checker tile.png'),
    },
  },
  'the fixture OBJ': {
    model: () => new File([fixture('obj/scene.obj')], 'scene.obj'),
    path: '/sidecars/obj/scene.obj',
    served: {
      '/sidecars/obj/scene.mtl': () => fixture('obj/scene.mtl'),
      '/sidecars/textures/checker%20tile.png': () => fixture('textures/checker tile.png'),
    },
  },
  [`${MAX_EMBED_SIDECARS} files`]: {
    model: () => new File([gltfWith({ images: names(MAX_EMBED_SIDECARS) })], 'a.gltf'),
    path: '/m/a.gltf',
    served: pngs(MAX_EMBED_SIDECARS),
  },
  [`${MAX_EMBED_SIDECARS + 1} files`]: {
    model: () => new File([gltfWith({ images: names(MAX_EMBED_SIDECARS + 1) })], 'a.gltf'),
    path: '/m/a.gltf',
    served: pngs(MAX_EMBED_SIDECARS + 1),
  },
  'more references than are listed': {
    model: () => new File([gltfWith({ images: Array.from({ length: 600 }, (_, i) => `x/${i}.jpg`) })], 'a.gltf'),
    path: '/m/a.gltf',
  },
  'two files of one name': {
    model: () => new File([gltfWith({ images: ['x/a.png', 'y/A.png'] })], 'a.gltf'),
    path: '/m/a.gltf',
  },
  'a hostile reference after fetchable ones': {
    model: () =>
      new File([gltfWith({ buffers: ['a.bin'], images: ['b.png', 'https://evil.example/c.png'] })], 'a.gltf'),
    path: '/m/a.gltf',
  },
  'a percent-encoded twin of a hostile reference': {
    model: () => new File([gltfWith({ buffers: ['%2F%2Fevil.example/a.bin', '//evil.example/a.bin'] })], 'a.gltf'),
    path: '/m/a.gltf',
  },
  'a drive path, skipped': {
    model: () => new File([gltfWith({ images: ['C:\\tex\\a.png', 'b.png'] })], 'a.gltf'),
    path: '/m/a.gltf',
    served: { '/m/b.png': () => text('png') },
  },
  'a reference past the byte budget': {
    model: () => new File([gltfWith({ buffers: ['a.bin'] })], 'a.gltf'),
    path: '/m/a.gltf',
    served: { '/m/a.bin': () => new Uint8Array(60) },
    maxBytes: (model) => model.size + 50,
  },
  'a hostile texture of a material library': {
    model: () => new File(['mtllib a.mtl\n'], 'a.obj'),
    path: '/m/a.obj',
    served: { '/m/a.mtl': () => text('newmtl a\nmap_Kd a.png\nnewmtl b\nmap_Kd //evil.example/b.png\n') },
  },
  'library textures over the count': {
    model: () => new File(['mtllib a.mtl\n'], 'a.obj'),
    path: '/m/a.obj',
    served: {
      '/m/a.mtl': () =>
        text(Array.from({ length: MAX_EMBED_SIDECARS }, (_, i) => `newmtl m${i}\nmap_Kd t${i}.png`).join('\n')),
    },
  },
  'a malformed glTF': { model: () => new File(['{"asset":'], 'a.gltf'), path: '/m/a.gltf' },
  'a GLB over the loader limit': {
    model: () => new File([new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])], 'a.glb'),
    path: '/m/a.glb',
  },
};

interface Outcome {
  readonly files?: string[];
  readonly code?: string;
  readonly message?: string;
  readonly requests: string[];
}

async function outcome(test: Case, lister: ReferenceLister | undefined): Promise<Outcome> {
  const requests: string[] = [];
  const fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const body = test.served?.[new URL(url).pathname];
    return Promise.resolve(body ? new Response(body()) : new Response('missing', { status: 404 }));
  }) as typeof globalThis.fetch;
  const model = test.model();
  try {
    const files = await fetchSidecars(model, `${SERVER}${test.path}`, {
      fetch,
      frameOrigin: FRAME,
      ...(test.maxBytes ? { maxBytes: test.maxBytes(model) } : {}),
      ...(lister ? { listReferences: lister } : {}),
    });
    return { files: files.map((f) => f.name), requests };
  } catch (error) {
    if (!(error instanceof EmbedError)) throw error;
    return { code: error.code, message: error.message, requests };
  }
}

describe('fetchSidecars with the load worker listing the references', () => {
  it.each(Object.keys(CASES))('ends %s as listing in the frame does', async (name) => {
    const test = CASES[name]!;
    const here = await outcome(test, undefined);
    const { lister } = workerLister();
    expect(await outcome(test, lister)).toEqual(here);
  });

  it('never reads the model in the frame beyond its first 4 bytes, nor a material library', async () => {
    const { lister, asked } = workerLister();
    const model = new File([fixture('obj/scene.obj')], 'scene.obj');
    const whole = vi.spyOn(model, 'arrayBuffer').mockRejectedValue(new Error('read in the frame'));
    const libraries: File[] = [];
    const fetch = ((url: string) => {
      const body = url.endsWith('.mtl') ? fixture('obj/scene.mtl') : fixture('textures/checker tile.png');
      return Promise.resolve(new Response(body));
    }) as typeof globalThis.fetch;
    const listing: ReferenceLister = (file, of, max) => {
      if (of === 'library') {
        libraries.push(file);
        vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('read in the frame'));
      }
      return lister(file, of, max);
    };
    const files = await fetchSidecars(model, `${SERVER}/sidecars/obj/scene.obj`, {
      fetch,
      frameOrigin: FRAME,
      listReferences: listing,
    });
    expect(files.map((f) => f.name)).toEqual(['scene.mtl', 'checker tile.png']);
    expect(whole).not.toHaveBeenCalled();
    expect(asked).toEqual(['model scene.obj', 'library scene.mtl']);
    expect(libraries).toHaveLength(1);
  });

  it('asks nothing of the lister for a .bbmodel', async () => {
    const { lister, asked } = workerLister();
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const model = new File(['{"meta":{}}'], 'a.bbmodel');
    expect(
      await fetchSidecars(model, `${SERVER}/m/a.bbmodel`, { fetch, frameOrigin: FRAME, listReferences: lister }),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('rejects with the abort reason when the frame moves on while the worker lists', async () => {
    const controller = new AbortController();
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const listing = fetchSidecars(new File([gltfWith({ buffers: ['a.bin'] })], 'a.gltf'), `${SERVER}/m/a.gltf`, {
      fetch,
      frameOrigin: FRAME,
      signal: controller.signal,
      listReferences: () =>
        new Promise((_resolve, reject) =>
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason as Error)),
        ),
    });
    controller.abort(new Error('superseded'));
    await expect(listing).rejects.toThrow('superseded');
    expect(fetch).not.toHaveBeenCalled();
  });
});
