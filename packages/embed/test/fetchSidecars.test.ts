import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGltf, loadObj } from '@modelshot/formats';
import { describe, expect, it, vi } from 'vitest';
import { EmbedError } from '../src/EmbedError';
import { MAX_EMBED_SIDECARS, fetchSidecars } from '../src/frame/fetchSidecars';

const FIXTURES = join(import.meta.dirname, '..', 'e2e', 'fixtures', 'sidecars');
const fixture = (path: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(join(FIXTURES, path)));

const FRAME = 'https://embed.example';
const SERVER = 'https://models.example';
const GLTF_URL = `${SERVER}/sidecars/gltf/scene.gltf`;
const OBJ_URL = `${SERVER}/sidecars/obj/scene.obj`;

/** The fixture directory as the model server serves it, under `/sidecars/`. */
const SERVED: Record<string, () => Uint8Array<ArrayBuffer>> = {
  '/sidecars/gltf/bin/scene.bin': () => fixture('gltf/bin/scene.bin'),
  '/sidecars/textures/checker%20tile.png': () => fixture('textures/checker tile.png'),
  '/sidecars/obj/scene.mtl': () => fixture('obj/scene.mtl'),
};

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A fetch answering with `answer(url, init)`, recording the calls. */
function fakeFetch(answer: (url: string, init: RequestInit | undefined) => Promise<Response>) {
  const calls: Call[] = [];
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return answer(url, init);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** Serves `SERVED` (and `extra`), 404 for anything else. */
function server(extra: Record<string, () => Uint8Array<ArrayBuffer>> = {}) {
  return fakeFetch((url) => {
    const body = { ...SERVED, ...extra }[new URL(url).pathname];
    return Promise.resolve(body ? new Response(body()) : new Response('missing', { status: 404 }));
  });
}

/** A fetch that never answers until its request is aborted. */
const hanging = (init: RequestInit | undefined): Promise<Response> =>
  new Promise<Response>((_resolve, reject) =>
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
  );

const text = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value);
const gltfWith = (uris: { buffers?: string[]; images?: string[] }): string =>
  JSON.stringify({
    asset: { version: '2.0' },
    buffers: (uris.buffers ?? []).map((uri) => ({ uri, byteLength: 4 })),
    images: (uris.images ?? []).map((uri) => ({ uri })),
  });

async function failure(promise: Promise<unknown>): Promise<EmbedError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EmbedError);
  return error as EmbedError;
}

async function bytesOf(files: readonly File[]): Promise<Map<string, Uint8Array>> {
  return new Map(await Promise.all(files.map(async (f) => [f.name, new Uint8Array(await f.arrayBuffer())] as const)));
}

describe('fetchSidecars', () => {
  it("downloads a glTF's buffer and image from the model's server, named as the loader looks them up", async () => {
    const { fetch, calls } = server();
    const model = new File([fixture('gltf/scene.gltf')], 'scene.gltf');
    const files = await fetchSidecars(model, GLTF_URL, { fetch, frameOrigin: FRAME });
    expect(files.map((f) => f.name)).toEqual(['scene.bin', 'checker tile.png']);
    expect(calls.map((c) => c.url)).toEqual([
      `${SERVER}/sidecars/gltf/bin/scene.bin`,
      `${SERVER}/sidecars/textures/checker%20tile.png`,
    ]);
    for (const call of calls) {
      expect(call.init).toMatchObject({
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    }
    const { scene, warnings } = loadGltf(fixture('gltf/scene.gltf'), { files: await bytesOf(files) });
    expect(warnings.map((w) => w.code)).toEqual([]);
    expect(scene.textures.map((t) => t.missing)).toEqual([false]);
  });

  it("downloads an OBJ's material library, then its texture relative to the library", async () => {
    const { fetch, calls } = server();
    const model = new File([fixture('obj/scene.obj')], 'scene.obj');
    const files = await fetchSidecars(model, OBJ_URL, { fetch, frameOrigin: FRAME });
    expect(calls.map((c) => c.url)).toEqual([
      `${SERVER}/sidecars/obj/scene.mtl`,
      `${SERVER}/sidecars/textures/checker%20tile.png`,
    ]);
    expect(files.map((f) => f.name)).toEqual(['scene.mtl', 'checker tile.png']);
    const { scene, warnings } = loadObj(fixture('obj/scene.obj'), {
      files: await bytesOf(files),
      fileName: 'scene.obj',
    });
    expect(warnings.map((w) => w.code)).not.toContain('MISSING_RESOURCE');
    expect(scene.textures.map((t) => t.missing)).toEqual([false]);
  });

  it.each([
    ['a bbmodel', 'cube.bbmodel', '{"meta":{},"textures":[{"source":"https://evil.example/a.png"}]}'],
    ['a self-contained glTF', 'a.gltf', '{"asset":{"version":"2.0"},"buffers":[{"uri":"data:,","byteLength":0}]}'],
    ['an OBJ without mtllib', 'a.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'],
    ['a malformed glTF', 'a.gltf', '{"asset":'],
  ])('makes no request for %s', async (_what, name, body) => {
    const { fetch, calls } = server();
    expect(await fetchSidecars(new File([body], name), `${SERVER}/m/${name}`, { fetch, frameOrigin: FRAME })).toEqual(
      [],
    );
    expect(calls).toEqual([]);
  });

  it('makes no request for a GLB with its BIN chunk', async () => {
    const json = text('{"asset":{"version":"2.0"},"buffers":[{"byteLength":4}]}  ');
    const glb = new Uint8Array(12 + 8 + json.length + 8 + 4);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, glb.length, true);
    view.setUint32(12, json.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    glb.set(json, 20);
    view.setUint32(20 + json.length, 4, true);
    view.setUint32(24 + json.length, 0x004e4942, true);
    const { fetch, calls } = server();
    expect(await fetchSidecars(new File([glb], 'a.glb'), `${SERVER}/a.glb`, { fetch, frameOrigin: FRAME })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it(`takes ${MAX_EMBED_SIDECARS} files and refuses one more before any request`, async () => {
    const names = Array.from({ length: MAX_EMBED_SIDECARS + 1 }, (_, i) => `t${i}.png`);
    const served = Object.fromEntries(names.map((n) => [`/m/${n}`, () => text('png')]));
    const ok = server(served);
    const model = (count: number) => new File([gltfWith({ images: names.slice(0, count) })], 'a.gltf');
    const files = await fetchSidecars(model(MAX_EMBED_SIDECARS), `${SERVER}/m/a.gltf`, { ...ok, frameOrigin: FRAME });
    expect(files).toHaveLength(MAX_EMBED_SIDECARS);

    const over = server(served);
    const error = await failure(
      fetchSidecars(model(MAX_EMBED_SIDECARS + 1), `${SERVER}/m/a.gltf`, { ...over, frameOrigin: FRAME }),
    );
    expect(error.code).toBe('TOO_MANY_SIDECARS');
    expect(error.message).toContain(String(MAX_EMBED_SIDECARS));
    expect(over.calls).toEqual([]);
  });

  it('counts each URL once and leaves skipped references uncounted', async () => {
    const images = [...Array.from({ length: 40 }, (_, i) => `t${i}.jpg`), 'a.png', './a.png', 'x/../a.png'];
    const { fetch, calls } = server({ '/m/a.png': () => text('png') });
    const files = await fetchSidecars(new File([gltfWith({ images })], 'a.gltf'), `${SERVER}/m/a.gltf`, {
      fetch,
      frameOrigin: FRAME,
    });
    expect(files.map((f) => f.name)).toEqual(['a.png']);
    expect(calls).toHaveLength(1);
  });

  it('refuses textures of the material libraries over the count before any texture request', async () => {
    const mtl = Array.from({ length: MAX_EMBED_SIDECARS }, (_, i) => `newmtl m${i}\nmap_Kd t${i}.png`).join('\n');
    const { fetch, calls } = server({ '/m/a.mtl': () => text(mtl) });
    const error = await failure(
      fetchSidecars(new File(['mtllib a.mtl\n'], 'a.obj'), `${SERVER}/m/a.obj`, { fetch, frameOrigin: FRAME }),
    );
    expect(error.code).toBe('TOO_MANY_SIDECARS');
    expect(calls.map((c) => c.url)).toEqual([`${SERVER}/m/a.mtl`]);
  });

  it('refuses a hostile texture of a material library before any texture request', async () => {
    const mtl = 'newmtl a\nmap_Kd a.png\nnewmtl b\nmap_Kd //evil.example/b.png\n';
    const { fetch, calls } = server({ '/m/a.mtl': () => text(mtl) });
    const error = await failure(
      fetchSidecars(new File(['mtllib a.mtl\n'], 'a.obj'), `${SERVER}/m/a.obj`, { fetch, frameOrigin: FRAME }),
    );
    expect(error.code).toBe('SIDECAR_REFUSED');
    expect(error.message).toContain('//evil.example/b.png');
    expect(calls).toHaveLength(1);
  });

  it('refuses two files of one name, which the loader could not tell apart, before any request', async () => {
    const { fetch, calls } = server();
    const model = new File([gltfWith({ images: ['x/a.png', 'y/A.png'] })], 'a.gltf');
    const error = await failure(fetchSidecars(model, `${SERVER}/m/a.gltf`, { fetch, frameOrigin: FRAME }));
    expect(error.code).toBe('SIDECAR_REFUSED');
    expect(error.message).toContain(`${SERVER}/m/x/a.png`);
    expect(error.message).toContain(`${SERVER}/m/y/A.png`);
    expect(calls).toEqual([]);
  });

  it('refuses a hostile reference listed after fetchable ones before any request', async () => {
    const { fetch, calls } = server();
    const model = new File(
      [gltfWith({ buffers: ['a.bin'], images: ['b.png', 'https://evil.example/c.png'] })],
      'a.gltf',
    );
    const error = await failure(fetchSidecars(model, `${SERVER}/m/a.gltf`, { fetch, frameOrigin: FRAME }));
    expect(error.code).toBe('SIDECAR_REFUSED');
    expect(error.message).toContain('"https://evil.example/c.png"');
    expect(calls).toEqual([]);
  });

  it('refuses a declared length over what the model left of the budget', async () => {
    const { fetch } = fakeFetch(() =>
      Promise.resolve(new Response(new Uint8Array(8), { headers: { 'content-length': '60' } })),
    );
    const model = new File([gltfWith({ buffers: ['a.bin'] })], 'a.gltf');
    const budget = model.size + 50;
    const error = await failure(
      fetchSidecars(model, `${SERVER}/m/a.gltf`, { fetch, frameOrigin: FRAME, maxBytes: budget }),
    );
    expect(error.code).toBe('MODEL_TOO_LARGE');
    expect(error.message).toContain('model and its files');
    expect(error.message).toContain(`${SERVER}/m/a.bin`);
  });

  it('stops a body that streams past what the earlier files left of the budget', async () => {
    const { fetch, calls } = fakeFetch((url) =>
      Promise.resolve(new Response(new Uint8Array(url.endsWith('a.bin') ? 40 : 30))),
    );
    const model = new File([gltfWith({ buffers: ['a.bin'], images: ['b.png'] })], 'a.gltf');
    const error = await failure(
      fetchSidecars(model, `${SERVER}/m/a.gltf`, { fetch, frameOrigin: FRAME, maxBytes: model.size + 60 }),
    );
    expect(error.code).toBe('MODEL_TOO_LARGE');
    expect(error.message).toContain(`${SERVER}/m/b.png`);
    expect(calls).toHaveLength(2);
  });

  it('gives all the files one time limit from the first request', async () => {
    vi.useFakeTimers();
    try {
      const { fetch, calls } = fakeFetch((url, init) =>
        url.endsWith('a.bin')
          ? new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('abcd')), 20_000))
          : hanging(init),
      );
      const model = new File([gltfWith({ buffers: ['a.bin'], images: ['b.png'] })], 'a.gltf');
      const pending = failure(fetchSidecars(model, `${SERVER}/m/a.gltf`, { fetch, frameOrigin: FRAME }));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(10_000);
      const error = await pending;
      expect(error.code).toBe('MODEL_FETCH_TIMEOUT');
      expect(error.message).toContain('30 s');
      expect(error.message).toContain(`${SERVER}/m/b.png`);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([404, 403, 500])('leaves out a file the server answered %i for, for the loader to report', async (status) => {
    const { fetch, calls } = fakeFetch((url) =>
      Promise.resolve(
        new URL(url).pathname.endsWith('gone.bin')
          ? new Response('no', { status })
          : new Response(fixture('textures/checker tile.png')),
      ),
    );
    const model = new File([gltfWith({ buffers: ['gone.bin'], images: ['../textures/checker tile.png'] })], 'a.gltf');
    const files = await fetchSidecars(model, `${SERVER}/sidecars/gltf/a.gltf`, { fetch, frameOrigin: FRAME });
    expect(files.map((file) => file.name)).toEqual(['checker tile.png']);
    expect(calls).toHaveLength(2);
  });

  it('leaves out an OBJ material library the server answered 404 for', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(new Response('no', { status: 404 })));
    const model = new File(['mtllib gone.mtl\nv 0 0 0\n'], 'a.obj');
    expect(await fetchSidecars(model, `${SERVER}/m/a.obj`, { fetch, frameOrigin: FRAME })).toEqual([]);
  });

  it('refuses every spelling of a reference, one hidden by an earlier percent-encoded copy included', async () => {
    const { fetch, calls } = server();
    const model = new File([gltfWith({ buffers: ['%2F%2Fevil.example/a.bin', '//evil.example/a.bin'] })], 'a.gltf');
    const error = await failure(fetchSidecars(model, `${SERVER}/m/a.gltf`, { fetch, frameOrigin: FRAME }));
    expect(error.code).toBe('SIDECAR_REFUSED');
    expect(error.message).toContain('"//evil.example/a.bin"');
    expect(calls).toEqual([]);
  });

  it('reads only a gltf, glb or obj, and nothing of a bbmodel or a skin', async () => {
    const { fetch, calls } = server();
    for (const name of ['a.bbmodel', 'skin.png']) {
      const model = new File(['{}'], name);
      const whole = vi.spyOn(model, 'arrayBuffer');
      const slice = vi.spyOn(model, 'slice');
      expect(await fetchSidecars(model, `${SERVER}/m/${name}`, { fetch, frameOrigin: FRAME })).toEqual([]);
      expect(whole).not.toHaveBeenCalled();
      expect(slice).toHaveBeenCalledWith(0, 4);
    }
    expect(calls).toEqual([]);
  });

  it('explains a file without response with one HEAD probe, naming it', async () => {
    const { fetch, calls } = fakeFetch((_url, init) =>
      init?.method === 'HEAD' ? Promise.resolve(new Response(null)) : Promise.reject(new TypeError('Failed to fetch')),
    );
    const model = new File([gltfWith({ images: ['t.png'] })], 'a.gltf');
    const error = await failure(fetchSidecars(model, `${SERVER}/m/a.gltf`, { fetch, frameOrigin: FRAME }));
    expect(error.code).toBe('MODEL_CORS_BLOCKED');
    expect(error.message).toContain(`${SERVER}/m/t.png`);
    expect(error.message).toContain('Access-Control-Allow-Origin');
    expect(calls.map((c) => c.init?.method)).toEqual(['GET', 'HEAD']);
  });

  it('rejects with the abort reason when the frame moves on mid-download', async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch((_url, init) => hanging(init));
    const model = new File([gltfWith({ buffers: ['a.bin'], images: ['b.png'] })], 'a.gltf');
    const pending = fetchSidecars(model, `${SERVER}/m/a.gltf`, {
      fetch,
      frameOrigin: FRAME,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort(new Error('superseded'));
    await expect(pending).rejects.toThrow('superseded');
    expect(calls).toHaveLength(1);
  });
});
